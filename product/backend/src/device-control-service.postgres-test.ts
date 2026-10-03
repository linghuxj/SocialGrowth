import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion, controlProtocolVersion, participationProtocolVersion, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import { InstallationAuthService } from "./installation-auth-service.js";
import { type ActionAuthorityFacts } from "./action-permission-core.js";
import { DeviceControlService } from "./device-control-service.js";
import { LocalParticipationService, loadCurrentLocalParticipation } from "./local-participation-service.js";
import { PhoneControlJournal } from "./phone-control-journal.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProviderAuthService } from "./provider-auth-service.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Device control PostgreSQL test needs an isolated database and SG_PRODUCT_TEST_ALLOW_RESET=1");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-device-control-fixtures" });
const pepper = "device-control-fixture-auth-pepper-0000000001";
const providers = new ProviderAuthService(pool, pepper, { async sendVerificationCode() {} });
const installations = new InstallationAuthService(pool, "device-control-installation-pepper-00000001");
const service = new DeviceControlService(pool, providers, installations);
const participation = new LocalParticipationService(pool,installations);
const journal = new PhoneControlJournal(pool);
const key = () => `control_${randomUUID().replaceAll("-", "")}`;
const metadata = (name: string) => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `${name}_${randomUUID().replaceAll("-", "")}` });
const pulseInput = (runId:string,extra:Record<string,unknown>={})=>({protocolVersion:participationProtocolVersion,requestId:`request-${randomUUID()}`,requestKey:`pulse_${randomUUID().replaceAll("-","")}`,runId,...extra});
const migrations = ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql", "0005_network_admission.sql", "0006_phone_control_journal.sql", "0029_phone_holder_grants.sql", "0030_local_participation.sql"];

interface Principal { providerId: string; providerToken: string; installationId: string; installationToken: string; deviceId: string; }
async function fixture(state: "associated_pending_access" | "access_ready" = "access_ready"): Promise<Principal> {
  const providerId = randomUUID(), providerToken = randomBytes(32).toString("base64url");
  const installationId = randomUUID(), installationToken = randomBytes(32).toString("base64url"), deviceId = randomUUID();
  await pool.query(`INSERT INTO socialgrowth_product.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Control fixture','active')`, [providerId, `+1555${String(Math.floor(Math.random()*1_000_000_000)).padStart(9,"0")}`]);
  await pool.query(`INSERT INTO socialgrowth_product.provider_sessions(session_id,provider_id,token_digest,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`, [randomUUID(),providerId,createHmac("sha256",pepper).update(providerToken,"utf8").digest()]);
  await pool.query(`INSERT INTO socialgrowth_product.installations(installation_id,credential_digest,status) VALUES($1,$2,'active')`, [installationId,createHash("sha256").update(`credential-${installationId}`).digest()]);
  await pool.query(`INSERT INTO socialgrowth_product.installation_sessions(session_id,installation_id,token_digest,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`, [randomUUID(),installationId,createHash("sha256").update(installationToken,"utf8").digest()]);
  const associationSessionId=randomUUID();
  await pool.query(`INSERT INTO socialgrowth_product.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at)
    VALUES($1,$2,1,'fixture',$3,clock_timestamp()+interval '1 hour')`,[associationSessionId,installationId,randomBytes(32)]);
  await pool.query(`INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Control fixture',$2)`,[deviceId,state]);
  await pool.query(`INSERT INTO socialgrowth_product.device_associations(association_id,device_id,installation_id,provider_id,association_session_id)
    VALUES($1,$2,$3,$4,$5)`,[randomUUID(),deviceId,installationId,providerId,associationSessionId]);
  return { providerId,providerToken,installationId,installationToken,deviceId };
}

before(async()=>{ await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); for(const file of migrations) await pool.query(await readFile(new URL(`../migrations/${file}`,import.meta.url),"utf8")); });
after(async()=>{ try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });

test("provider and signed installation pause routes resolve authority from current sessions and associations", async()=>{
  const f=await fixture();
  const post=await service.providerCommand(f.providerToken,f.deviceId,"pause",{metadata:metadata("provider-pause")});
  assert.equal(post.intent,"pause_requested"); assert.equal(post.stop,"requested"); assert.ok(post.requestId);
  const device=(await pool.query<{state:string}>(`SELECT state FROM socialgrowth_product.devices WHERE device_id=$1`,[f.deviceId])).rows[0];
  assert.equal(device?.state,"paused");
  const record=await journal.read(f.deviceId); assert.equal(record.disposition,"stop_requested"); assert.equal(record.holderId,null);
  const self=await service.installationRead(f.installationToken); assert.equal(self.deviceId,f.deviceId); assert.equal(self.intent,"pause_requested");
  // Replaying the exact key is safe and does not bump the stop generation.
  const command={metadata:metadata("provider-replay")};
  const first=await service.providerCommand(f.providerToken,f.deviceId,"pause",command);
  const before=await journal.read(f.deviceId);
  const replay=await service.providerCommand(f.providerToken,f.deviceId,"pause",command);
  assert.equal(replay.requestId,command.metadata.requestId); assert.equal((await journal.read(f.deviceId)).controlGeneration,before.controlGeneration);
  assert.ok(first.requestId);
  const stranger=await fixture();
  await assert.rejects(service.providerRead(stranger.providerToken,f.deviceId),(error:unknown)=>error instanceof ProductTransactionError&&error.code==="AUTHORIZATION_DENIED");
  assert.equal((await service.installationRead(f.installationToken)).deviceId,f.deviceId);
});

test("self pause keeps an unknown action and its holder occupied; logout does not alter the self route", async()=>{
  const f=await fixture();
  const initialized=await journal.initialize(f.deviceId,randomUUID(),key());
  const stopped=await journal.apply(f.deviceId,initialized.record.version,key(),{kind:"confirm_stopped",evidence:{deviceId:f.deviceId,holderId:null,
    stopRequestId:initialized.record.stopRequestId!,controlGeneration:initialized.record.controlGeneration,evidenceId:key(),checkedAt:new Date().toISOString(),
    allPathsFenced:true,controllerReleased:true,targetQuiescent:true}});
  const now=new Date(),until=new Date(now.getTime()+300_000).toISOString();
  const holderId=randomUUID(),taskAttemptId=randomUUID(),authorizationId=randomUUID();
  const request:PhoneActionRequest={protocolVersion:controlProtocolVersion,deviceId:f.deviceId,holderId,taskAttemptId,authorizationId,
    controlGeneration:stopped.record.controlGeneration,actionId:randomUUID(),purpose:"business",kind:"read_screen"};
  const facts:ActionAuthorityFacts={deviceId:f.deviceId,controlVersion:stopped.record.version,controlGeneration:stopped.record.controlGeneration,
    providerIntent:"active",projectPublicationPaused:false,networkAdmitted:true,adbAuthorized:true,targetVerified:true,
    holder:{holderId,taskAttemptId,authorizationId,controlGeneration:stopped.record.controlGeneration,kind:"executor",purpose:"business",leaseUntil:until},
    localConfirmation:{controlGeneration:stopped.record.controlGeneration,intent:"active",checkedAt:now.toISOString()},
    task:{taskAttemptId,authorizationId,operation:"collect",authorized:true,currentVersions:true,validUntil:until,allowedKinds:["read_screen"],submission:"none",materialVerified:false,explicitRemovalAuthorized:false}};
  const {actionId:_actionId,kind:_kind,...holderRequest}=request;
  const grant=await journal.apply(f.deviceId,stopped.record.version,key(),{kind:"acquire_holder",request:holderRequest},facts);
  const activeFacts={...facts,controlVersion:grant.record.version};
  const call=await journal.apply(f.deviceId,grant.record.version,key(),{kind:"begin_call",request},activeFacts);
  const unknown=await journal.apply(f.deviceId,call.record.version,key(),{kind:"call_result",receipt:{deviceId:f.deviceId,actionId:request.actionId,holderId,controlGeneration:request.controlGeneration,status:"unknown"}});
  const paused=await service.installationPause(f.installationToken,{metadata:metadata("self-pause")});
  assert.equal(paused.stop,"unknown"); assert.equal(paused.unresolvedActionCount,1); assert.equal(paused.intent,"pause_requested");
  const current=await journal.read(f.deviceId); assert.equal(current.holderId,holderId); assert.equal(current.calls[0]?.status,"unknown");
  const sessionId=(await pool.query<{session_id:string}>(`SELECT session_id FROM socialgrowth_product.provider_sessions WHERE provider_id=$1`,[f.providerId])).rows[0]!.session_id;
  await pool.query(`UPDATE socialgrowth_product.provider_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1`,[sessionId]);
  assert.equal((await service.installationRead(f.installationToken)).deviceId,f.deviceId);
  await assert.rejects(service.providerRead(f.providerToken,f.deviceId),(error:unknown)=>error instanceof ProductTransactionError&&error.code==="AUTHENTICATION_REQUIRED");
  assert.equal((await journal.read(f.deviceId)).calls[0]?.status,"unknown");
  assert.equal(unknown.record.holderId,holderId);
});

test("pause keeps the same local identity run fresh but paused heartbeat never becomes action authority",async()=>{
  const f=await fixture();
  await journal.initialize(f.deviceId,randomUUID(),key());
  const runId=randomUUID();
  await participation.start(f.installationToken,pulseInput(runId));
  const beforeChallenge=await participation.challenge(f.installationToken,pulseInput(runId));
  await participation.confirm(f.installationToken,pulseInput(runId,{challengeId:beforeChallenge.challengeId}));
  const c=await pool.connect();
  try{assert.ok(await loadCurrentLocalParticipation(c,f.deviceId,new Date()));}finally{c.release();}
  const paused=await service.installationPause(f.installationToken,{metadata:metadata("pause-with-live-run")});
  assert.equal(paused.stop,"requested");
  const renewedChallenge=await participation.challenge(f.installationToken,pulseInput(runId));
  const receipt=await participation.confirm(f.installationToken,pulseInput(runId,{challengeId:renewedChallenge.challengeId}));
  assert.equal(receipt.state,"active"); assert.equal(receipt.actionPermissionGranted,false); assert.equal(receipt.stopConfirmed,false);
  const run=(await pool.query<{revoked_at:Date|null;record:{scope:{deviceFactVersion:number;controlGeneration:string|null}}}>(
    `SELECT revoked_at,record FROM socialgrowth_product.local_participation_runs WHERE run_id=$1`,[runId])).rows[0]!;
  assert.equal(run.revoked_at,null); assert.ok(run.record.scope.deviceFactVersion>0); assert.equal(run.record.scope.controlGeneration,paused.controlGeneration);
  const after=await pool.connect();try{assert.equal(await loadCurrentLocalParticipation(after,f.deviceId,new Date()),null);}finally{after.release();}
  await assert.rejects(participation.start(f.installationToken,pulseInput(randomUUID())));
});

test("resume requires confirmed stop and records intent without enabling a device or holder", async()=>{
  const f=await fixture();
  await service.providerCommand(f.providerToken,f.deviceId,"pause",{metadata:metadata("pause-before-resume")});
  await assert.rejects(service.providerCommand(f.providerToken,f.deviceId,"resume",{metadata:metadata("resume-before-stop")}),
    (error:unknown)=>error instanceof ProductTransactionError&&error.code==="FACT_VERSION_STALE");
  let record=await journal.read(f.deviceId);
  const evidence={deviceId:f.deviceId,holderId:record.holderId,stopRequestId:record.stopRequestId!,controlGeneration:record.controlGeneration,
    evidenceId:key(),checkedAt:new Date().toISOString(),allPathsFenced:true,controllerReleased:true,targetQuiescent:true};
  await journal.apply(f.deviceId,record.version,key(),{kind:"confirm_stopped",evidence});
  const response=await service.providerCommand(f.providerToken,f.deviceId,"resume",{metadata:metadata("resume-after-stop")});
  assert.equal(response.intent,"resume_requested"); assert.equal(response.stop,"confirmed");
  const device=(await pool.query<{state:string}>(`SELECT state FROM socialgrowth_product.devices WHERE device_id=$1`,[f.deviceId])).rows[0];
  assert.equal(device?.state,"paused"); record=await journal.read(f.deviceId); assert.equal(record.disposition,"stopped"); assert.equal(record.holderId,null);
});
