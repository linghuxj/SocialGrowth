import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { executorConsoleSchema, mediaAccountListResponseSchema } from "../product/contracts/src/index.js";

// Readiness inspection through actual Web navigation. This does not register
// fake identities, retry unknown device work or claim binding acceptance.
const output=resolve(process.env.SG_PRODUCT_IDENTITY_READINESS_OUTPUT??"output/playwright/existing-identity-readiness");
assert.ok(process.env.SG_PRODUCT_DEPLOYMENT_LOGIN_FILE,"Protected operator login file required");
const login=JSON.parse(await readFile(process.env.SG_PRODUCT_DEPLOYMENT_LOGIN_FILE,"utf8"));
await mkdir(output,{recursive:true,mode:0o700});
const browser=await chromium.launch({headless:true,...(process.env.SG_PRODUCT_BROWSER_PROXY?{proxy:{server:process.env.SG_PRODUCT_BROWSER_PROXY}}:{})});
const page=await browser.newPage({locale:"zh-CN",viewport:{width:1465,height:1074}});
const writes:string[]=[],errors:string[]=[],checks:string[]=[];
page.on("request",r=>{const path=new URL(r.url()).pathname;if(r.method()!=="GET"&&path.startsWith("/api/")&&path!=="/api/operator/login")writes.push(path);});
page.on("pageerror",e=>errors.push(e.name));
try{
 await page.goto(process.env.SG_PRODUCT_WEB_URL??"https://growth.mhtm.top",{waitUntil:"networkidle"});
 await page.getByRole("heading",{name:"登录正式产品"}).waitFor();
 await page.getByLabel("登录名",{exact:true}).fill(login.loginName);
 await page.getByLabel("密码",{exact:true}).fill(login.password);login.password="";
 await page.getByRole("button",{name:"登录",exact:true}).click();
 await page.getByRole("heading",{name:"运营工作台",exact:true}).waitFor();checks.push("Actual operator Web login");
 const mediaResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/operator/media-accounts"&&r.request().method()==="GET");
 await page.getByRole("button",{name:"媒体平台账号",exact:true}).click();
 const media=await mediaResponse;assert.equal(media.status(),200);const accounts=mediaAccountListResponseSchema.parse(await media.json());
 await page.getByRole("heading",{name:"账号与凭据状态",exact:true}).waitFor();
 await page.waitForFunction(count=>document.querySelectorAll(".media-account-card").length===count,accounts.accounts.length);
 assert.equal(await page.locator(".media-account-card").count(),accounts.accounts.length);
 await page.screenshot({path:resolve(output,"accounts.png")});checks.push("Account registry matches visible Web cards");
 const statusResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/operator/executor/status"&&r.request().method()==="GET");
 await page.getByRole("button",{name:"执行与人工协助",exact:true}).click();
 const status=await statusResponse;assert.equal(status.status(),200);const facts=executorConsoleSchema.parse(await status.json());
 await page.getByRole("heading",{name:"手机接入与准备",exact:true}).waitFor();
 await page.waitForFunction(count=>document.querySelectorAll("[data-executor-job]").length===count,facts.jobs.length);
 assert.equal(await page.locator("[data-executor-job]").count(),facts.jobs.length);
 for(const device of facts.bootstrapDevices)await page.locator(`[data-bootstrap-device="${device.deviceId}"]`).waitFor();
 await page.screenshot({path:resolve(output,"original-device-operations.png")});
 checks.push("Live phone connection and original receipts remain visible");
 await page.getByRole("button",{name:"项目",exact:true}).click();
 await page.getByRole("heading",{name:"项目列表",exact:true}).waitFor();
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 const result={surfaceChecks:"passed",checks,businessAcceptance:"not_completed",businessWrites:0,
  accountCount:accounts.accounts.length,identityCount:accounts.accounts.reduce((n,a)=>n+a.publishingIdentities.length,0),
  connectedDevices:facts.bootstrapDevices.filter(d=>d.connected).map(d=>d.deviceId),
  holds:facts.holds,originalJobs:facts.jobs.map(j=>({id:j.id,status:j.status,resultCode:j.resultCode??null})),
  blockers:[...(accounts.accounts.length?[]:["media_account_not_registered"]),...(accounts.accounts.some(a=>a.publishingIdentities.length)?[]:["existing_identity_not_bound"]),
    ...(accounts.accounts.some(a=>a.parentLoginVerification==="verified"&&a.publishingIdentities.length===1&&a.publishingIdentities[0]?.verificationState==="verified"&&a.publishingIdentities[0]?.managementState==="managed")?[]:["verified_unique_managed_identity_required"])],at:new Date().toISOString()};
 await writeFile(resolve(output,"result.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});
 console.log(JSON.stringify({surfaceChecks:result.surfaceChecks,businessAcceptance:result.businessAcceptance,businessWrites:0,blockers:result.blockers}));
}finally{await browser.close();}
