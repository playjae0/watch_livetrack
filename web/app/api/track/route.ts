import {proxy} from '../../../lib/server';
export const dynamic='force-dynamic';
export function GET(req:Request){return proxy(req,'get-track');}
