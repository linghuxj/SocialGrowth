import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { artemisPreparationAssignmentSchema, artemisPreparationObservationSchema, accountPreparationIntentSchema,
  phoneActionRequestSchema, timestampSchema, uuidSchema, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import { phoneHolderRequestSchema, parsePhoneControlRecord, ActionPermissionError, type ActionAuthorityFacts } from "./action-permission-core.js";
import { PhoneControlJournal, PhoneJournalError, phoneHolderGrantSchema, type PhoneJournalResult } from "./phone-control-journal.js";
import { loadCurrentLocalParticipation } from "./local-participation-service.js";
import { parseAdmissionRecord } from "./network-admission-record.js";
import { canonicalMaterial } from "./material-registry-core.js";

const s="socialgrowth_product";
export class PreparationBrokerError extends Error {
  constructor(readonly code:"CURRENT_AUTHORITY_REQUIRED"|"PHYSICAL_BOUNDARY_REQUIRED"|"STORAGE_UNAVAILABLE") { super(`Preparation broker rejected: ${code}`); }
}
function deny():never{throw new PreparationBrokerError("CURRENT_AUTHORITY_REQUIRED");}
function physical():never{throw new PreparationBrokerError("PHYSICAL_BOUNDARY_REQUIRED");}
const hash=(v:unknown)=>createHash("sha256").update(canonicalMaterial(v)).digest("hex");
const key=(kind:string,id:string)=>`${kind}_${id.replaceAll("-","")}`;
const clock=async(c:PoolClient)=>(await c.query<{now:Date}>("SELECT clock_timestamp() now")).rows[0]!.now;

// Passed only to a trusted runtime composition. A response must come from real
// current network/ADB/target/every-path protection, NEVER an HTTP body, prompt,
// USB enumeration, cached admission record or an environment-enabled flag.
export interface PhysicalPreparationScope {
  deviceId:string; serial:string; associationId:string; installationId:string; installationGeneration:string; installationSessionId:string;
  deviceFactVersion:number; controlVersion:number; controlGeneration:string; controlDisposition:"stopped"|"enabled"; participationRunId:string;
  projectId:string; projectVersion:number; resourceVersion:string; taskId:string; taskVersion:number; taskAttemptId:string;
  operationId:"inspect_app"|"assist_existing_login"; actionKind:"read_screen"|"write_input"|"submit_login";
  fieldRef:"login"|"password"|null; targetViewIdResourceName:string|null;
  credentialId:string|null; credentialRevision:number|null;
  assignmentFingerprint:string; traceId:string|null; enrollmentId:string; enrollmentGeneration:string; enrollmentVersion:number;
  nodeId:string; nodeKey:string; networkRevision:number; policyRevision:number; formalEvidenceId:string;
  holderId:string; authorizationId:string; leaseUntil:string;
}
export interface PhysicalPreparationInspector {
  // Read-only external observation outside ALL SQL locks. The inspector must not
  // start a phone action. Abort/timeout never authorizes a later completion.
  inspect(scope:Readonly<PhysicalPreparationScope>, nonce:string, signal:AbortSignal):Promise<unknown>;
}
const observationSchema=z.strictObject({nonce:uuidSchema,scopeDigest:z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt:timestampSchema,validUntil:timestampSchema,networkAdmitted:z.literal(true),adbAuthorized:z.literal(true),
  targetVerified:z.literal(true),allPathsFenced:z.literal(true),targetQuiescent:z.literal(true),
  sensitiveObservationBlocked:z.boolean(),targetFieldVerified:z.boolean(),loginSubmitTargetVerified:z.boolean(),controllerOwnership:z.enum(["released","held"])});
interface Current { scope:PhysicalPreparationScope;control:ReturnType<typeof parsePhoneControlRecord>;participation:NonNullable<Awaited<ReturnType<typeof loadCurrentLocalParticipation>>>;sessionExpiresAt:string;until:string }
export interface BrokerActionResult { journal:PhoneJournalResult; ticket:(PhoneActionRequest & {serial:string;checkedAt:string;validUntil:string;replayed:false})|null }

// First slice deliberately permits only read_screen for the original inspect_app
// operation. No navigation, installation, creation, signout or public submission.
// Not registered as an HTTP permission endpoint and not enabling executor main.
export class PreparationActionBroker {
  private readonly journal:PhoneControlJournal;
  constructor(private readonly pool:Pool,private readonly inspector:PhysicalPreparationInspector|null=null){this.journal=new PhoneControlJournal(pool);}
  private async tx<T>(work:(c:PoolClient)=>Promise<T>):Promise<T>{
    let c:PoolClient;try{c=await this.pool.connect();}catch{throw new PreparationBrokerError("STORAGE_UNAVAILABLE");}
    try{await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='10s'");
      const result=await work(c);await c.query("COMMIT");return result;
    }catch(e){try{await c.query("ROLLBACK");}catch{throw new PreparationBrokerError("STORAGE_UNAVAILABLE");}
      if(e instanceof PreparationBrokerError)throw e;
      if(e instanceof ActionPermissionError||(e instanceof PhoneJournalError&&e.code!=="DATABASE_UNAVAILABLE"))deny();
      // No persisted assignment, node identity, credentials or raw DB cause.
      throw new PreparationBrokerError("STORAGE_UNAVAILABLE");
    }finally{c.release();}
  }
  private request(raw:unknown):PhoneActionRequest {const r=phoneActionRequestSchema.safeParse(raw);if(!r.success||r.data.purpose!=="business"||!(["read_screen","write_input","submit_login"] as readonly string[]).includes(r.data.kind))deny();if([r.data.deviceId,r.data.holderId,r.data.authorizationId,r.data.taskAttemptId,r.data.actionId].some(id=>id!==id.toLowerCase()))deny();return r.data;}
  private async replay(deviceId:string,requestKey:string,command:unknown){try{return await this.journal.replayCommand(deviceId,requestKey,command);}catch(e){if(e instanceof ActionPermissionError||(e instanceof PhoneJournalError&&e.code!=="DATABASE_UNAVAILABLE"))deny();throw new PreparationBrokerError("STORAGE_UNAVAILABLE");}}
  private async loadLocked(c:PoolClient,r:PhoneActionRequest,mode:"acquire"|"begin",candidateUntil?:string):Promise<Current>{
    const locator=(await c.query<{project_id:string;task_id:string}>(`SELECT t.project_id,t.task_id FROM ${s}.artemis_preparation_intents a JOIN ${s}.account_preparation_tasks t USING(task_id) WHERE a.task_attempt_id=$1`,[r.taskAttemptId])).rows[0];
    if(!locator||r.authorizationId!==locator.task_id)deny(); // Existing durable central request is this slice's authority ID.
    // Shared short metadata locks preserve allocations without serializing phone
    // work. Same operators -> guard -> project order as the metadata producers.
    await c.query(`LOCK TABLE ${s}.operators IN SHARE MODE`);
    if((await c.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR SHARE`)).rowCount!==1)deny();
    const project=(await c.query<{fact_version:string;phase:string}>(`SELECT fact_version::text,phase FROM ${s}.projects WHERE project_id=$1 FOR SHARE`,[locator.project_id])).rows[0];
    const task=(await c.query<{task_version:string;selected_account_id:string;selected_device_id:string;intent:unknown;intent_digest:string;requested_by:string;next_operation_id:string;state:string}>(`SELECT * FROM ${s}.account_preparation_tasks WHERE task_id=$1 AND project_id=$2 FOR SHARE`,[locator.task_id,locator.project_id])).rows[0];
    const operationId=task?.next_operation_id;
    if(!project||project.phase!=="preparing"||!task||task.selected_device_id!==r.deviceId||task.state!=="waiting_executor"
      ||!(operationId==="inspect_app"||operationId==="assist_existing_login")
      ||(mode==="begin"&&((operationId==="inspect_app"&&r.kind!=="read_screen")
        ||(operationId==="assist_existing_login"&&!(["write_input","submit_login"] as readonly string[]).includes(r.kind)))))deny();
    // No durable installation-signed password receipt verifier exists yet.
    // Never mint a submit grant from an untrusted model report or begin_call alone.
    if(mode==="begin"&&operationId==="assist_existing_login"&&r.kind==="submit_login")physical();
    if(!(await c.query(`SELECT 1 FROM ${s}.operators WHERE operator_id=$1 AND status='active' FOR SHARE`,[task.requested_by])).rowCount)deny();
    const intent=accountPreparationIntentSchema.parse(task.intent);if(hash(intent)!==task.intent_digest)deny();
    const account=(await c.query<{platform:string}>(`SELECT a.platform FROM ${s}.media_accounts a JOIN ${s}.project_account_reservations p USING(account_id) WHERE a.account_id=$1 AND p.project_id=$2 FOR SHARE OF a`,[task.selected_account_id,locator.project_id])).rows[0];
    if(!account||account.platform!==intent.target.platform||task.selected_device_id!==r.deviceId)deny();
    // R159's account↔device pairing is a separate authoritative reservation.
    // Project-level account and device reservations alone are insufficient:
    // a project may own multiple phones and accounts.
    const pair=(await c.query(`SELECT 1 FROM ${s}.project_media_account_assignments
      WHERE account_id=$1 AND project_id=$2 AND device_id=$3 AND platform=$4
        AND state='pending_initialization' AND handover_requested=false FOR SHARE`,
      [task.selected_account_id,locator.project_id,r.deviceId,intent.target.platform])).rowCount;
    if(pair!==1||!(await c.query(`SELECT 1 FROM ${s}.project_device_reservations WHERE project_id=$1 AND device_id=$2`,[locator.project_id,r.deviceId])).rowCount)deny();
    let credentialId:string|null=null,credentialRevision:number|null=null;
    if(mode==="begin"&&operationId==="assist_existing_login"){
      const credential=(await c.query<{credential_id:string;revision:string;state:string}>(`SELECT h.credential_id,h.revision::text,r.state
        FROM ${s}.media_credentials h JOIN ${s}.media_credential_revisions r
          ON (h.credential_id,h.account_id,h.platform,h.revision)=(r.credential_id,r.account_id,r.platform,r.revision)
        WHERE h.account_id=$1 AND h.platform=$2 FOR SHARE OF h,r`,[task.selected_account_id,intent.target.platform])).rows[0];
      if(!credential||credential.state!=="stored_unverified")deny();
      credentialId=credential.credential_id;credentialRevision=Number(credential.revision);
      if(!Number.isSafeInteger(credentialRevision)||credentialRevision<1)deny();
    }
    const expected=(await c.query<{association_id:string;provider_id:string;installation_id:string}>(`SELECT association_id,provider_id,installation_id FROM ${s}.device_associations WHERE device_id=$1 AND ended_at IS NULL`,[r.deviceId])).rows[0];if(!expected)deny();
    if(!(await c.query(`SELECT 1 FROM ${s}.providers WHERE provider_id=$1 AND status='active' FOR SHARE`,[expected.provider_id])).rowCount)deny();
    const installation=(await c.query<{generation:string}>(`SELECT generation::text FROM ${s}.installations WHERE installation_id=$1 AND status='active' FOR SHARE`,[expected.installation_id])).rows[0];if(!installation)deny();
    if(!(await c.query(`SELECT 1 FROM ${s}.device_associations WHERE association_id=$1 AND device_id=$2 AND installation_id=$3 AND provider_id=$4 AND ended_at IS NULL FOR SHARE`,[expected.association_id,r.deviceId,expected.installation_id,expected.provider_id])).rowCount)deny();
    const device=(await c.query<{fact_version:string;state:string}>(`SELECT fact_version::text,state FROM ${s}.devices WHERE device_id=$1 FOR UPDATE`,[r.deviceId])).rows[0];if(!device||!["associated_pending_access","access_ready"].includes(device.state))deny();
    const net=(await c.query<{record:unknown;association_id:string;provider_id:string;version:string;generation:string;candidate_node_id:string}>(`SELECT record,association_id,provider_id,version::text,generation::text,candidate_node_id FROM ${s}.network_enrollments WHERE device_id=$1 AND phase='admitted' FOR SHARE`,[r.deviceId])).rows[0];if(!net)deny();
    const admission=parseAdmissionRecord(net.record),a=admission.authority;
    if(!a.eligible||a.deviceId!==r.deviceId||a.installationId!==expected.installation_id||a.installationGeneration!==installation.generation||a.enrollmentGeneration!==net.generation||a.ownershipVersion!==device.fact_version||net.association_id!==expected.association_id||net.provider_id!==expected.provider_id||String(admission.version)!==net.version||!admission.node||admission.node.nodeId!==net.candidate_node_id||!admission.formalPolicyRevision||!admission.formalEvidenceId||admission.credentialRevoked||admission.nodeAccessRevoked)deny();
    const rawControl=(await c.query<{record:unknown}>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR UPDATE`,[r.deviceId])).rows[0];if(!rawControl)deny();const control=parsePhoneControlRecord(rawControl.record);
    if(control.deviceId!==r.deviceId||control.controlGeneration!==r.controlGeneration||(mode==="acquire"?control.disposition!=="stopped":control.disposition!=="enabled"||control.holderId!==r.holderId))deny();
    const session=(await c.query<{session_id:string;expires_at:Date}>(`SELECT se.session_id,se.expires_at FROM ${s}.installation_sessions se JOIN ${s}.local_participation p ON p.receipt_session_id=se.session_id WHERE p.device_id=$1 FOR SHARE OF se`,[r.deviceId])).rows[0];if(!session)deny();
    const now=await clock(c),participation=await loadCurrentLocalParticipation(c,r.deviceId,now);if(!participation)deny();
    const launch=(await c.query<{assignment:unknown;fingerprint:string;task_version:string;operation_id:string;trace_id:string|null}>(`SELECT assignment,fingerprint,task_version::text,operation_id,trace_id FROM ${s}.artemis_preparation_intents WHERE task_attempt_id=$1 AND task_id=$2 FOR SHARE`,[r.taskAttemptId,locator.task_id])).rows[0];if(!launch)deny();
    const assignment=artemisPreparationAssignmentSchema.parse(launch.assignment);
    if(createHash("sha256").update(JSON.stringify(assignment)).digest("hex")!==launch.fingerprint||assignment.taskAttemptId!==r.taskAttemptId||assignment.taskId!==locator.task_id||assignment.operationId!==operationId||launch.operation_id!==operationId||String(assignment.taskVersion)!==task.task_version||launch.task_version!==task.task_version||assignment.input.deviceId!==r.deviceId||assignment.input.accountId!==task.selected_account_id||assignment.input.projectId!==locator.project_id||assignment.input.mode!==intent.mode||canonicalMaterial(assignment.input.target)!==canonicalMaterial(intent.target)||assignment.input.requestedScope.scopeRef!==intent.scopeRef||assignment.input.requestedScope.allowTrustedInstall!==intent.allowTrustedInstall||assignment.input.requestedScope.allowIdentityCreation!==intent.allowIdentityCreation)deny();
    if((await c.query(`SELECT 1 FROM ${s}.artemis_preparation_intents WHERE task_attempt_id<>$1 AND assignment->'input'->>'deviceId'=$2 LIMIT 1`,[r.taskAttemptId,r.deviceId])).rowCount)deny();
    const observations=(await c.query<{record:unknown;fingerprint:string}>(`SELECT record,fingerprint FROM ${s}.artemis_preparation_observations WHERE task_attempt_id=$1 LIMIT 101`,[r.taskAttemptId])).rows;if(observations.length>100)deny();
    for(const o of observations){const parsed=artemisPreparationObservationSchema.parse(o.record);if(o.fingerprint!==launch.fingerprint||parsed.state!=="running"||parsed.traceId!==launch.trace_id)deny();}
    const rawGrant=(await c.query<{record:unknown}>(`SELECT record FROM ${s}.phone_control_holder_grants WHERE holder_id=$1 AND device_id=$2`,[r.holderId,r.deviceId])).rows[0];
    const grant=rawGrant?phoneHolderGrantSchema.parse(rawGrant.record):null;
    const until=mode==="acquire"?(candidateUntil??new Date(now.getTime()+30000).toISOString()):grant?.leaseUntil;
    if(!until||!timestampSchema.safeParse(until).success||Date.parse(until)<=now.getTime()||(mode==="acquire"&&(grant||Date.parse(until)>now.getTime()+30000)))deny();
    const expectedKinds=operationId==="assist_existing_login"?["read_screen","write_input","submit_login"]:["read_screen"];
    if(mode==="begin"&&(!grant||grant.authorizationId!==r.authorizationId||grant.taskAttemptId!==r.taskAttemptId||grant.controlGeneration!==r.controlGeneration||grant.purpose!=="business"||grant.holderKind!=="executor"||grant.operation!=="initialize"||grant.allowedKinds.length!==expectedKinds.length||expectedKinds.some((kind,i)=>grant.allowedKinds[i]!==kind)||grant.validUntil!==until))deny();
    const resourceVersion=(await c.query<{version:string}>(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0]!.version;
    const scope:PhysicalPreparationScope={deviceId:r.deviceId,serial:assignment.serial,associationId:expected.association_id,installationId:expected.installation_id,installationGeneration:installation.generation,installationSessionId:session.session_id,deviceFactVersion:Number(device.fact_version),controlVersion:control.version,controlGeneration:control.controlGeneration,controlDisposition:control.disposition as "stopped"|"enabled",participationRunId:participation.runId,projectId:locator.project_id,projectVersion:Number(project.fact_version),resourceVersion,taskId:locator.task_id,taskVersion:Number(task.task_version),taskAttemptId:r.taskAttemptId,operationId:operationId as "inspect_app"|"assist_existing_login",actionKind:(mode==="acquire"?"read_screen":r.kind) as PhysicalPreparationScope["actionKind"],fieldRef:mode==="begin"&&r.kind==="write_input"?r.fieldRef!:null,targetViewIdResourceName:mode==="begin"&&r.kind==="submit_login"?r.targetViewIdResourceName!:null,credentialId,credentialRevision,assignmentFingerprint:launch.fingerprint,traceId:launch.trace_id,enrollmentId:admission.enrollmentId,enrollmentGeneration:a.enrollmentGeneration,enrollmentVersion:admission.version,nodeId:admission.node.nodeId,nodeKey:admission.node.nodeKey,networkRevision:admission.node.networkRevision,policyRevision:admission.formalPolicyRevision,formalEvidenceId:admission.formalEvidenceId,holderId:r.holderId,authorizationId:r.authorizationId,leaseUntil:until};
    if(!Number.isSafeInteger(scope.deviceFactVersion)||!Number.isSafeInteger(scope.projectVersion))deny();
    return{scope,control,participation,sessionExpiresAt:session.expires_at.toISOString(),until};
  }
  private async observe(current:Current){
    if(!this.inspector)physical();const nonce=randomUUID(),abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{const raw=await Promise.race([this.inspector.inspect(Object.freeze({...current.scope}),nonce,abort.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new PreparationBrokerError("PHYSICAL_BOUNDARY_REQUIRED"));},2000);})]);
      const p=observationSchema.safeParse(raw);if(!p.success||p.data.nonce!==nonce||p.data.scopeDigest!==hash(current.scope)||Date.parse(p.data.validUntil)-Date.parse(p.data.checkedAt)!==2000||p.data.controllerOwnership!==(current.scope.controlDisposition==="stopped"?"released":"held")||(current.scope.actionKind==="write_input"&&(!p.data.sensitiveObservationBlocked||!p.data.targetFieldVerified))||(current.scope.actionKind==="submit_login"&&(!p.data.sensitiveObservationBlocked||!p.data.loginSubmitTargetVerified)))physical();return p.data;
    }catch{physical();}finally{if(timer)clearTimeout(timer);abort.abort();}
  }
  private facts(current:Current,r:PhoneActionRequest):ActionAuthorityFacts{return{deviceId:r.deviceId,controlVersion:current.control.version,controlGeneration:r.controlGeneration,providerIntent:"active",projectPublicationPaused:true,networkAdmitted:true,adbAuthorized:true,targetVerified:true,
    holder:{holderId:r.holderId,kind:"executor",purpose:"business",taskAttemptId:r.taskAttemptId,authorizationId:r.authorizationId,controlGeneration:r.controlGeneration,leaseUntil:current.until},
    localConfirmation:{controlGeneration:r.controlGeneration,intent:"active",checkedAt:current.participation.checkedAt},task:{taskAttemptId:r.taskAttemptId,authorizationId:r.authorizationId,operation:"initialize",authorized:true,currentVersions:true,validUntil:current.until,allowedKinds:current.scope.operationId==="assist_existing_login"?["read_screen","write_input","submit_login"]:["read_screen"],submission:"none",materialVerified:false,explicitRemovalAuthorized:false}};}
  private async apply(r:PhoneActionRequest,mode:"acquire"|"begin"):Promise<BrokerActionResult>{
    const {actionId:_actionId,kind:_kind,...holder}=r;
    const command=mode==="acquire"?{kind:"acquire_holder" as const,request:phoneHolderRequestSchema.parse(holder)}:{kind:"begin_call" as const,request:r};
    const requestKey=key(mode==="acquire"?"holder":"begin",mode==="acquire"?r.holderId:r.actionId);
    const old=await this.replay(r.deviceId,requestKey,command);if(old)return{journal:old,ticket:null};
    try {
    const captured=await this.tx(c=>this.loadLocked(c,r,mode));const observed=await this.observe(captured);
    return await this.tx(async c=>{const current=await this.loadLocked(c,r,mode,captured.until),now=await clock(c);
      if(hash(current.scope)!==observed.scopeDigest||Date.parse(observed.checkedAt)>now.getTime()||Date.parse(observed.validUntil)<=now.getTime()||Date.parse(current.participation.validUntil)<=now.getTime())physical();
      const result=await this.journal.applyInTransaction(c,r.deviceId,current.control.version,requestKey,command,this.facts(current,r));
      const checked=await clock(c);const expiry=Math.min(Date.parse(observed.validUntil),Date.parse(current.participation.validUntil),Date.parse(current.sessionExpiresAt),Date.parse(current.until));
      if(expiry<=checked.getTime())physical();
      if(!result.replayed) await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts) VALUES($1,'system',$2,'phone_control',$3,$4,$5)`,[randomUUID(),`preparation.broker.${mode}`,r.deviceId,requestKey,{nonce:observed.nonce,scopeDigest:observed.scopeDigest,physicalCheckedAt:observed.checkedAt,physicalValidUntil:observed.validUntil,taskAttemptId:r.taskAttemptId,enrollmentId:current.scope.enrollmentId,participationRunId:current.scope.participationRunId,actionPermissionIssued:mode==="begin",publicationAllowed:false}]);
      const finalNow=await clock(c);if(expiry<=finalNow.getTime())physical();
      return{journal:result,ticket:mode==="begin"&&!result.replayed?{...r,serial:current.scope.serial,checkedAt:finalNow.toISOString(),validUntil:new Date(expiry).toISOString(),replayed:false as const}:null};
    });
    } catch(error) {
      // A peer may have committed the original command while this request was
      // observing or waiting. Correlate it; never turn a replay into a ticket.
      const replay=await this.replay(r.deviceId,requestKey,command);
      if(replay)return{journal:replay,ticket:null};
      throw error;
    }
  }
  async acquireHolder(raw:unknown):Promise<BrokerActionResult>{const r=phoneHolderRequestSchema.safeParse(raw);if(!r.success)deny();return this.apply(this.request({...r.data,actionId:r.data.holderId,kind:"read_screen"}),"acquire");}
  async beginAction(raw:unknown):Promise<BrokerActionResult>{return this.apply(this.request(raw),"begin");}
}
