import {proxy} from '../../../lib/server';
export function POST(req:Request){return proxy(req,'set-waiting-point');}
