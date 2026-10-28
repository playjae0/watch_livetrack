import {test} from 'node:test';import assert from 'node:assert/strict';
import {isStale,mergeRoute,distance,routeSegments,type Point} from '../web/lib/track.ts';
const p=(id:string,time:number):Point=>({id,seq:time,latitude:0,longitude:0,recorded_at:new Date(time).toISOString(),received_at:new Date(1000000).toISOString(),arrival:time,horizontal_accuracy_m:10});
test('A11: stale uses measurement including exact 90-second boundary',()=>{assert.equal(isStale(p('1',0),90000),true);assert.equal(isStale(p('1',0),89999),false);assert.equal(isStale(null),true);});
test('A12: dedupe and order delayed route',()=>{assert.deepEqual(mergeRoute([p('2',2000)],[p('1',1000),p('2',2000)]).map(x=>x.id),['1','2']);});
test('A13: known straight-line distance',()=>{assert.ok(Math.abs(distance({latitude:0,longitude:0},{latitude:0,longitude:1})-111194.9)<1);});
test('GPS jump splits path without fabricating samples',()=>{assert.equal(routeSegments([p('1',0),{...p('2',1000),latitude:10}]).length,2);});
