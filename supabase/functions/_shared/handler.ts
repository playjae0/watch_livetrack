export type RPC = (action: string, hash: string, body: Record<string, unknown>) => Promise<{data?: unknown; error?: {code: string}}>;
const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function sha256(value: string): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function handler(action: string, rpc: RPC) {
 return async (request: Request): Promise<Response> => {
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method!==((action==='get-track'||action==='get-course')?'GET':'POST')) return reply(405,{error:'Method not allowed'});
  const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if(!token) return reply(401,{error:'Credential required'});
  try {
   let body: Record<string,unknown>={};
   if(request.method==='GET') {
    const url=new URL(request.url); const cursor=url.searchParams.get('cursor');
    if(cursor && !/^\d{1,18}$/.test(cursor)) return reply(400,{error:'Invalid cursor'});
    if(cursor) body.cursor=cursor;
   } else {
    if(!request.headers.get('content-type')?.startsWith('application/json')) return reply(415,{error:'JSON required'});
    if(Number(request.headers.get('content-length')??0)>65536) return reply(413,{error:'Payload too large'});
    // Read a bounded stream even when Content-Length is missing or forged.
    const reader=request.body?.getReader(); let size=0; const chunks:Uint8Array[]=[];
    if(reader) for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return reply(413,{error:'Payload too large'});}chunks.push(value);}
    const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
    const parsed:unknown=JSON.parse(new TextDecoder().decode(all));
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return reply(400,{error:'Object required'});
    body=parsed as Record<string,unknown>;
   }
   const {data,error}=await rpc(action,await sha256(token),body);
   if(error){const status=/^PT(400|401|403|404|409|429)$/.exec(error.code)?.[1];return reply(status?Number(status):500,{error:status?'Request rejected':'Service unavailable'});}
   if(data && typeof data==='object' && '_status' in data) {
    const status=Number(data._status);
    return reply([400,404,409,429].includes(status)?status:500,{error:status===429?'Rate limited':'Request rejected'});
   }
   return reply(200,data);
  } catch(e) {return reply(e instanceof SyntaxError?400:503,{error:e instanceof SyntaxError?'Invalid JSON':'Service unavailable'});}
 };
}
