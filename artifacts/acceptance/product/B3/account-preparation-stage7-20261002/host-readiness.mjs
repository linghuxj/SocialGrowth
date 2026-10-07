import { readFileSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root=process.cwd();
const {AdbReadScreenTransport}=await import(pathToFileURL(root+'/product/executor/dist/adb-read-screen-transport.js'));
const {controlProtocolVersion}=await import(pathToFileURL(root+'/product/contracts/dist/index.js'));
const binaryPath=realpathSync('/Users/linghuxj/Library/Android/sdk/platform-tools/adb');
const binarySha256=createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
// Constructor inspection only: exact real host binary, synthetic non-device
// scope. Never call start, invoke adb or probe any phone/ADB endpoint.
new AdbReadScreenTransport({protocolVersion:controlProtocolVersion,deviceId:randomUUID(),holderId:randomUUID(),authorizationId:randomUUID(),taskAttemptId:randomUUID(),controlGeneration:'1',purpose:'business',serial:'SYNTHETIC_NOT_A_DEVICE',host:'127.0.0.1',port:49199,binaryPath,binarySha256});
await writeFile(root+'/artifacts/acceptance/product/B3/account-preparation-stage7-20261002/host-readiness.json',JSON.stringify({checkedAt:new Date().toISOString(),binaryPath,binarySha256,realBinaryConstructorAccepted:true,scope:'host executable file inspection only; synthetic non-device binding',adbInvoked:false,transportStarted:false,deviceOperation:false,networkOrTargetVerified:false,allPathsFenced:false},null,2)+'\n');
console.log(JSON.stringify({realBinaryConstructorAccepted:true,adbInvoked:false,deviceOperation:false}));
