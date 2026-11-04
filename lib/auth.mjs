import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {verifyPassword} from './password.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const SESSION_AGE=12*60*60*1000;
const IDLE_AGE=2*60*60*1000;
const WINDOW=15*60*1000;
const FAILURES=5;
export function authentication(config,{now=Date.now}={}){
  const sessions=new Map(),failures=new Map();
  const cookieName=config.production?'__Host-workspace_session':'workspace_session';
  let verifying=false;
  const usernameHash=createHash('sha256').update(config.username||'').digest();
  function cleanup(){
    const time=now();
    for(const [id,value] of sessions)if(value.expires<=time||value.lastSeen+IDLE_AGE<=time)sessions.delete(id);
    for(const [ip,value] of failures)if(value.until<=time)failures.delete(ip);
  }
  const timer=setInterval(cleanup,60000);timer.unref();
  function token(req){
    const values=String(req.headers.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));
    if(values.length!==1)return null;
    const value=values[0].slice(cookieName.length+1);
    return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
  }
  function session(req){
    if(!config.authRequired)return {username:undefined};
    cleanup();const value=token(req);if(!value)return null;
    const found=sessions.get(hash(value));
    if(found)found.lastSeen=now();
    return found||null;
  }
  function cookie(value,maxAge){return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.production?'; Secure':''}`;}
  function remove(req){const value=token(req);if(value)sessions.delete(hash(value));}
  function limited(seconds=60){return Object.assign(new Error('尝试过于频繁，请稍后重试。'),{status:429,retryAfter:seconds});}
  async function login(req,credentials){
    if(!config.authRequired)return {data:{authenticated:true},cookie:null};
    cleanup();const address=req.socket.remoteAddress||'unknown';
    const attempt=failures.get(address);
    if(attempt?.count>=FAILURES)throw limited(Math.max(1,Math.ceil((attempt.until-now())/1000)));
    if(verifying)throw limited(2);
    const username=typeof credentials?.username==='string'?credentials.username.trim():'';
    const password=typeof credentials?.password==='string'?credentials.password:'';
    const acceptable=username.length<=100&&Buffer.byteLength(password)<=1024&&password.length>0;
    let valid=false;verifying=true;
    try{
      if(acceptable){
        const matches=await verifyPassword(password,config.password);
        const supplied=createHash('sha256').update(username).digest();
        valid=timingSafeEqual(supplied,usernameHash)&&matches;
      }
    }finally{verifying=false;}
    if(!valid){
      if(failures.size>=1000&&!failures.has(address))throw limited();
      failures.set(address,{count:(attempt?.count||0)+1,until:attempt?.until||now()+WINDOW});
      throw Object.assign(new Error('登录失败，请检查用户名和密码。'),{status:401});
    }
    failures.delete(address);remove(req);
    if(sessions.size>=16)sessions.delete(sessions.keys().next().value);
    const value=randomBytes(32).toString('base64url');
    sessions.set(hash(value),{username:config.username,expires:now()+SESSION_AGE,lastSeen:now()});
    return {data:{authenticated:true,username:config.username},cookie:cookie(value,SESSION_AGE/1000)};
  }
  return {
    required:config.authRequired,
    session,
    status(req){const current=session(req);return {authRequired:config.authRequired,authenticated:!!current,...(current?.username?{username:current.username}:{})};},
    login,
    logout(req){remove(req);return cookie('',0);},
    close(){clearInterval(timer);sessions.clear();failures.clear();},
  };
}
