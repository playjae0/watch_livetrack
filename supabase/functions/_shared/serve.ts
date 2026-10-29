import { handler } from './handler.ts';
// Direct server-only REST RPC keeps Edge dependencies minimal.
export function serve(action:string) {
 const base=Deno.env.get('SUPABASE_URL')!;
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 Deno.serve(handler(action,async(action,hash,body)=>{
  const fn=action==='get-course'?'read_course':'tracker_request';
  const args=action==='get-course'?{credential_hash:hash}:{action,credential_hash:hash,body};
  const response=await fetch(`${base}/rest/v1/rpc/${fn}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  const result=await response.json();return response.ok?{data:result}:{error:{code:result.code??'INTERNAL'}};
 }));
}
