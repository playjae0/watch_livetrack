import { sha256 } from '../_shared/handler.ts';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return reply(415,{error:'JSON required'});
 if(Number(req.headers.get('content-length')??0)>1024)return reply(413,{error:'Too large'});
 try{
  const reader=req.body?.getReader();const chunks:Uint8Array[]=[];let length=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1024){await reader.cancel();return reply(413,{error:'Too large'});}chunks.push(value)}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(typeof body.code!=='string'||!/^\d{8}$/.test(body.code))return reply(400,{error:'Invalid code'});
  const random=crypto.getRandomValues(new Uint8Array(32));
  const secret=btoa(String.fromCharCode(...random)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,base=Deno.env.get('SUPABASE_URL')!;
  const result=await fetch(`${base}/rest/v1/rpc/redeem_enrollment`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({code_hash:await sha256(body.code),new_secret_hash:await sha256(secret)}),signal:AbortSignal.timeout(15000)});
  if(!result.ok)return reply(503,{error:'Service unavailable'});
  const data=await result.json();if(data._status)return reply(data._status,{error:'Code invalid, expired or unavailable'});
  return reply(200,{device_secret:secret});
 }catch(e){return reply(e instanceof SyntaxError?400:503,{error:'Request failed'});}
});
