// Full local mock E2E: production Edge handler + real PostgreSQL + actual Next server + Chromium.
// Uses synthetic equator coordinates only. No production service keys or locations.
import {expect,chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {handler,sha256} from '../supabase/functions/_shared/handler.ts';
const root=new URL('../',import.meta.url).pathname;
const dir=await mkdtemp(join(tmpdir(),'tracker-e2e-'));
const pgBin=process.env.PG_BIN??'/opt/homebrew/opt/postgresql@16/bin';
const pgPort=21000+Math.floor(Math.random()*10000),webPort=31000+Math.floor(Math.random()*10000);
const device='d'.repeat(43),view='v'.repeat(43);
const command=(cmd:string,args:string[])=>{const r=spawnSync(cmd,args,{encoding:'utf8'});if(r.status!==0)throw new Error(`${cmd} failed: ${r.stderr}`);};
let db:pg.Pool|undefined,edge:ReturnType<typeof createServer>|undefined,next:ReturnType<typeof spawn>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,started=false;
let reads=0;
try{
 command(`${pgBin}/initdb`,['-D',join(dir,'db'),'-A','trust','--no-locale','--encoding=UTF8']);
 command(`${pgBin}/pg_ctl`,['-D',join(dir,'db'),'-l',join(dir,'pg.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start']);started=true;
 db=new pg.Pool({connectionString:`postgres://127.0.0.1:${pgPort}/postgres`});
 await db.query('create role anon;create role authenticated;create role service_role;');await db.query(await readFile(join(root,'supabase/migrations/202610280001_tracker.sql'),'utf8'));await db.query(await readFile(join(root,'supabase/migrations/202610300003_course.sql'),'utf8'));
 const deviceRow=await db.query('insert into devices(device_secret_hash,view_token_hash) values($1,$2) returning id',[await sha256(device),await sha256(view)]);await db.query('insert into courses(device_id,course) values($1,$2)',[deviceRow.rows[0].id,{name:'Test course',segments:[[[0,0],[0.01,0.01]]]}]);
 const rpc=async(action:string,hash:string,body:Record<string,unknown>)=>{try{const r=action==='get-course'?await db!.query('select read_course($1) as data',[hash]):await db!.query('select tracker_request($1,$2,$3) as data',[action,hash,body]);return {data:r.rows[0].data};}catch(e){return {error:{code:(e as {code:string}).code}};}};
 const request=async(action:string,token:string,body:Record<string,unknown>={})=>{const r=await handler(action,rpc)(new Request(`https://localhost/${action}`,{method:action==='get-track'||action==='get-course'?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:action==='get-track'||action==='get-course'?undefined:JSON.stringify(body)}));assert.equal(r.status,200);return r.json();};
 command('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost']);
 edge=createServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},async(req,res)=>{
  const action=req.url?.split('?')[0].split('/').at(-1)??'';if(action==='get-track')reads++;
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
  const response=await handler(action,rpc)(new Request(`https://127.0.0.1${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,body:req.method==='POST'?Buffer.concat(chunks):undefined}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 });
 await new Promise<void>(resolve=>edge!.listen(0,'127.0.0.1',resolve));const edgePort=(edge.address() as {port:number}).port;
 const origin=`http://localhost:${webPort}`;
 next=spawn(process.execPath,[join(root,'web/node_modules/next/dist/bin/next'),'start','-p',String(webPort)],{cwd:join(root,'web'),env:{...process.env,NODE_EXTRA_CA_CERTS:join(dir,'cert.pem'),SUPABASE_URL:`https://127.0.0.1:${edgePort}`,VIEWER_COOKIE_KEY:'mock-cookie-key-for-local-tests-only-123456',VIEWER_ORIGIN:origin},stdio:'pipe'});
 let logs='';next.stderr?.on('data',b=>{logs+=b.toString()});next.stdout?.on('data',b=>{logs+=b.toString()});
 await expect.poll(async()=>{try{return (await fetch(origin)).status;}catch{return 0;}},{timeout:30000}).toBe(200);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
 const browserErrors:string[]=[];page.on('pageerror',e=>browserErrors.push(e.message));
 const pageResponse=await page.goto(`${origin}/track#${view}`);
 await expect(page.getByRole('heading',{name:'Not sharing',exact:true})).toBeVisible();await expect(page.getByText('Test course · planned course')).toBeVisible();
 const publicCourse=await fetch(`${origin}/api/course`);assert.equal(publicCourse.status,401);
 assert.equal(page.url(),`${origin}/track`);assert.equal(pageResponse?.headers()['referrer-policy'],'no-referrer');assert.match(pageResponse?.headers()['cache-control']??'',/no-store/);
 const cookie=(await context.cookies()).find(c=>c.name==='tracker_view');assert.ok(cookie?.httpOnly&&cookie.secure&&cookie.sameSite==='Strict');assert.ok(!cookie.value.includes(view));
 // CSRF rejected and session cookie permits reload with no fragment.
 const csrf=await context.request.post(`${origin}/api/waiting-point`,{headers:{Origin:'https://untrusted.test'},data:{latitude:1,longitude:1}});assert.equal(csrf.status(),403);
 const {session_id}=await request('start-session',device);
 const p={id:randomUUID(),seq:0,latitude:0,longitude:0,horizontal_accuracy_m:10,recorded_at:new Date().toISOString()};
 await request('ingest-location',device,{session_id,points:[p,{...p,id:randomUUID(),seq:1,longitude:0.0001,recorded_at:new Date(Date.now()+500).toISOString()}]});
 await expect(page.getByRole('heading',{name:'Location sharing',exact:true})).toBeVisible({timeout:18000});
 await expect(page.getByRole('status')).toContainText('Last observed location');
 const map=page.getByLabel('Runner location and route. Tap to set one family waiting point.');await expect(map).toBeVisible();
 const box=await map.boundingBox();assert.ok(box);await map.tap({position:{x:box.width/2+35,y:box.height/2}});
 await expect(page.getByRole('button',{name:'Clear point'})).toBeEnabled();
 let piggy=await request('ingest-location',device,{session_id,points:[p]});assert.ok(piggy.waiting_point);assert.notEqual(piggy.waiting_point.longitude,0);
 const clearResponse=page.waitForResponse(r=>r.url().endsWith('/api/waiting-point')&&r.request().method()==='POST');await page.getByRole('button',{name:'Clear point'}).click();assert.equal((await clearResponse).status(),200);await expect(page.getByRole('button',{name:'Clear point'})).toBeDisabled();piggy=await request('ingest-location',device,{session_id,points:[p]});assert.equal(piggy.waiting_point,null);
 await db.query("update location_points set recorded_at=now()-interval '91 seconds'");await page.reload();await expect(page.getByRole('status')).toContainText('Stale location');await expect(map).toBeVisible();await expect(page.locator('.leaflet-interactive')).toHaveCount(3);
 await mkdir(join(root,'docs/screenshots'),{recursive:true});await page.screenshot({path:join(root,'docs/screenshots/viewer-mock.png'),fullPage:true});
 // Hidden-page visibility handler cancels polling; no synthetic positions are introduced.
 await page.clock.install();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const before=reads;await page.clock.fastForward(36000);assert.equal(reads,before);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>reads).toBeGreaterThan(before);await page.clock.resume();
 await request('stop-session',device,{session_id});await page.reload();await expect(page.getByRole('heading',{name:'Sharing ended',exact:true})).toBeVisible();await expect(page.getByRole('status')).toHaveCount(0);
 assert.deepEqual(browserErrors,[]);assert.ok(!logs.includes(view)&&!logs.includes(device));
 console.log('PASS mock E2E: private fragment exchange, encrypted HttpOnly/Secure cookie, CSRF, lifecycle polling, Leaflet tap/clear, Watch piggyback, stale measurement, hidden-page pause, stop, no secret logs');
}finally{
 await browser?.close();next?.kill('SIGTERM');if(next)await new Promise<void>(resolve=>{if(next!.exitCode!==null)resolve();else next!.once('exit',()=>resolve());});
 await new Promise<void>(resolve=>edge?edge.close(()=>resolve()):resolve());await db?.end();
 if(started)spawnSync(`${pgBin}/pg_ctl`,['-D',join(dir,'db'),'-m','immediate','stop'],{stdio:'ignore'});
 await rm(dir,{recursive:true,force:true});
}
