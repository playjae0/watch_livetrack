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
 (async()=>{try{if(token){const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!r.ok)throw new Error('전용 링크가 만료되었거나 취소되었거나 사용할 수 없습니다. 저장한 링크를 다시 열어 주세요.');}if(alive)setReady(true);}catch(e){if(alive)setError((e as Error).message);}})();return()=>{alive=false};},[]);
 const refresh=useCallback(async(signal:AbortSignal)=>{
 const r=await fetch(`/api/track?cursor=${cursor.current}`,{cache:'no-store',signal});
 if(!r.ok){if(r.status===401||r.status===403){blocked.current=true;setTrack(null);setPoints([]);setCourse(null);}throw new Error(r.status===401||r.status===403?'전용 링크가 만료되었거나 취소되었습니다. 유효한 가족 링크로 다시 접속해 주세요.':'연결할 수 없습니다. 표시된 위치는 오래된 정보일 수 있습니다.');}
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
 async function waiting(body:unknown){if(busy)return;setBusy(true);try{const r=await fetch('/api/waiting-point',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('응원 위치를 저장하지 못했습니다.');const data=await r.json();setTrack(old=>old?{...old,waiting_point:data.waiting_point}:old);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{if(!track?.latest)return;const delay=Math.max(0,Date.parse(track.latest.recorded_at)+90000-Date.now());const timer=setTimeout(()=>setNow(Date.now()),Math.min(delay,2147483647));return()=>clearTimeout(timer);},[track?.latest]);
 const active=track?.status==='active',stale=active&&isStale(track.latest,now);
 return <main><header><p className="eyebrow">마라톤 실시간 위치</p><h1>{!track?'가족 전용 화면':active?'위치 공유 중':track.status==='not_sharing'?'공유 중 아님':'공유 종료'}</h1></header>
 {error&&<p role="alert" className="warning">{error}</p>}
 {active&&<><p className={stale?'warning':'status'} role="status">{!track.latest?'GPS 위치 수신 대기 중':stale?'위치 갱신 지연 · 마지막 측정이 90초 이상 지났습니다':'마지막 측정 위치'}</p>
 {track.latest&&<p>측정 시각: <time dateTime={track.latest.recorded_at}>{new Date(track.latest.recorded_at).toLocaleString('ko-KR')}</time><br/><small>수신 시각: {new Date(track.latest.received_at).toLocaleString('ko-KR')}</small></p>}</>}
 {track&&<><Map points={active?points:[]} latest={active?track.latest:null} waiting={track.waiting_point} course={course} onSelect={(latitude,longitude)=>void waiting({latitude,longitude})}/><div className="legend">{course&&<span><i className="course-key"/> {course.name} · 예정 코스</span>}{active&&<span><i className="travel-key"/> 지나온 경로</span>}</div><div className="actions"><p>지도를 탭해 가족 응원 위치를 하나 지정하세요.</p><button disabled={!track.waiting_point||busy} onClick={()=>void waiting({clear:true})}>위치 지우기</button></div></>}
 {!process.env.NEXT_PUBLIC_TILE_URL&&track&&<p className="warning">지도 타일 제공자가 설정되지 않았습니다.</p>}
 </main>;
}
