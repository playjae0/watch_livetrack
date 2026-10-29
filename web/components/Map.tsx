'use client';
import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {routeSegments,type Point,type Waiting,type Course} from '../lib/track';
export default function Map({points,latest,waiting,course,onSelect}:{points:Point[];latest:Point|null;waiting:Waiting|null;course:Course|null;onSelect:(lat:number,lon:number)=>void}){
 const div=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),centered=useRef(false);
 select.current=onSelect;
 useEffect(()=>{if(!div.current)return;const m=L.map(div.current).setView([0,0],2);map.current=m;const tile=process.env.NEXT_PUBLIC_TILE_URL;
 if(tile?.startsWith('https://')) L.tileLayer(tile,{attribution:process.env.NEXT_PUBLIC_TILE_ATTRIBUTION??'',maxZoom:19,referrerPolicy:'no-referrer'}).addTo(m);
 layer.current=L.layerGroup().addTo(m);m.on('click',(e:L.LeafletMouseEvent)=>select.current(e.latlng.lat,e.latlng.lng));
 return()=>{m.remove();map.current=null;centered.current=false;};},[]);
 useEffect(()=>{const l=layer.current,m=map.current;if(!l||!m)return;l.clearLayers();
 if(course){const courseLine=L.polyline(course.segments,{color:'#7c3aed',weight:4,opacity:.9,dashArray:'8 6'}).addTo(l);if(!centered.current&&courseLine.getBounds().isValid()){m.fitBounds(courseLine.getBounds(),{padding:[25,25]});centered.current=true;}}
 for(const segment of routeSegments(points))L.polyline(segment.map(p=>[p.latitude,p.longitude] as [number,number]),{color:'#1865c2',weight:4}).addTo(l);
 if(latest){L.circleMarker([latest.latitude,latest.longitude],{radius:9,color:'#fff',fillColor:'#165eb5',fillOpacity:1,weight:3}).bindTooltip('Runner · last observed position').addTo(l);if(!centered.current){m.setView([latest.latitude,latest.longitude],15);centered.current=true;}}
 if(waiting)L.circleMarker([waiting.latitude,waiting.longitude],{radius:10,color:'#8c3800',fillColor:'#ffb54d',fillOpacity:1}).bindTooltip('Family waiting point').addTo(l);
 },[points,latest,waiting,course]);
 return <div ref={div} className="map" aria-label="Runner location and route. Tap to set one family waiting point."/>;
}
