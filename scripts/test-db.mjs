import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const bin=process.env.PG_BIN??'/opt/homebrew/opt/postgresql@16/bin';
const dir=mkdtempSync(join(tmpdir(),'tracker-pg-'));const port=String(20000+Math.floor(Math.random()*20000));
const run=(cmd,args,env)=>{const r=spawnSync(cmd,args,{stdio:'inherit',env:env??process.env});if(r.status!==0)throw new Error(`${cmd} failed (${r.status})`);};
let started=false;try{run(`${bin}/initdb`,['-D',dir,'-A','trust','--no-locale']);run(`${bin}/pg_ctl`,['-D',dir,'-l',join(dir,'server.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']);started=true;run(process.execPath,['--import','tsx','--test','tests/api.test.ts'],{...process.env,TEST_DATABASE_URL:`postgres://127.0.0.1:${port}/postgres`});}finally{if(started)spawnSync(`${bin}/pg_ctl`,['-D',dir,'-m','immediate','stop'],{stdio:'inherit'});rmSync(dir,{recursive:true,force:true});}
