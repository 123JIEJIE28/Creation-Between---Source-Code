import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';

// Run against an already-started local server. All records created by this
// script use a fresh UUID prefix and are removed in finally. Uploaded images
// are reported for the caller to remove from its chosen data directory.
const base=new URL(process.env.LIBRARY_TEST_URL||'http://127.0.0.1:4173');
assert.ok(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname),
  'Verification must target an HTTP loopback server.');
const prefix=`verify-${randomUUID()}`;
const cleanupIds=new Set();
const checks=[];
let createdUpload=null;
let failure=null;

async function request(method,pathname,payload,{expected=200,raw=false}={}){
  const headers={'Origin':base.origin};
  if(payload!==undefined)headers['Content-Type']=raw?'application/octet-stream':'application/json';
  const response=await fetch(new URL(pathname,base.origin),{
    method,headers,body:payload===undefined?undefined:raw?payload:JSON.stringify(payload),
    signal:AbortSignal.timeout(10000),
  });
  const data=await response.json();
  assert.equal(response.status,expected,`${method} ${pathname}: ${JSON.stringify(data)}`);
  return data;
}

function temporaryRecord(suffix,fields={}){
  const id=`${prefix}-${suffix}`;
  cleanupIds.add(id);
  return {id,type:'experiments',title:`临时验证 ${suffix}`,description:'自动验证创建，运行结束后删除。',
    content:'original content',tags:['temporary-verification'],status:'待测试',links:[],
    createdAt:'2026-10-31T12:00:00+08:00',...fields};
}

async function listOwn(){
  const data=await request('GET','/api/records');
  assert.ok(Array.isArray(data),'Records endpoint must return an array.');
  return data.filter(record=>record.id.startsWith(prefix));
}

// Construct a complete 1 × 1 PNG with valid CRCs using only Node built-ins.
function pngChunk(type,data){
  const typeBytes=Buffer.from(type);
  const input=Buffer.concat([typeBytes,data]);
  let crc=0xffffffff;
  for(const byte of input){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,input,checksum]);
}

function tinyPng(){
  const header=Buffer.alloc(13);
  header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);
  header[8]=8;header[9]=6; // 8-bit RGBA, default compression/filter/interlace.
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR',header),
    pngChunk('IDAT',deflateSync(Buffer.from([0,193,217,155,255]))),
    pngChunk('IEND',Buffer.alloc(0)),
  ]);
}

try{
  const firstPayload=temporaryRecord('first');
  const first=await request('POST','/api/records',firstPayload);
  assert.equal(first.id,firstPayload.id);
  assert.equal(first.createdAt,'2026-10-31T04:00:00.000Z');
  assert.equal((await listOwn()).find(record=>record.id===first.id)?.content,'original content');
  checks.push('create, read, and normalize creation date');

  const updated=await request('POST','/api/records',{...first,title:'已更新的临时验证',content:'latest content'});
  assert.equal(updated.content,'latest content');
  assert.ok(updated.updatedAt>first.updatedAt,'Edit must advance the record version.');
  await request('POST','/api/records',{...first,content:'stale content'},{expected:409});
  assert.equal((await listOwn()).find(record=>record.id===first.id)?.content,'latest content');
  checks.push('update and stale-write conflict rejection');

  const favorited=await request('PATCH',`/api/records/${first.id}`,{favorite:true,content:'must not overwrite'});
  assert.equal(favorited.favorite,true);
  assert.equal(favorited.content,'latest content');
  assert.equal(favorited.title,'已更新的临时验证');
  assert.ok(favorited.updatedAt>updated.updatedAt);
  await request('PATCH',`/api/records/${first.id}`,{favorite:'true'},{expected:400});
  await request('PATCH',`/api/records/${prefix}-missing`,{favorite:true},{expected:404});
  checks.push('partial favorite update preserves latest fields');

  const linkedPayload=temporaryRecord('linked',{links:[first.id]});
  const linked=await request('POST','/api/records',linkedPayload);
  assert.deepEqual(linked.links,[first.id]);

  const duplicate=temporaryRecord('duplicate',{title:'dedupe-first'});
  await request('POST','/api/import',[
    duplicate,{...duplicate,title:'dedupe-second'},
    {...linked,title:'must not replace an existing record'},
  ]);
  let own=await listOwn();
  assert.equal(own.filter(record=>record.id===duplicate.id).length,1);
  assert.equal(own.find(record=>record.id===duplicate.id)?.title,'dedupe-first');
  assert.equal(own.find(record=>record.id===linked.id)?.title,linked.title);
  checks.push('import deduplicates incoming IDs and preserves existing records');

  await request('POST','/api/records',temporaryRecord('invalid-date',{createdAt:'not-a-date'}),{expected:400});
  await request('POST','/api/records',temporaryRecord('overflow-date',{createdAt:'2026-02-31T00:00:00.000Z'}),{expected:400});
  await request('POST','/api/import',null,{expected:400});
  checks.push('invalid and overflowing dates are rejected');

  await request('POST','/api/upload',Buffer.from('not an image'),{expected:400,raw:true});
  const png=tinyPng();
  const uploaded=await request('POST','/api/upload',png,{raw:true});
  createdUpload=uploaded.url;
  assert.match(createdUpload,/^\/uploads\/[\w-]+\.png$/);
  const imageResponse=await fetch(new URL(createdUpload,base.origin),{signal:AbortSignal.timeout(10000)});
  assert.equal(imageResponse.status,200);
  assert.equal(imageResponse.headers.get('content-type'),'image/png');
  assert.ok(Buffer.from(await imageResponse.arrayBuffer()).equals(png));
  const withImage=await request('POST','/api/records',{...favorited,image:createdUpload});
  assert.equal(withImage.image,createdUpload);
  checks.push('valid PNG upload, image retrieval, and invalid-upload rejection');

  await request('DELETE',`/api/records/${first.id}`);
  own=await listOwn();
  assert.ok(!own.some(record=>record.id===first.id));
  assert.deepEqual(own.find(record=>record.id===linked.id)?.links,[]);
  checks.push('delete removes the record and incoming relationships');
}catch(error){
  failure=error;
  process.exitCode=1;
}finally{
  const cleanupFailures=[];
  for(const id of cleanupIds){
    try{await request('DELETE',`/api/records/${id}`);}
    catch(error){cleanupFailures.push({id,error:error.message});}
  }
  if(!cleanupFailures.length){
    try{assert.equal((await listOwn()).length,0,'Temporary records must all be removed.');}
    catch(error){cleanupFailures.push({error:error.message});}
  }
  if(cleanupFailures.length)process.exitCode=1;
  console.log(JSON.stringify({
    status:failure||cleanupFailures.length?'failed':'passed',
    checks,recordPrefix:prefix,createdUpload,
    ...(createdUpload?{uploadCleanup:'Remove only this returned file from the server data/uploads directory.'}:{}),
    ...(failure?{error:failure.message}:{}),
    ...(cleanupFailures.length?{cleanupFailures}:{}),
  },null,2));
}
