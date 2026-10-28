import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {handler,sha256} from '../supabase/functions/_shared/handler.ts';
const url=process.env.TEST_DATABASE_URL;
const db=url?new pg.Pool({connectionString:url}):null;
const secret=()=>randomBytes(32).toString('base64url');
const device=secret(),viewer=secret(),other=secret(),otherView=secret();let deviceID:string;
async function call(action:string,token:string,body:unknown={}){
 const run=handler(action,async(action,hash,body)=>{try{const r=await db!.query('select tracker_request($1,$2,$3) as data',[action,hash,body]);return {data:r.rows[0].data};}catch(e){return {error:{code:(e as {code:string}).code}};}});
 const r=await run(new Request(`https://mock.test/${action}${action==='get-track'&&typeof body==='object'&&body&&'cursor'in body?'?cursor='+String(body.cursor):''}`,{method:action==='get-track'?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:action==='get-track'?undefined:JSON.stringify(body)}));return {status:r.status,data:await r.json()};
}
const point=(seq=0,extra:Record<string,unknown>={})=>({id:randomUUID(),seq,latitude:0,longitude:0,horizontal_accuracy_m:10,recorded_at:new Date().toISOString(),...extra});
before(async()=>{if(!db)return;await db.query("create role anon;create role authenticated;create role service_role;");await db.query(await readFile(new URL('../supabase/migrations/202610280001_tracker.sql',import.meta.url),'utf8'));for(const [d,v]of [[device,viewer],[other,otherView]]){const r=await db.query('insert into devices(device_secret_hash,view_token_hash) values($1,$2) returning id',[await sha256(d),await sha256(v)]);if(d===device)deviceID=r.rows[0].id;}});
after(async()=>{await db?.end();});
test('A01–A07, A10, A12, A14: transactional API lifecycle and privacy',{skip:!db},async()=>{
 assert.equal((await call('get-track',viewer)).data.status,'not_sharing');
 assert.equal((await call('start-session','')).status,401);
 assert.equal((await call('start-session',viewer)).status,401);
 assert.equal((await call('get-track',device)).status,401);
 const start=await call('start-session',device);assert.equal(start.status,200);const sid=start.data.session_id;
 assert.equal((await call('start-session',device)).data.session_id,sid);
 assert.equal((await call('ingest-location',other,{session_id:sid,points:[point()]})).status,404);
 for(const extra of [{latitude:91},{longitude:-181},{horizontal_accuracy_m:101},{horizontal_accuracy_m:-1},{recorded_at:'2000-01-01T00:00:00Z'},{recorded_at:new Date(Date.now()+3600000).toISOString()},{seq:1.5},{latitude:null}])assert.equal((await call('ingest-location',device,{session_id:sid,points:[point(0,extra)]})).status,400);
 const p=point();let result=await call('ingest-location',device,{session_id:sid,points:[p]});assert.equal(result.data.accepted_count,1);assert.deepEqual(result.data.acked_ids,[p.id]);
 assert.equal((await call('ingest-location',device,{session_id:sid,points:[p]})).data.accepted_count,0);
 assert.equal((await call('ingest-location',device,{session_id:sid,points:[{...p,id:randomUUID()}]})).status,409);
 assert.equal((await call('get-track',otherView)).data.latest,null);
 await call('set-waiting-point',viewer,{latitude:1,longitude:1});await call('set-waiting-point',viewer,{latitude:2,longitude:2});
 assert.equal((await call('ingest-location',device,{session_id:sid,points:[p]})).data.waiting_point.latitude,2);
 assert.equal((await call('get-track',otherView)).data.waiting_point,null);
 await call('set-waiting-point',viewer,{clear:true});assert.equal((await call('ingest-location',device,{session_id:sid,points:[p]})).data.waiting_point,null);
 const first=(await call('get-track',viewer)).data;assert.equal(first.route.length,1);
 // Delayed point arrives after cursor but retains its old measurement time.
 const late=point(1,{recorded_at:new Date(Date.now()-60000).toISOString()});await call('ingest-location',device,{session_id:sid,points:[late]});
 const page=(await call('get-track',viewer,{cursor:first.next_cursor})).data;assert.equal(page.route[0].id,late.id);assert.equal(page.latest.id,p.id);
 for(let b=0;b<6;b++){const points=Array.from({length:100},(_,i)=>point(2+b*100+i));assert.equal((await call('ingest-location',device,{session_id:sid,points})).status,200);}
 const paged=(await call('get-track',viewer)).data;assert.equal(paged.route.length,500);assert.equal(paged.has_more,true);assert.equal((await call('get-track',viewer,{cursor:paged.next_cursor})).data.route.length,102);
 assert.equal((await call('stop-session',device,{session_id:sid})).status,200);assert.equal((await call('stop-session',device,{session_id:sid})).status,200);
 assert.equal((await call('ingest-location',device,{session_id:sid,points:[point(999)]})).status,409);
 const ended=(await call('get-track',viewer)).data;assert.equal(ended.status,'stopped');assert.equal(ended.latest,null);assert.deepEqual(ended.route,[]);
 // Database grants and RLS: public cannot read or invoke privileged RPC.
 for(const role of ['anon','authenticated']){const publicClient=await db!.connect();try{await publicClient.query(`set role ${role}`);
  for(const table of ['devices','tracking_sessions','location_points','waiting_points'])await assert.rejects(publicClient.query(`select * from ${table}`),{code:'42501'});
  await assert.rejects(publicClient.query("insert into devices(device_secret_hash,view_token_hash) values('x','y')"),{code:'42501'});
  await assert.rejects(publicClient.query("select tracker_request('start-session','x','{}')"),{code:'42501'});
 }finally{await publicClient.query('reset role');publicClient.release();}}
 await db!.query("update devices set view_expires_at=now()-interval '1 second' where id=$1",[deviceID]);assert.equal((await call('get-track',viewer)).status,403);
 await db!.query('update devices set revoked_at=now() where id=$1',[deviceID]);assert.equal((await call('start-session',device)).status,403);
 const stored=await db!.query('select device_secret_hash from devices where id=$1',[deviceID]);assert.equal(stored.rows[0].device_secret_hash,await sha256(device));assert.notEqual(stored.rows[0].device_secret_hash,device);
});
test('HTTP boundary: bounded payloads, auth and no-store',async()=>{
 const run=handler('start-session',async()=>({data:{ok:true}}));
 const r=await run(new Request('https://mock.test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${device}`},body:'{}'}));assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
 assert.equal((await run(new Request('https://mock.test'))).status,405);
 assert.equal((await run(new Request('https://mock.test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${device}`},body:'x'.repeat(65537)}))).status,413);
});
test('expiry, cleanup, rate limit and atomic batch rollback',{skip:!db},async()=>{
 const sid=(await call('start-session',other)).data.session_id;
 const before=await db!.query('select count(*) from location_points where session_id=$1',[sid]);
 assert.equal((await call('ingest-location',other,{session_id:sid,points:[point(0),point(1,{latitude:99})]})).status,400);
 assert.equal((await db!.query('select count(*) from location_points where session_id=$1',[sid])).rows[0].count,before.rows[0].count);
 await db!.query("update tracking_sessions set expires_at=now()-interval '1 second' where id=$1",[sid]);assert.equal((await call('get-track',otherView)).data.status,'expired');assert.equal((await call('ingest-location',other,{session_id:sid,points:[point()]})).status,409);
 const d=(await db!.query('select device_id from tracking_sessions where id=$1',[sid])).rows[0].device_id;
 await db!.query("update request_limits set count=120,bucket=date_trunc('minute',now()) where device_id=$1 and role_name='device'",[d]);assert.equal((await call('start-session',other)).status,429);
 await db!.query('select cleanup_tracker()');
});

test('A01: operator CLI refuses enrollment without server credential',()=>{const r=spawnSync(process.execPath,['scripts/operator.mjs','enroll'],{env:{},encoding:'utf8'});assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.stderr,/operator-only/);});
