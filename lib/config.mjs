import path from 'node:path';
import {parsePasswordHash} from './password.mjs';

export function configuration(env,root){
  const production=env.NODE_ENV==='production';
  const username=String(env.OWNER_USERNAME||'').trim();
  const encoded=String(env.OWNER_PASSWORD_HASH||'');
  const authRequired=production||!!username||!!encoded;
  if(env.OWNER_PASSWORD)throw new Error('不接受 OWNER_PASSWORD，请使用 OWNER_PASSWORD_HASH。');
  if(authRequired&&(!username||!encoded))throw new Error('启用登录需要 OWNER_USERNAME 和 OWNER_PASSWORD_HASH。');
  if(username.length>100||/[\r\n\u0000]/.test(username))throw new Error('OWNER_USERNAME 格式无效。');
  const password=authRequired?parsePasswordHash(encoded):null;
  const source=env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||'';
  let publicOrigin=null;
  if(source){
    let url;try{url=new URL(source);}catch{throw new Error('PUBLIC_ORIGIN 必须是完整的网站来源地址。');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('PUBLIC_ORIGIN 仅允许协议、域名和可选端口。');
    if(production&&url.protocol!=='https:')throw new Error('生产 PUBLIC_ORIGIN 必须使用 HTTPS。');
    publicOrigin=url.origin;
  }
  if(production&&!publicOrigin)throw new Error('生产启动需要 PUBLIC_ORIGIN 或 RENDER_EXTERNAL_URL。');
  if(production&&(!env.LIBRARY_DATA_DIR||!path.isAbsolute(env.LIBRARY_DATA_DIR)))throw new Error('生产启动需要绝对路径 LIBRARY_DATA_DIR。');
  const dataDir=path.resolve(env.LIBRARY_DATA_DIR||path.join(root,'data'));
  const port=Number(env.PORT??4173);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT 必须是有效端口。');
  return {production,username,password,authRequired,publicOrigin,dataDir,port,host:production?'0.0.0.0':'127.0.0.1'};
}

// PUBLIC_ORIGIN is authoritative behind HTTPS reverse proxies. Forwarded
// headers never expand the accepted Host or Origin values.
export function requestOrigin(req,config){
  const host=String(req.headers.host||'').toLowerCase();
  if(config.publicOrigin&&host===new URL(config.publicOrigin).host.toLowerCase())return config.publicOrigin;
  const port=req.socket.localPort;
  if(!config.production&&(host===`127.0.0.1:${port}`||host===`localhost:${port}`))return `http://${host}`;
  return null;
}
