import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rename,unlink,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {hashPassword,parsePasswordHash} from '../lib/password.mjs';
import {authentication} from '../lib/auth.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(path.join(tmpdir(),'creative-library-auth-'));
const children=new Set(),checks=[];
const username='isolated-owner',password=randomBytes(24).toString('base64url');
const encoded=await hashPassword(password);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const inherited={...process.env};
for(const key of ['OWNER_USERNAME','OWNER_PASSWORD_HASH','OWNER_PASSWORD','PUBLIC_ORIGIN','RENDER_EXTERNAL_URL','LIBRARY_DATA_DIR','PORT','NODE_ENV'])delete inherited[key];
async function launch(overrides={},expectFailure=false){
  const folder=path.join(temporary,randomBytes(6).toString('hex'));
  const env={...inherited,NODE_ENV:'test',PORT:'0',LIBRARY_DATA_DIR:folder,...overrides};
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  const state={child,env,stdout:'',stderr:'',exited:once(child,'exit')};children.add(state);
  child.stdout.on('data',chunk=>{state.stdout+=chunk;});child.stderr.on('data',chunk=>{state.stderr+=chunk;});
  const startup=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Isolated server startup timed out.')),10000);
    child.stdout.on('data',()=>{if(/http:\/\/(127\.0\.0\.1|0\.0\.0\.0):\d+/.test(state.stdout)){clearTimeout(timeout);resolve('started');}});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',()=>{clearTimeout(timeout);resolve('exited');});
  });
  if(expectFailure){assert.equal(startup,'exited','Invalid configuration must never start listening.');assert.notEqual(child.exitCode,0);assert.ok(!state.stderr.includes(password)&&!state.stderr.includes(encoded));children.delete(state);return state;}
  assert.equal(startup,'started',state.stderr);
  state.port=Number(state.stdout.match(/http:\/\/[^:]+:(\d+)/)[1]);state.base='http://127.0.0.1:'+state.port;
  return state;
}
async function stop(state){
  if(state.child.exitCode===null){state.child.kill('SIGTERM');await state.exited;}
  children.delete(state);
  assert.equal(state.child.exitCode,0,state.stderr);
}
async function request(state,pathname,{method='GET',data,cookie,origin,headers={},raw=false}={}){
  const publicOrigin=state.env.PUBLIC_ORIGIN||state.env.RENDER_EXTERNAL_URL;
  const expected=state.env.NODE_ENV==='production'?publicOrigin:state.base;
  const finalHeaders={...headers};
  if(state.env.NODE_ENV==='production'&&!('Host' in finalHeaders))finalHeaders.Host=new URL(expected).host;
  if(!['GET','HEAD'].includes(method)&&origin!==null)finalHeaders.Origin=origin??expected;
  if(cookie)finalHeaders.Cookie=cookie;
  if(data!==undefined)finalHeaders['Content-Type']=raw?'application/octet-stream':'application/json';
  // Use the HTTP client so hostile Host values reach the server unchanged.
  // fetch may normalize or replace Host, making origin-boundary tests invalid.
  return await new Promise((resolve,reject)=>{
    const req=http.request(new URL(pathname,state.base),{method,headers:finalHeaders},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>{
        const bytes=Buffer.concat(chunks),responseHeaders=new Headers();
        for(const [name,value] of Object.entries(res.headers))if(value!==undefined)responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
        let value;try{value=JSON.parse(bytes.toString());}catch{}
        resolve({status:res.statusCode,headers:responseHeaders,bytes,value});
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error('Isolated request timed out.')));
    req.on('error',reject);
    req.end(data===undefined?undefined:raw?data:JSON.stringify(data));
  });
}
async function login(state,cookie){
  const result=await request(state,'/api/auth/login',{method:'POST',data:{username,password},cookie});
  assert.equal(result.status,200,JSON.stringify(result.value));assert.deepEqual(result.value,{authenticated:true,username});
  const setCookie=result.headers.get('set-cookie');
  assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Path=\//);assert.match(setCookie,/Max-Age=43200/);
  return {cookie:setCookie.split(';')[0],setCookie};
}
try{
  const valid={OWNER_USERNAME:username,OWNER_PASSWORD_HASH:encoded};
  await launch({NODE_ENV:'production'},true);
  await launch({NODE_ENV:'production',...valid},true);
  await launch({NODE_ENV:'production',...valid,PUBLIC_ORIGIN:'http://private.example.test'},true);
  await launch({NODE_ENV:'production',...valid,PUBLIC_ORIGIN:'https://private.example.test',LIBRARY_DATA_DIR:'relative-data'},true);
  await launch({...valid,OWNER_PASSWORD:'must-not-be-used'},true);
  await launch({...valid,OWNER_PASSWORD_HASH:'invalid'},true);
  checks.push('production fails closed for missing/invalid configuration and plaintext password settings');

  const dataDir=path.join(temporary,'persistent');await mkdir(path.join(dataDir,'uploads'),{recursive:true});await writeFile(path.join(dataDir,'uploads','fixture.png'),png);
  let state=await launch({...valid,LIBRARY_DATA_DIR:dataDir});
  let result=await request(state,'/healthz');assert.equal(result.status,200);assert.deepEqual(result.value,{ok:true});
  assert.equal((await request(state,'/')).status,200);
  assert.equal((await request(state,'/app.js')).status,200);
  assert.deepEqual((await request(state,'/api/auth/session')).value,{authRequired:true,authenticated:false});
  for(const [method,url] of [['GET','/api/records'],['POST','/api/records'],['PATCH','/api/records/fixture'],['DELETE','/api/records/fixture'],['POST','/api/upload'],['POST','/api/import'],['GET','/uploads/fixture.png'],['HEAD','/uploads/fixture.png'],['GET','/uploads/fixture.png?download=1']]){
    result=await request(state,url,{method,data:['POST','PATCH'].includes(method)?{}:undefined});assert.equal(result.status,401,method+' '+url);assert.equal(result.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await request(state,'/api/auth/session',{headers:{Host:'evil.example','X-Forwarded-Host':new URL(state.base).host}})).status,403);
  assert.equal((await request(state,'/api/auth/login',{method:'POST',data:{username,password},origin:null})).status,403);
  assert.equal((await request(state,'/api/auth/login',{method:'POST',data:{username,password},origin:'https://evil.example'})).status,403);
  assert.equal((await request(state,'/api/auth/login',{method:'POST',data:{username,password},origin:state.base.replace('http:','https:'),headers:{'X-Forwarded-Proto':'https'}})).status,403);
  const wrongUser=await request(state,'/api/auth/login',{method:'POST',data:{username:'unknown',password}});
  const wrongPass=await request(state,'/api/auth/login',{method:'POST',data:{username,password:'wrong-password'}});
  assert.equal(wrongUser.status,401);assert.deepEqual(wrongUser.value,wrongPass.value);
  let signed=await login(state);assert.ok(!signed.setCookie.includes('Secure'));assert.match(signed.cookie,/=[A-Za-z0-9_-]{43}$/);
  assert.deepEqual((await request(state,'/api/auth/session',{cookie:signed.cookie})).value,{authRequired:true,authenticated:true,username});
  const old=signed.cookie;signed=await login(state,old);assert.notEqual(signed.cookie,old);assert.equal((await request(state,'/api/records',{cookie:old})).status,401);
  checks.push('unauthenticated API/image/HEAD protection, strict Host/Origin, generic failures, secure session creation and rotation');

  result=await request(state,'/api/records',{method:'POST',cookie:signed.cookie,data:{id:'persisted',type:'works',title:'隔离验证',content:'persisted content',links:[],status:'待整理'}});assert.equal(result.status,200);let record=result.value;
  result=await request(state,'/api/upload',{method:'POST',cookie:signed.cookie,data:png,raw:true});assert.equal(result.status,200);const imageUrl=result.value.url;
  result=await request(state,'/api/records',{method:'POST',cookie:signed.cookie,data:{...record,image:imageUrl,title:'持久资料'}});assert.equal(result.status,200);record=result.value;
  assert.equal((await request(state,'/api/records',{method:'POST',cookie:signed.cookie,origin:'https://evil.example',data:{...record,title:'forbidden'}})).status,403);
  result=await request(state,'/api/records/persisted',{method:'PATCH',cookie:signed.cookie,data:{favorite:true}});assert.equal(result.status,200);assert.equal(result.value.content,'persisted content');
  result=await request(state,'/api/import',{method:'POST',cookie:signed.cookie,data:[{id:'related',type:'prompts',title:'关联测试',links:['persisted']}]});assert.equal(result.status,200);
  assert.equal((await request(state,'/api/records/related',{method:'DELETE',cookie:signed.cookie})).status,200);
  result=await request(state,imageUrl,{cookie:signed.cookie});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(digest(result.bytes),digest(png));
  result=await request(state,imageUrl+'?download=1&name='+encodeURIComponent('原图.png'),{cookie:signed.cookie});assert.match(result.headers.get('content-disposition'),/attachment;/);assert.match(result.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.equal(digest(result.bytes),digest(png));
  result=await request(state,imageUrl+'?download=1',{method:'HEAD',cookie:signed.cookie});assert.equal(result.status,200);assert.equal(result.bytes.length,0);assert.equal(result.headers.get('cache-control'),'private, no-store');
  result=await request(state,'/api/auth/logout',{method:'POST',cookie:signed.cookie});assert.deepEqual(result.value,{ok:true});assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await request(state,'/api/records',{cookie:signed.cookie})).status,401);
  assert.equal((await request(state,imageUrl,{cookie:signed.cookie})).status,401);
  signed=await login(state);const beforeRestart=signed.cookie;await stop(state);
  await assert.rejects(access(path.join(dataDir,'.library.lock')),{code:'ENOENT'});
  state=await launch({...valid,LIBRARY_DATA_DIR:dataDir});
  assert.equal((await request(state,'/api/records',{cookie:beforeRestart})).status,401);
  signed=await login(state);result=await request(state,'/api/records',{cookie:signed.cookie});assert.equal(result.value.length,1);assert.equal(result.value[0].title,'持久资料');assert.equal(result.value[0].favorite,true);
  assert.equal(digest((await request(state,imageUrl,{cookie:signed.cookie})).bytes),digest(png));
  await launch({...valid,LIBRARY_DATA_DIR:dataDir},true);assert.equal((await request(state,'/healthz')).status,200);
  checks.push('authenticated CRUD/import/upload/download, logout invalidation, restart persistence and session invalidation, single-writer lock');

  await rename(path.join(dataDir,'uploads'),path.join(dataDir,'uploads-offline'));await writeFile(path.join(dataDir,'uploads'),'not a directory');
  result=await request(state,'/healthz');assert.equal(result.status,503);assert.deepEqual(result.value,{ok:false});
  await unlink(path.join(dataDir,'uploads'));await rename(path.join(dataDir,'uploads-offline'),path.join(dataDir,'uploads'));
  assert.equal((await request(state,'/healthz')).status,200);
  const concurrent=await Promise.all(Array.from({length:4},()=>request(state,'/api/auth/login',{method:'POST',data:{username,password:'incorrect'}})));
  assert.equal(concurrent.filter(item=>item.status===401).length,1);assert.equal(concurrent.filter(item=>item.status===429).length,3);
  for(let i=0;i<4;i++)assert.equal((await request(state,'/api/auth/login',{method:'POST',data:{username,password:'incorrect'}})).status,401);
  result=await request(state,'/api/auth/login',{method:'POST',data:{username,password}});assert.equal(result.status,429);assert.ok(Number(result.headers.get('retry-after'))>0);
  await stop(state);
  checks.push('health probes real write access, login failure throttling and concurrent-scrypt bound');

  await writeFile(path.join(dataDir,'.library.lock'),JSON.stringify({pid:1,host:'previous-container',token:'stale-container-fixture'}));
  const production={...valid,NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://private.example.test',LIBRARY_DATA_DIR:dataDir};
  state=await launch(production);
  assert.ok(state.stdout.includes('http://0.0.0.0:'));
  assert.equal((await request(state,'/api/auth/session',{headers:{Host:new URL(state.base).host,'X-Forwarded-Host':'private.example.test','X-Forwarded-Proto':'https'}})).status,403);
  assert.equal((await request(state,'/healthz')).status,200);
  signed=await login(state);assert.match(signed.setCookie,/^__Host-workspace_session=/);assert.match(signed.setCookie,/; Secure/);assert.ok(!signed.setCookie.includes('Domain='));
  const crashedSession=signed.cookie;
  state.child.kill('SIGKILL');await state.exited;children.delete(state);
  state=await launch(production);
  assert.equal((await request(state,'/api/records',{cookie:crashedSession})).status,401);
  signed=await login(state);
  result=await request(state,'/api/records',{cookie:signed.cookie});assert.equal(result.value[0].title,'持久资料');
  assert.equal(digest((await request(state,imageUrl,{cookie:signed.cookie})).bytes),digest(png));
  await stop(state);checks.push('production HTTPS canonical origin, Secure cookie, crash persistence and replacement-container startup');

  let clock=1;const manager=authentication({authRequired:true,username,password:parsePasswordHash(encoded),production:false},{now:()=>clock});
  const unitReq={headers:{},socket:{remoteAddress:'isolated-unit'}};
  let unit=await manager.login(unitReq,{username,password});unitReq.headers.cookie=unit.cookie.split(';')[0];clock+=2*60*60*1000+1;assert.equal(manager.status(unitReq).authenticated,false);
  unit=await manager.login(unitReq,{username,password});unitReq.headers.cookie=unit.cookie.split(';')[0];
  for(let hour=1;hour<12;hour++){clock+=60*60*1000;assert.equal(manager.status(unitReq).authenticated,true);}
  clock+=60*60*1000+1;assert.equal(manager.status(unitReq).authenticated,false);manager.close();checks.push('server-enforced idle and absolute expiry');

  state=await launch();assert.deepEqual((await request(state,'/api/auth/session')).value,{authRequired:false,authenticated:true});
  const legacy=spawn(process.execPath,['scripts/verify-local.mjs'],{cwd:root,env:{...inherited,LIBRARY_TEST_URL:state.base},stdio:['ignore','pipe','pipe']});
  let legacyOutput='';legacy.stdout.on('data',chunk=>{legacyOutput+=chunk;});legacy.stderr.on('data',chunk=>{legacyOutput+=chunk;});
  const [legacyCode]=await once(legacy,'exit');assert.equal(legacyCode,0,legacyOutput);assert.equal(JSON.parse(legacyOutput).status,'passed');await stop(state);
  checks.push('legacy no-login loopback mode and existing full CRUD/upload verification');
  console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{
  for(const state of children){if(state.child.exitCode===null){state.child.kill('SIGTERM');await state.exited;}}
  await rm(temporary,{recursive:true,force:true});
}
