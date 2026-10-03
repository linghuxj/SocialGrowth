import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { promisify } from "node:util";
import { NetworkAdmissionApi, type AdmissionRoute } from "../product/backend/src/network-admission-api.js";
import { NetworkAdmissionStore } from "../product/backend/src/network-admission-store.js";
import { InstallationAuthService } from "../product/backend/src/installation-auth-service.js";
import { TailscaleAdmissionRuntime } from "../product/backend/src/tailscale-admission-runtime.js";
import { PinnedServeListener } from "../product/backend/src/tailscale-serve-listener.js";
import { TailscaleCliWhoIs, readTailnetNode, readTailnetNodeIdentity, tailnetAddress } from "../product/backend/src/tailscale-source-verifier.js";

// Bounded, operator-authorized real protocol validation, not a policy producer.
// Unavailable write/revision/path-check ports are deliberately NOT substituted.
async function privateFile(path: string) {
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const s=await fd.stat();assert.ok(s.isFile() && s.uid===process.getuid?.() && !(s.mode&0o077) && s.size<=16384);return await fd.readFile(); }
  finally { await fd.close(); }
}
let stage="configuration";
let sourceDiagnostic: { identityAvailable: boolean; online: boolean; liveSourceVerified: boolean } | null = null;
async function main() {
  assert.equal(process.env.SG_PRODUCT_ADMISSION_PROTOCOL_CHECK,"authorized");
  const minutes=Number(process.env.SG_PRODUCT_ADMISSION_PROTOCOL_MINUTES??"15");assert.ok(Number.isInteger(minutes)&&minutes>=1&&minutes<=30);
  const output=resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT??"artifacts/acceptance/product/B3/admission-api-20261003");
  await mkdir(output,{recursive:true,mode:0o700});
  const run=promisify(execFile),cli="/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  stage="existing_serve_scope";
  assert.deepEqual(JSON.parse((await run(cli,["serve","status","--json"],{timeout:3000})).stdout),{});
  stage="tailscale_preferences";
  const prefs=JSON.parse((await run(cli,["debug","prefs"],{timeout:3000})).stdout) as {WantRunning:boolean;ShieldsUp:boolean};
  assert.ok(prefs.WantRunning && !prefs.ShieldsUp);
  stage="tailscale_status";
  const status=JSON.parse((await run(cli,["status","--json"],{timeout:3000})).stdout) as {BackendState:string;TailscaleIPs:string[];Self:{DNSName:string}};
  assert.equal(status.BackendState,"Running");assert.ok(status.TailscaleIPs.length && status.TailscaleIPs.every(ip=>tailnetAddress(ip)===ip));
  stage="phone_source_whois";
  const whois=new TailscaleCliWhoIs(cli),phone="100.118.89.89",rawPhone=await whois.lookup(phone,AbortSignal.timeout(2000));
  const phoneIdentity=readTailnetNodeIdentity(rawPhone,phone),expected=readTailnetNode(rawPhone,phone);
  const online=!!rawPhone&&typeof rawPhone==="object"&&"Node" in rawPhone&&!!rawPhone.Node&&typeof rawPhone.Node==="object"
    &&"Online" in rawPhone.Node&&rawPhone.Node.Online===true;
  sourceDiagnostic={identityAvailable:phoneIdentity!==null,online,liveSourceVerified:expected!==null};
  assert.ok(expected);
  stage="diagnostic_tls";
  const hostname=status.Self.DNSName.replace(/\.$/,""),cert=await privateFile(resolve(".runtime/product-local-live/diagnostic-tls-cert.pem"));
  const key=await privateFile(resolve(".runtime/product-local-live/diagnostic-tls-key.pem")),certificate=new X509Certificate(cert);
  assert.equal(certificate.checkHost(hostname),hostname);assert.ok(Date.parse(certificate.validFrom)<=Date.now()&&Date.parse(certificate.validTo)>Date.now());
  const config=JSON.parse((await privateFile(resolve(".runtime/product-local-live/config.json"))).toString("utf8")) as {databasePassword:unknown;authPepper:unknown};
  assert.ok(typeof config.databasePassword==="string" && /^[a-f0-9]{64}$/.test(config.databasePassword));
  assert.ok(typeof config.authPepper==="string" && /^[a-f0-9]{64}$/.test(config.authPepper));
  type PgPool=ConstructorParameters<typeof NetworkAdmissionStore>[0];
  const {Pool}=createRequire(resolve("product/backend/package.json"))("pg") as {Pool:new(options:{connectionString:string;max:number})=>PgPool};
  const pool=new Pool({connectionString:`postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/sg_product_local_live`,max:4});
  let listener:PinnedServeListener,api:NetworkAdmissionApi,child:ReturnType<typeof spawn>|null=null,stopping=false,active=0,accepted=0;
  const http=createServer((req,res)=>{
    if(stopping || active>=4) {res.writeHead(503,{Connection:"close"});res.end();return;}
    active++;
    void(async()=>{
      const handle=listener.transportFor(req.socket),peer=handle?listener.peerOf(handle):null;
      assert.ok(handle&&peer);
      const at=Date.now(),actual=readTailnetNode(await whois.lookup(peer,AbortSignal.timeout(2000)),peer);
      const matched=!!actual && peer===phone && actual.nodeId===expected.nodeId && actual.nodeKey===expected.nodeKey
        && listener.peerOf(handle)===peer && Date.now()-at<3000;
      const headers={"Content-Type":"application/json","Cache-Control":"no-store",Connection:"close"};
      if(req.method==="GET"&&req.url==="/health") {
        res.writeHead(200,headers);res.end(JSON.stringify({code:"NETWORK_ADMISSION_API_PROTOCOL_CHECK",trustedIncomingTransport:true,
          expectedPhoneSourceVerified:matched,restrictionVerified:false,networkRevisionAvailable:false,
          networkAdmissionGranted:false,actionPermissionGranted:false}));return;
      }
      if(!matched) {res.writeHead(503,headers);res.end('{"code":"SOURCE_UNAVAILABLE"}');return;}
      const route=/^\/api\/installation\/network-admission\/(state|begin|challenge|proof)$/.exec(req.url??"")?.[1] as AdmissionRoute|undefined;
      if(req.method!=="POST"||!route||req.headers["content-type"]!=="application/json; charset=utf-8") {res.writeHead(404,headers);res.end();return;}
      let bytes=Buffer.alloc(0);
      for await(const part of req) {bytes=Buffer.concat([bytes,Buffer.from(part as Uint8Array)]);if(bytes.length>16384) {res.writeHead(413,headers);res.end();req.destroy();return;}}
      let body:unknown;
      try {body=JSON.parse(bytes.toString("utf8"));} catch {res.writeHead(400,headers);res.end();return;}
      const authorization=typeof req.headers.authorization==="string"&&req.headers.authorization.length<=64?req.headers.authorization:undefined;
      const result=await api.handle(route,body,authorization,req.socket);
      res.writeHead(result.status,headers);res.end(JSON.stringify(result.body));accepted++;
      console.log(JSON.stringify({event:"admission_protocol_request",route,status:result.status,accepted,expectedPhoneSourceVerified:true}));
    })().catch(()=>{if(!res.headersSent)res.writeHead(503,{Connection:"close"});res.end();}).finally(()=>{active--;});
  });
  http.requestTimeout=5000;http.headersTimeout=5000;http.maxHeadersCount=32;
  const stop=()=>{if(stopping)return;stopping=true;child?.kill("SIGINT");listener?.close();http.closeAllConnections();};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    stage="pinned_listener";
    listener=await PinnedServeListener.create(4443,status.TailscaleIPs,createSecureContext({key,cert,minVersion:"TLSv1.2"}),socket=>http.emit("connection",socket));
    api=new NetworkAdmissionApi(new NetworkAdmissionStore(pool),new InstallationAuthService(pool,config.authPepper),
      new TailscaleAdmissionRuntime(listener,whois,null,null));
    await new Promise<void>((yes,no)=>{listener.server.once("error",no);listener.server.listen(4443,"127.0.0.1",yes);});
    process.once("SIGINT",stop);process.once("SIGTERM",stop);timer=setTimeout(stop,minutes*60000);
    child=spawn(cli,["serve","--tcp=9443","--proxy-protocol=1","tcp://127.0.0.1:4443"],{stdio:["ignore","pipe","pipe"],shell:false});
    child.stdout?.on("data",()=>undefined);child.stderr?.on("data",()=>undefined);
    const ended=new Promise<void>((yes,no)=>{child!.once("error",no);child!.once("close",code=>stopping||code===0?yes():no(new Error()));});
    const metadata={startedAt:new Date().toISOString(),maximumMinutes:minutes,transport:"pinned_serve_proxy_v1_then_tls",tlsScope:"existing_debug_ca_not_production_tls",
      certificateExpiresAt:new Date(certificate.validTo).toISOString(),policyMutationPerformed:false,networkRevisionProducerConfigured:false,
      networkAdmissionGranted:false,actionPermissionGranted:false};
    await writeFile(resolve(output,"api-verifier-start.json"),JSON.stringify(metadata,null,2),{mode:0o600});console.log(JSON.stringify({event:"admission_verifier_check_started",...metadata}));
    await ended;
  } finally {
    clearTimeout(timer);stop();await pool.end();
    await writeFile(resolve(output,"api-verifier-stop.json"),JSON.stringify({stoppedAt:new Date().toISOString(),accepted,policyMutationPerformed:false,
      noParticipationCommandIssued:true,networkAdmissionGranted:false,actionPermissionGranted:false},null,2),{mode:0o600});
  }
}
await main().catch(()=>{console.error(JSON.stringify({event:"admission_verifier_check_unavailable",stage,...(sourceDiagnostic?{phoneSource:sourceDiagnostic}:{})}));process.exitCode=2;});
