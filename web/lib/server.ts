import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
export const COOKIE='tracker_view';
export const privacy={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
function key(){const value=process.env.VIEWER_COOKIE_KEY;if(!value||value.length<32)throw new Error('Cookie key not configured');return createHash('sha256').update(value).digest();}
export function seal(token:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(JSON.stringify({token,exp:Date.now()+30*86400000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function unseal(value:string):string|null{try{const b=Buffer.from(value,'base64url');const cipher=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));const data=JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString());return data.exp>Date.now()&&/^[A-Za-z0-9_-]{43,128}$/.test(data.token)?data.token:null;}catch{return null;}}
export async function viewerToken(){const value=(await cookies()).get(COOKIE)?.value;return value?unseal(value):null;}
export function sameOrigin(req:Request){return req.headers.get('origin')===(process.env.VIEWER_ORIGIN??new URL(req.url).origin);}
export async function upstream(action:string,token:string,body?:unknown,cursor?:string){
 const base=process.env.SUPABASE_URL;if(!base?.startsWith('https://'))throw new Error('Backend not configured');
 const suffix=cursor?`?cursor=${encodeURIComponent(cursor)}`:'';
 return fetch(`${base}/functions/v1/${action}${suffix}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});
}
export async function proxy(req:Request,action:string){
 if(req.method==='POST'&&!sameOrigin(req))return Response.json({error:'Forbidden'},{status:403,headers:privacy});
 const token=await viewerToken();if(!token)return Response.json({error:'Open your private family link'},{status:401,headers:privacy});
 try{
  let body:unknown=undefined;
  if(req.method==='POST'){const text=await req.text();if(text.length>1024)return Response.json({error:'Payload too large'},{status:413,headers:privacy});body=JSON.parse(text);}
  const cursor=new URL(req.url).searchParams.get('cursor')??undefined;
  if(cursor&&!/^\d{1,18}$/.test(cursor))return Response.json({error:'Invalid cursor'},{status:400,headers:privacy});
  const r=await upstream(action,token,body,cursor);return new Response(await r.text(),{status:r.status,headers:{...privacy,'Content-Type':'application/json'}});
 }catch{return Response.json({error:'Connection unavailable'},{status:503,headers:privacy});}
}
