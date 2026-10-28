import {cookies} from 'next/headers';
import {COOKIE,privacy,sameOrigin,seal,upstream} from '../../../lib/server';
export async function POST(req:Request){
 if(!sameOrigin(req))return Response.json({error:'Forbidden'},{status:403,headers:privacy});
 try{const text=await req.text();if(text.length>256)return Response.json({error:'Invalid link'},{status:400,headers:privacy});
 const {token}=JSON.parse(text);if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(token))return Response.json({error:'Invalid link'},{status:400,headers:privacy});
 const r=await upstream('get-track',token);if(!r.ok)return Response.json({error:'Link expired, revoked or unavailable'},{status:r.status,headers:privacy});
 (await cookies()).set(COOKIE,seal(token),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:30*86400});
 return Response.json({ok:true},{headers:privacy});
 }catch{return Response.json({error:'Connection unavailable'},{status:503,headers:privacy});}
}
