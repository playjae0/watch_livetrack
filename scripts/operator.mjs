import {randomBytes,createHash} from 'node:crypto';
const [command,id]=process.argv.slice(2);
const base=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!base?.startsWith('https://')||!key) throw new Error('Set operator-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY locally');
const hash=v=>createHash('sha256').update(v).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
async function rest(path,method,body){const r=await fetch(`${base}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`Operator request failed (${r.status})`);return r.status===204?null:r.json();}
if(command==='enroll'){
 if(!process.env.VIEWER_ORIGIN?.startsWith('https://'))throw new Error('Set the production HTTPS VIEWER_ORIGIN before enrollment');
 const device=secret(),view=secret();const [row]=await rest('devices','POST',{device_secret_hash:hash(device),view_token_hash:hash(view)});
 console.log(JSON.stringify({device_id:row.id,device_secret:device,viewer_link:`${process.env.VIEWER_ORIGIN??'https://YOUR-VERCEL-HOST'}/track#${view}`},null,2));
} else if(command==='revoke'&&id){const rows=await rest(`devices?id=eq.${encodeURIComponent(id)}`,'PATCH',{revoked_at:new Date().toISOString()});if(rows?.length!==1)throw new Error('Device not found');
} else if(command==='rotate-view'&&id){if(!process.env.VIEWER_ORIGIN?.startsWith('https://'))throw new Error('Set production HTTPS VIEWER_ORIGIN');const token=secret();const rows=await rest(`devices?id=eq.${encodeURIComponent(id)}`,'PATCH',{view_token_hash:hash(token),view_expires_at:new Date(Date.now()+30*86400000).toISOString()});if(rows?.length!==1)throw new Error('Device not found');console.log(`${process.env.VIEWER_ORIGIN}/track#${token}`);
} else if(command==='cleanup'){await rest('rpc/cleanup_tracker','POST',{});
} else throw new Error('Usage: node scripts/operator.mjs enroll | revoke UUID | rotate-view UUID | cleanup');
