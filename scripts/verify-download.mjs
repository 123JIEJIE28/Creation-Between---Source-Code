import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';

// Use a private fixture directory and an OS-assigned port; never touch the
// user's records, uploads, or preview process.
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(path.join(tmpdir(),'creative-library-download-'));
const cleanEnvironment={...process.env};
for(const key of ['NODE_ENV','OWNER_USERNAME','OWNER_PASSWORD_HASH','OWNER_PASSWORD','PUBLIC_ORIGIN','RENDER_EXTERNAL_URL'])delete cleanEnvironment[key];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let server;
try{
  await mkdir(path.join(temporary,'uploads'));
  await writeFile(path.join(temporary,'uploads','sample.png'),png);
  server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...cleanEnvironment,PORT:'0',LIBRARY_DATA_DIR:temporary},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{
    let output='',errors='';
    const timeout=setTimeout(()=>reject(new Error('Temporary server startup timed out.')),10000);
    server.stdout.on('data',chunk=>{
      output+=chunk;
      const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match){clearTimeout(timeout);resolve(match[0]);}
    });
    server.stderr.on('data',chunk=>{errors+=chunk;});
    server.once('error',error=>{clearTimeout(timeout);reject(error);});
    server.once('exit',code=>{clearTimeout(timeout);if(!output.match(/http:\/\/127\.0\.0\.1:\d+/))reject(new Error(`Temporary server exited ${code}: ${errors}`));});
  });
  async function image(query='',method='GET'){
    return fetch(base+'/uploads/sample.png'+query,{method,signal:AbortSignal.timeout(5000)});
  }
  function filename(response){
    const disposition=response.headers.get('content-disposition');
    assert.match(disposition,/^attachment; filename="image\.png"; filename\*=UTF-8''/);
    assert.ok(!/[\r\n]/.test(disposition),'Header must not contain newlines.');
    return decodeURIComponent(disposition.split("filename*=UTF-8''")[1]);
  }
  const normal=await image();
  assert.equal(normal.status,200);
  assert.equal(normal.headers.get('content-type'),'image/png');
  assert.equal(normal.headers.get('content-disposition'),null);
  assert.equal(hash(Buffer.from(await normal.arrayBuffer())),hash(png));

  const title="人物封面 '()!*.jpg";
  const download=await image('?download=1&name='+encodeURIComponent(title));
  assert.equal(download.status,200);
  assert.equal(download.headers.get('content-type'),'image/png');
  assert.equal(filename(download),"人物封面 '()!_.png");
  assert.match(download.headers.get('content-disposition'),/%27%28%29%21/);
  assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(png),'Download must retain original image bytes.');

  const hostile=await image('?download=1&name='+encodeURIComponent('../folder\\名称\r\nX-Injected: yes.html'));
  const safe=filename(hostile);
  assert.ok(!/[\u0000-\u001f\u007f/\\<>:"|?*]/.test(safe));
  assert.ok(!safe.startsWith('.'));
  assert.ok(safe.endsWith('.png'));
  assert.equal(hostile.headers.get('x-injected'),null);
  await hostile.arrayBuffer();

  const long=await image('?download=1&name='+encodeURIComponent('图😀'.repeat(200)+'.gif'));
  assert.ok(Buffer.byteLength(filename(long))<=184,'Bounded name must fit common filesystem component limits.');
  await long.arrayBuffer();
  const defaultName=await image('?download=1');
  assert.equal(filename(defaultName),'image.png');
  await defaultName.arrayBuffer();
  const head=await image('?download=1&name='+encodeURIComponent('封面.png'),'HEAD');
  assert.equal(filename(head),'封面.png');
  assert.equal((await head.arrayBuffer()).byteLength,0);
  const disabled=await image('?download=0&name=ignored.png');
  assert.equal(disabled.headers.get('content-disposition'),null);
  await disabled.arrayBuffer();
  const script=await fetch(base+'/app.js?download=1&name=ignored.png',{signal:AbortSignal.timeout(5000)});
  assert.equal(script.headers.get('content-disposition'),null,'Only uploaded images opt into attachment responses.');
  await script.arrayBuffer();
  console.log('PASS: original bytes, UTF-8 filename, real extension, safe headers, normal image display, HEAD, and attachment scoping.');
}finally{
  if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
  await rm(temporary,{recursive:true,force:true});
}
