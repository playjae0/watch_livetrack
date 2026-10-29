export interface Point {id:string;seq:number;latitude:number;longitude:number;recorded_at:string;received_at:string;arrival:number;horizontal_accuracy_m:number}
export interface Course {name:string;segments:[number,number][][]}
export interface Waiting {latitude:number;longitude:number;updated_at:string}
export interface Track {status:'active'|'not_sharing'|'stopped'|'expired';session_id:string|null;latest:Point|null;route:Point[];waiting_point:Waiting|null;next_cursor?:number;has_more?:boolean;server_time:string;last_received_at:string|null}
export function isStale(point:Point|null,now=Date.now()){return !point||now-Date.parse(point.recorded_at)>=90000;}
export function mergeRoute(old:Point[],incoming:Point[]){const points=new Map(old.map(p=>[p.id,p]));for(const p of incoming)points.set(p.id,p);return [...points.values()].sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.seq-b.seq);}
export function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const r=Math.PI/180;const dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;return 6371000*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2));}
// Split implausible jumps (>15m/s plus measurement uncertainty). Never invent a connecting sample.
export function routeSegments(points:Point[]){const segments:Point[][]=[];for(const p of points){const segment=segments.at(-1),last=segment?.at(-1);if(!last||distance(last,p)>15*Math.max(0,(Date.parse(p.recorded_at)-Date.parse(last.recorded_at))/1000)+last.horizontal_accuracy_m+p.horizontal_accuracy_m){segments.push([p]);}else segment!.push(p);}return segments;}
