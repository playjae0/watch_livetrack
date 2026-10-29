'use client';
import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {routeSegments,type Point,type Waiting,type Course} from '../lib/track';
export default function Map({points,latest,waiting,course,onSelect}:{points:Point[];latest:Point|null;waiting:Waiting|null;course:Course|null;onSelect:(lat:number,lon:number)=>void}){
 const div=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),focusLevel=useRef(0),courseFallback=useRef(false);
 select.current=onSelect;
 useEffect(()=>{if(!div.current)return;const m=L.map(div.current,{zoomControl:false}).setView([0,0],2);L.control.zoom({zoomInTitle:'확대',zoomOutTitle:'축소'}).addTo(m);map.current=m;const tile=process.env.NEXT_PUBLIC_TILE_URL;
 if(tile?.startsWith('https://')) L.tileLayer(tile,{attribution:process.env.NEXT_PUBLIC_TILE_ATTRIBUTION??'',maxZoom:19,referrerPolicy:'no-referrer'}).addTo(m);
 layer.current=L.layerGroup().addTo(m);m.on('click',(e:L.LeafletMouseEvent)=>select.current(e.latlng.lat,e.latlng.lng));
 return()=>{m.remove();map.current=null;focusLevel.current=0;courseFallback.current=false;};},[]);
 useEffect(()=>{const l=layer.current,m=map.current;if(!l||!m)return;l.clearLayers();
 if(course)L.polyline(course.segments,{color:'#7c3aed',weight:4,opacity:.9,dashArray:'8 6'}).addTo(l);
 for(const segment of routeSegments(points))L.polyline(segment.map(p=>[p.latitude,p.longitude] as [number,number]),{color:'#1865c2',weight:4}).addTo(l);
 if(latest)L.circleMarker([latest.latitude,latest.longitude],{className:'runner-marker',radius:9,color:'#fff',fillColor:'#165eb5',fillOpacity:1,weight:3}).bindTooltip('주자 · 마지막 측정 위치').addTo(l);
 if(waiting)L.circleMarker([waiting.latitude,waiting.longitude],{className:'waiting-marker',radius:10,color:'#8c3800',fillColor:'#ffb54d',fillOpacity:1}).bindTooltip('가족 응원 위치').addTo(l);
 // Set the initial view once for a single position and refine it once both are known.
 // Later polls do not pull the map away from a viewer who has moved it.
 if(latest&&waiting&&focusLevel.current<2){m.fitBounds([[latest.latitude,latest.longitude],[waiting.latitude,waiting.longitude]],{padding:[40,40],maxZoom:15,animate:false});focusLevel.current=2;}
 else if((latest||waiting)&&focusLevel.current<1){const p=latest??waiting!;m.setView([p.latitude,p.longitude],15,{animate:false});focusLevel.current=1;}
 else if(!latest&&!waiting&&focusLevel.current===0&&!courseFallback.current&&course?.segments[0]?.[0]){m.setView(course.segments[0][0],15,{animate:false});courseFallback.current=true;}
 },[points,latest,waiting,course]);
 return <div ref={div} className="map" aria-label="주자 위치와 경로. 탭해서 가족 응원 위치를 하나 지정하세요."/>;
}
