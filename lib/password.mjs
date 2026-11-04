import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

// OWASP's scrypt profile: N=2^17, r=8, p=1 (128 MiB). Fixed parameters
// also prevent an environment hash from requesting unbounded work.
const derive=promisify(scrypt);
export const SCRYPT_OPTIONS={N:131072,r:8,p:1,maxmem:192*1024*1024};
export function parsePasswordHash(encoded){
  const parts=String(encoded||'').split('$');
  if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='131072'||parts[2]!=='8'||parts[3]!=='1'||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{64}$/.test(parts[5]))throw new Error('OWNER_PASSWORD_HASH 格式无效，请使用 scripts/hash-password.mjs 生成。');
  return {salt:Buffer.from(parts[4],'hex'),key:Buffer.from(parts[5],'hex')};
}
export async function hashPassword(password){
  if(typeof password!=='string'||[...password].length<12||Buffer.byteLength(password)>1024)throw new Error('密码至少 12 个字符，且不能超过 1024 字节。');
  const salt=randomBytes(16);
  const key=await derive(password,salt,32,SCRYPT_OPTIONS);
  return ['scrypt',131072,8,1,salt.toString('hex'),key.toString('hex')].join('$');
}
export async function verifyPassword(password,descriptor){
  const key=await derive(password,descriptor.salt,32,SCRYPT_OPTIONS);
  try{return timingSafeEqual(key,descriptor.key);}finally{key.fill(0);}
}
