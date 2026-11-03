import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(process.env.LIBRARY_DATA_DIR||path.join(root,'data')); await mkdir(path.join(dataDir,'uploads'),{recursive:true});
const db=path.join(dataDir,'library.json');
const types=['characters','prompts','assets','projects','works','workflows','inbox','experiments'];
let records;try{records=JSON.parse(await readFile(db,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;records=[];}
let queue=Promise.resolve();
function commit(fn){const next=queue.then(async()=>{const updated=fn(records);const temp=db+'.tmp';await writeFile(temp,JSON.stringify(updated,null,2));await rename(temp,db);records=updated;});queue=next.catch(()=>{});return next;}
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,limit=2*1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('文件过大'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
function createdDate(value){
  if(value===undefined)return new Date().toISOString();
  if(typeof value!=='string'||!value.trim()||!Number.isFinite(Date.parse(value)))throw new Error('创建日期无效');
  const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if(parts){
    const [,year,month,day]=parts.map(Number);const leap=year%4===0&&(year%100!==0||year%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(month<1||month>12||day<1||day>days[month-1])throw new Error('创建日期无效');
  }
  return new Date(value).toISOString();
}
function nextUpdatedAt(previous){
  const prior=Date.parse(previous||'');
  return new Date(Math.max(Date.now(),Number.isFinite(prior)?prior+1:0)).toISOString();
}
function downloadDisposition(requested,file){
  const extension=path.extname(file).toLowerCase();
  const name=String(requested||'image').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\<>:"|?*]/g,'_');
  const suffix=path.extname(name);
  const stem=(suffix?name.slice(0,-suffix.length):name).replace(/^[.\s]+|[.\s]+$/g,'');
  let bounded='',length=0;
  for(const character of stem){const size=Buffer.byteLength(character);if(length+size>180)break;bounded+=character;length+=size;}
  const filename=(bounded||'image')+extension;
  const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="image${extension}"; filename*=UTF-8''${encoded}`;
}
function valid(v){if(!v||!types.includes(v.type)||typeof v.title!=='string'||!v.title.trim()||v.title.length>160)throw new Error('请填写有效的名称和类别');return {id:typeof v.id==='string'&&/^[\w-]{1,80}$/.test(v.id)?v.id:randomUUID(),type:v.type,title:v.title.trim(),description:String(v.description||'').slice(0,2000),content:String(v.content||'').slice(0,50000),tags:Array.isArray(v.tags)?v.tags.filter(t=>typeof t==='string').slice(0,20).map(t=>t.slice(0,40)):[],status:String(v.status||'待整理').slice(0,30),model:String(v.model||'').slice(0,100),image:typeof v.image==='string'&&/^\/uploads\/[\w.-]+$/.test(v.image)?v.image:'',url:typeof v.url==='string'&&/^https?:\/\//.test(v.url)?v.url:'',favorite:!!v.favorite,links:Array.isArray(v.links)?v.links.filter(t=>typeof t==='string').slice(0,100):[],sample:!!v.sample,createdAt:createdDate(v.createdAt),updatedAt:nextUpdatedAt()};}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
const server=http.createServer(async(req,res)=>{try{const origin=`http://${req.headers.host}`;const u=new URL(req.url,origin);if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')&&!/^localhost:\d+$/.test(req.headers.host||''))return json(res,403,{error:'只允许本机访问'});if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)return json(res,403,{error:'请求来源无效'});
if(u.pathname==='/api/records'&&req.method==='GET')return json(res,200,records);
if(u.pathname==='/api/records'&&req.method==='POST'){
  const payload=JSON.parse(await body(req));const v=valid(payload);
  await commit(rows=>{
    const current=rows.find(r=>r.id===v.id);
    if(current&&payload.updatedAt!==undefined&&payload.updatedAt!==current.updatedAt)throw Object.assign(new Error('这条资料已在其他页面更新，请刷新后再编辑。'),{status:409});
    v.updatedAt=nextUpdatedAt(current?.updatedAt);
    return [v,...rows.filter(r=>r.id!==v.id)];
  });
  return json(res,200,v);
}
if(/^\/api\/records\/[\w-]{1,80}$/.test(u.pathname)&&req.method==='PATCH'){
  const id=u.pathname.split('/').pop();const payload=JSON.parse(await body(req));
  if(!payload||typeof payload.favorite!=='boolean')throw new Error('收藏状态必须为布尔值');
  let saved;
  await commit(rows=>{
    const current=rows.find(r=>r.id===id);
    if(!current)throw Object.assign(new Error('资料不存在'),{status:404});
    saved={...current,favorite:payload.favorite,updatedAt:nextUpdatedAt(current.updatedAt)};
    return rows.map(r=>r.id===id?saved:r);
  });
  return json(res,200,saved);
}
if(u.pathname.startsWith('/api/records/')&&req.method==='DELETE'){const id=u.pathname.split('/').pop();await commit(rows=>rows.filter(r=>r.id!==id).map(r=>({...r,links:r.links.filter(l=>l!==id)})));return json(res,200,{ok:true});}
if(u.pathname==='/api/import'&&req.method==='POST'){const payload=JSON.parse(await body(req,10*1024*1024));const source=Array.isArray(payload)?payload:payload?.records;if(!Array.isArray(source)||source.length>5000)throw new Error('备份格式无效或超过 5000 条');const imported=source.map(valid);await commit(rows=>{const ids=new Set(rows.map(r=>r.id));const additions=[];for(const record of imported){if(ids.has(record.id))continue;ids.add(record.id);additions.push(record);}return [...rows,...additions];});return json(res,200,{ok:true});}
if(u.pathname==='/api/upload'&&req.method==='POST'){const b=await body(req,10*1024*1024);let ext='';if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(b[0]===255&&b[1]===216&&b[2]===255)ext='jpg';else if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')ext='webp';else if(['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()))ext='gif';if(!ext)throw new Error('支持 PNG、JPG、WebP、GIF 图片，最大 10 MB');const file=randomUUID()+'.'+ext;await writeFile(path.join(dataDir,'uploads',file),b);return json(res,200,{url:'/uploads/'+file});}
if(u.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
let file;if(u.pathname.startsWith('/uploads/')){const name=u.pathname.slice(9);if(!/^[\w.-]+$/.test(name))return json(res,404,{error:'文件不存在'});file=path.join(dataDir,'uploads',name);}else if(/^\/assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/.test(u.pathname)){file=path.join(root,'public',u.pathname.slice(1));}else{const name=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!['index.html','app.js','style.css','favicon.svg','motion.js'].includes(name))return json(res,404,{error:'页面不存在'});file=path.join(root,'public',name);}
const bytes=await readFile(file);const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'"};
if(u.pathname.startsWith('/uploads/')&&u.searchParams.get('download')==='1'&&['GET','HEAD'].includes(req.method))headers['Content-Disposition']=downloadDisposition(u.searchParams.get('name'),file);
res.writeHead(200,headers);res.end(bytes);
}catch(e){json(res,e.code==='ENOENT'?404:e.status||400,{error:e.code==='ENOENT'?'文件不存在':e.message});}});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`造物间已启动：http://127.0.0.1:${server.address().port}`));
