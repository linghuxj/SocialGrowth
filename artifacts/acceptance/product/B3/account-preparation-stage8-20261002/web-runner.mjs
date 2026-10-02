import {createRequire} from 'node:module';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
const repo=process.cwd(),output=repo+'/artifacts/acceptance/product/B3/account-preparation-stage8-20261002';
const {Pool}=createRequire(repo+'/product/backend/package.json')('pg');
const url=process.env.SG_PREPARATION_FIXTURE_DATABASE_URL,cluster=process.env.SG_PREPARATION_FIXTURE_CLUSTER_ID;
if(!url||!cluster||new URL(url).hostname!=='127.0.0.1'||new URL(url).pathname!=='/sg_bridge8_web')throw Error('Owned read transport Web database required');
const pool=new Pool({connectionString:url,max:2}),children=[],secrets=[randomBytes(32).toString('hex'),randomBytes(24).toString('hex')];
const ambient=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('SG_')&&!k.startsWith('AWS_')));
const env={...ambient,SG_PRODUCT_DATABASE_URL:url,SG_PRODUCT_AUTH_PEPPER:secrets[0],SG_PRODUCT_SMS_MODE:'unavailable',SG_PRODUCT_MATERIAL_MODE:'unavailable',SG_PRODUCT_BACKEND_HOST:'127.0.0.1',SG_PRODUCT_BACKEND_PORT:'4320',SG_PRODUCT_TRUST_PROXY_HOPS:'1',SG_PRODUCT_TEST_LOGIN_NAME:'bridge8-local',SG_PRODUCT_TEST_PASSWORD:secrets[1],SG_WEB_TARGET:'product',SG_PRODUCT_WEB_SCOPE:'account-preparation',SG_PRODUCT_WEB_URL:'http://127.0.0.1:3100',SG_PRODUCT_PREPARATION_OWNED_ENV:'1',SG_PRODUCT_PREPARATION_SCREENSHOT_DIR:output+'/ui'};
const red=v=>secrets.reduce((x,s)=>x.replaceAll(s,'[redacted]'),String(v));
async function run(name,args,stdin){const c=spawn('pnpm',args,{cwd:repo,env,stdio:['pipe','pipe','pipe']});let log='';c.stdout.on('data',v=>log+=red(v));c.stderr.on('data',v=>log+=red(v));c.stdin.end(stdin);const[code]=await once(c,'exit');await writeFile(output+'/'+name+'.log',log);if(code!==0)throw Error(name+' failed');}
function serve(name,args){const c=spawn('pnpm',args,{cwd:repo,env,detached:true,stdio:['ignore','pipe','pipe']});const x={c,name,log:''};children.push(x);c.stdout.on('data',v=>x.log+=red(v));c.stderr.on('data',v=>x.log+=red(v));}
async function ready(url){for(let i=0;i<80;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('service unavailable');}
try{
const r=(await pool.query('select current_database() db,system_identifier::text cluster from pg_control_system()')).rows[0];if(r.db!=='sg_bridge8_web'||r.cluster!==cluster)throw Error('DB scope refused');
const existing=(await pool.query("select count(*)::int n from pg_namespace where nspname='socialgrowth_product'")).rows[0];if(existing.n!==0)throw Error('Fresh owned Web database required');
for(const p of [3100,4320]){const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(p,'127.0.0.1',yes)});await new Promise(r=>server.close(r));}
const dir=repo+'/product/backend/migrations',migrations=(await readdir(dir)).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();for(const f of migrations)await pool.query(await readFile(dir+'/'+f,'utf8'));
await run('operator-initialize',['--filter','@socialgrowth/product-backend','operator:admin','initialize','--login-name',env.SG_PRODUCT_TEST_LOGIN_NAME,'--display-name','合成验收运营','--request-id','init-'+randomUUID()],secrets[1]);
serve('backend',['--filter','@socialgrowth/product-backend','start']);await ready('http://127.0.0.1:4320/health/live');serve('web',['--filter','@socialgrowth/product-web','exec','vite','--host','127.0.0.1','--port','3100','--strictPort']);await ready(env.SG_PRODUCT_WEB_URL);
await writeFile(output+'/web-environment.json',JSON.stringify({database:r.db,cluster,web:env.SG_PRODUCT_WEB_URL,migrations,scope:'actual Web; synthetic project inputs; no phone/network/grant facts seeded'},null,2));await run('playwright',['test:playwright']);
const s='socialgrowth_product';const facts=(await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.account_preparation_tasks) tasks,(SELECT count(*)::int FROM ${s}.account_preparation_execution_reviews) reviews,(SELECT count(*)::int FROM ${s}.phone_control_holder_grants) holder_grants,(SELECT count(*)::int FROM ${s}.phone_control_commands WHERE kind='begin_call') begin_calls,(SELECT count(*)::int FROM ${s}.artemis_preparation_intents) artemis_intents`)).rows[0];await writeFile(output+'/sql-readonly.json',JSON.stringify(facts,null,2));console.log(JSON.stringify({passed:true,facts}));
}finally{for(const x of children.toReversed()){if(x.c.exitCode===null){const ended=once(x.c,'exit');process.kill(-x.c.pid,'SIGTERM');await ended;}await writeFile(output+'/'+x.name+'.log',x.log);}await pool.end();await writeFile(output+'/web-closure.json',JSON.stringify({ownedServicesExited:true,ephemeralCredentialsDiscarded:true},null,2));}
