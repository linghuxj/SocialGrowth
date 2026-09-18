export function nonnegative(value:string):number|null{if(value.trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
export function viewIncome(views:number,rpm:number,enabled:boolean){return {reference:views/1000*rpm,payable:enabled?views/1000*rpm:0};}
export function reelsIncome(total:string,qualified:string,rate:string,enabled:boolean){const t=nonnegative(total),q=nonnegative(qualified),r=nonnegative(rate);if(t===null||q===null||r===null||!Number.isSafeInteger(t)||!Number.isSafeInteger(q)||q>t)return null;return {...viewIncome(q,r,enabled),qualifiedShare:t>0?q/t*100:null};}
export function commission(base:number,rate:number,bonusBase:number,bonusRate:number,enabled:boolean,share:number){const standard=base*rate/100;const bonus=enabled?bonusBase*bonusRate/100:0;return {standard,bonus,total:standard+bonus,ours:(standard+bonus)*share/100};}
export function eligibility(subs:number,hours:number,views:number,uploads:number,future:boolean){return {full:subs>=1000&&(hours>=(future?8000:4000)||views>=(future?20000000:10000000)),early:subs>=500&&uploads>=3&&(hours>=3000||views>=3000000),continuing:!future||views>=10000000};}
export function apiCapacity(accounts:string,posts:string,days:string,interval:string){
 const values=[accounts,posts,days,interval].map(nonnegative);
 if(values.some(v=>v===null||!Number.isSafeInteger(v)))return null;
 const [n,p,d,t]=values as number[];
 if(d<1||t<1)return null;
 const dailyUploads=n*p,perAccountVideos=p*d,rounds=Math.ceil(1440/t);
 const ytReads=n*Math.ceil(perAccountVideos/20)*rounds,fbReads=n*perAccountVideos*rounds,fbPerPage=perAccountVideos*rounds;
 if([dailyUploads,perAccountVideos,rounds,ytReads,fbReads,fbPerPage,n*p*7].some(v=>!Number.isSafeInteger(v)))return null;
 return {dailyUploads,perAccountVideos,rounds,ytReads,fbReads,fbPerPage,weeklyPosts:n*p*7,ytUploadExceeded:dailyUploads>100,fbPublishExceeded:p>30};
}
