'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useRef,useState} from 'react';
import {isStale,mergeRoute,type Track,type Point,type Course} from '../lib/track';
const Map=dynamic(()=>import('./Map'),{ssr:false});
export default function Viewer(){
 const [track,setTrack]=useState<Track|null>(null),[course,setCourse]=useState<Course|null>(null),[points,setPoints]=useState<Point[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const cursor=useRef(0),session=useRef<string|null>(null),blocked=useRef(false);
 useEffect(()=>{const token=location.hash.slice(1);if(token)history.replaceState(null,'',location.pathname);
 let alive=true;
 (async()=>{try{if(token){const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!r.ok)throw new Error('Private link expired, revoked or unavailable. Reopen the saved link to retry.');}if(alive)setReady(true);}catch(e){if(alive)setError((e as Error).message);}})();return()=>{alive=false};},[]);
 const refresh=useCallback(async(signal:AbortSignal)=>{
 const r=await fetch(`/api/track?cursor=${cursor.current}`,{cache:'no-store',signal});
 if(!r.ok){if(r.status===401||r.status===403){blocked.current=true;setTrack(null);setPoints([]);setCourse(null);}throw new Error(r.status===401||r.status===403?'Private link expired or revoked. Open a valid family link.':'Connection unavailable. Displayed observation may be old.');}
 const data:Track=await r.json();if(signal.aborted)return;
 const changed=data.session_id!==session.current;
 if(changed){session.current=data.session_id;cursor.current=0;setPoints([]);}
 // A response requested with the previous session cursor needs one fresh page.
 if(changed&&data.status==='active'){setTrack({...data,route:[]});return true;}
 cursor.current=data.next_cursor??0;setTrack(data);setPoints(old=>data.status==='active'?mergeRoute(old,data.route):[]);setNow(Date.now());setError('');return data.has_more??false;
 },[]);
 useEffect(()=>{if(!ready)return;const controller=new AbortController();fetch('/api/course',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null).then(data=>{if(!controller.signal.aborted&&data?.course)setCourse(data.course);}).catch(()=>{});return()=>controller.abort();},[ready]);
 useEffect(()=>{if(!ready)return;let timer:ReturnType<typeof setTimeout>|undefined;let controller:AbortController|null=null;let stopped=false;
 const run=async()=>{if(stopped||document.hidden||blocked.current)return;controller=new AbortController();let more=false;try{more=await refresh(controller.signal)??false;}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}if(!stopped&&!document.hidden&&!blocked.current)timer=setTimeout(run,more?100:12000);};
 const visibility=()=>{clearTimeout(timer);controller?.abort();if(!document.hidden)void run();};void run();document.addEventListener('visibilitychange',visibility);
 return()=>{stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);};},[ready,refresh]);
 async function waiting(body:unknown){if(busy)return;setBusy(true);try{const r=await fetch('/api/waiting-point',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Waiting point could not be saved.');const data=await r.json();setTrack(old=>old?{...old,waiting_point:data.waiting_point}:old);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{if(!track?.latest)return;const delay=Math.max(0,Date.parse(track.latest.recorded_at)+90000-Date.now());const timer=setTimeout(()=>setNow(Date.now()),Math.min(delay,2147483647));return()=>clearTimeout(timer);},[track?.latest]);
 const active=track?.status==='active',stale=active&&isStale(track.latest,now);
 return <main><header><p className="eyebrow">MARATHON LIVE TRACKER</p><h1>{!track?'Private family view':active?'Location sharing':track.status==='not_sharing'?'Not sharing':'Sharing ended'}</h1></header>
 {error&&<p role="alert" className="warning">{error}</p>}
 {active&&<><p className={stale?'warning':'status'} role="status">{!track.latest?'Waiting for GPS observation':stale?'Stale location · last observation is over 90 seconds old':'Last observed location'}</p>
 {track.latest&&<p>Observed: <time dateTime={track.latest.recorded_at}>{new Date(track.latest.recorded_at).toLocaleString()}</time><br/><small>Received: {new Date(track.latest.received_at).toLocaleString()}</small></p>}</>}
 {track&&<><Map points={active?points:[]} latest={active?track.latest:null} waiting={track.waiting_point} course={course} onSelect={(latitude,longitude)=>void waiting({latitude,longitude})}/><div className="legend">{course&&<span><i className="course-key"/> {course.name} · planned course</span>}{active&&<span><i className="travel-key"/> Traveled path</span>}</div><div className="actions"><p>Tap the map to set one family waiting point.</p><button disabled={!track.waiting_point||busy} onClick={()=>void waiting({clear:true})}>Clear point</button></div></>}
 {!process.env.NEXT_PUBLIC_TILE_URL&&track&&<p className="warning">Map tile provider is not configured.</p>}
 </main>;
}
