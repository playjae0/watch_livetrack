// Operator-only: issue a single-use 8-digit enrollment code for an existing device.
// Requires `supabase login`, a linked project, and the private device setup file.
import {randomInt,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {readFileSync,writeFileSync,chmodSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const folder=`${homedir()}/.config/marathon-livetrack`;
const setup=readFileSync(`${folder}/device-setup.txt`,'utf8');
const id=setup.match(/기기 ID:\s*([a-f0-9-]{36})/i)?.[1];
if(!id)throw new Error('Device ID missing from private setup file');
const code=String(randomInt(100000000)).padStart(8,'0');
const hash=createHash('sha256').update(code).digest('hex');
const file=`${folder}/enrollment-code.txt`;
writeFileSync(file,`워치 등록 코드 (10분 동안 유효, 한 번만 사용):\n\n${code}\n\n이 코드를 다른 사람에게 보내지 마세요.\n`,{mode:0o600});chmodSync(file,0o600);
try{
 const sql=`delete from public.enrollment_codes where device_id='${id}'; insert into public.enrollment_codes(code_hash,device_id,expires_at) values('${hash}','${id}',now()+interval '10 minutes')`;
 execFileSync('npx',['--yes','supabase','db','query','--linked',sql],{stdio:['ignore','pipe','pipe']});
 console.log('등록 코드 생성 완료: 개인 설정 파일에 저장했습니다.');
}catch{unlinkSync(file);throw new Error('등록 코드를 만들지 못했습니다.');}
