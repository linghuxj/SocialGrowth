import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.SG_RUNTIME_CORE_WEB_URL??'http://127.0.0.1:3000';assert.equal(new URL(base).hostname,'127.0.0.1');
const project=process.env.SG_RUNTIME_CORE_PROJECT_ID,account=process.env.SG_RUNTIME_CORE_ACCOUNT_ID;
assert.ok(project&&account,'Use the explicitly authorized existing project and account');
const out=resolve(process.env.SG_RUNTIME_CORE_OUTPUT??'output/playwright/core-execution-20261006/identity-recovery');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1080}});
const ids=['461acb0a-5d88-4ea6-b071-497aad5d36d9','fcaa9e2a-5ec6-4615-a2ed-069748a16e71','eec52c34-06f5-4483-aeab-e8db03c39584','a42dda47-a850-4c30-b03c-b6c5c7f97b68','ca0127c3-b295-4d42-9f0c-96249aa4a367','cb069920-29e9-48f0-819c-fec5cba255d0'];
let closures=0,reviews=0;const checks:string[]=[];
page.on('request',r=>{if(r.method()!=='POST')return;if(r.url().endsWith('/onboarding/end-stopped'))closures++;if(r.url().endsWith('/reviews'))reviews++;});
try{
 await page.goto(`${base}/#/accounts?object=${account}&project=${project}`);
 const jobs=page.getByRole('region',{name:'账号接入任务',exact:true});await jobs.waitFor();
 for(const id of ids){const job=jobs.locator('article').filter({hasText:id});assert.equal(await job.count(),1);const button=job.getByRole('button',{name:'结束这条已停止的核验',exact:true});
  if(await button.count()){await button.click();await job.getByText('这条旧核验已结束，后续不会再次查询或重发；原结果仍未知，不代表核验成功，且未修改发布绑定。',{exact:true}).waitFor({timeout:60000});}
  else await job.getByText('这条旧核验已结束，后续不会再次查询或重发；原结果仍未知，不代表核验成功，且未修改发布绑定。',{exact:true}).waitFor();
 }
 assert.ok(closures<=6);await jobs.screenshot({path:resolve(out,'closed-identity-jobs.png')});checks.push('六条原非创建核验从实际 Web 结束，保留原未知结果，不标成功，不重跑');
 await page.goto(`${base}/#/exceptions?project=${project}`);
 await page.getByRole('link',{name:'前往任务中心复核暂停范围',exact:true}).click();
 const taskId='d634e4c6-4266-4cc7-a784-3a31a1737cac';
 await page.getByRole('combobox',{name:'查看任务',exact:true}).selectOption(taskId);
 await page.getByRole('button',{name:/复核已确认未发布任务的暂停范围/}).click();const form=page.locator(`#review-${taskId}`);await form.waitFor();
 await form.getByLabel('核对结论',{exact:true}).selectOption('confirmed_not_published');
 await form.getByLabel('核对证据截图 PNG',{exact:true}).setInputFiles(resolve('output/playwright/core-execution-20261006/original-review/original-stop.png'));
 await form.getByLabel('核对过程与结论',{exact:true}).fill('复核同一原任务 d634e4c6 和原 trace c41af179 的实际发布前截图、final_report.md 与最终检查 ledger：原结果正文为空，已确认未点击发布且无在途操作，保留原失败和事件。六条旧非创建核验已从 Web 按原引擎终态或精确原监督停止证据撤销后续核验；原未知结果仍保留，不代表登录或安装成功。运行时和原引擎设备占用核对均无在途，继续复用同一账号与手机。本轮仅允许 USB 发布准备，不允许公开发布；旧 Profile 证据不能代替新 Page 审计。');
 await form.getByLabel('关联范围与当前授权',{exact:true}).selectOption('reviewed');await form.screenshot({path:resolve(out,'scope-review-before.png')});
 await form.getByRole('button',{name:'保存核对并重新审查相关范围',exact:true}).click();await form.waitFor({state:'detached',timeout:30000});assert.equal(reviews,1);
 assert.equal(await page.getByText(/存在待核对的暂停范围/).count(),0);await page.screenshot({path:resolve(out,'scope-review-after.png'),fullPage:true});checks.push('同一已确认未发布任务从 Web 再核对暂停范围，未绕过剩余未决检查');
 await writeFile(resolve(out,'result.json'),JSON.stringify({result:'passed',checks,closures,reviews,publicPublication:false},null,2));console.log(JSON.stringify({passed:true,closures,reviews,checks:checks.length}));
}catch(error){await page.screenshot({path:resolve(out,'failed.png'),fullPage:true});await writeFile(resolve(out,'result.json'),JSON.stringify({result:'failed',checks,closures,reviews,error:error instanceof Error?error.message:'unknown'},null,2));throw error;}finally{await browser.close();}
