const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'⌂',characters:'♙',prompts:'✳',assets:'▧',projects:'▣',works:'◈',workflows:'⇄',inbox:'⌑',experiments:'⚗',favorite:'☆'};
const categories={characters:['人物形象','','角色设定'],prompts:['提示词','','提示词正文'],assets:['素材库','','素材信息'],projects:['工作项目','','项目内容'],works:['作品库','','作品信息'],workflows:['工作流','','制作步骤'],inbox:['灵感收集箱','','灵感内容'],experiments:['实验记录','','测试记录']};
const labels={characters:'CHARACTERS',prompts:'PROMPTS',assets:'ASSETS',projects:'PROJECTS',works:'WORKS',workflows:'WORKFLOWS',inbox:'IDEAS',experiments:'EXPERIMENTS'};
const statuses=['待整理','待测试','已验证','进行中','已完成','已归档'];
const arrow='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" stroke-width="1.5"/></svg>';
const searchIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.5"/></svg>';
let records=[],view='home',query='',filter='全部',sort='updated',onlyFav=false,loadError='',isLoading=true;
let transitioning=false,pendingNavigation=null,needsDataRender=false;
let editorSession=null,editorSequence=0,historyIndex=Number.isInteger(history.state?.studioIndex)?history.state.studioIndex:0,restoringHistory=null;
let discardRequest=null,historyNavigationSequence=0,committedHistoryUrl=location.pathname;
const api=async(url,options={})=>{const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});const j=await r.json();if(!r.ok)throw new Error(j.error||'操作失败');return j;};
let toastTimer;
function notify(s){clearTimeout(toastTimer);$('#toast').textContent=s;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
function count(type){return records.filter(r=>r.type===type).length;}
function brand(){return '<button class="brand" data-nav="home" aria-label="返回首页"><span class="brand-symbol" aria-hidden="true">✳</span><span>造物间</span></button>';}
function nav(id,name){return `<button class="nav-item ${view===id?'active':''}" data-nav="${id}" ${view===id?'aria-current="page"':''}>${name}</button>`;}
function editorSnapshot(form){return JSON.stringify([...new FormData(form)].map(([name,value])=>[name,typeof value==='string'?value:value.name?[value.name,value.size,value.lastModified,value.type]:null]));}
function editorHasChanges(){return !!editorSession&&editorSnapshot(editorSession.form)!==editorSession.initial;}
function finishDiscard(accepted){
  const request=discardRequest;if(!request)return;
  discardRequest=null;$('#discard-confirm').close();
  const current=editorSession===request.session&&$('#editor').open;
  if(current){const target=request.opener?.isConnected&&$('#editor').contains(request.opener)?request.opener:request.session.form.querySelector('[name="title"]');target?.focus({preventScroll:true});}
  request.resolve(!!accepted&&current&&!request.session.saving);
}
function askDiscard(session){
  if(discardRequest?.session===session)return discardRequest.promise;
  if(discardRequest)finishDiscard(false);
  let resolve;const promise=new Promise(done=>{resolve=done;});
  discardRequest={session,promise,resolve,opener:document.activeElement};
  $('#discard-confirm').showModal();$('#discard-confirm [data-discard="continue"]').focus();
  return promise;
}
async function canLeaveEditor(){
  const session=editorSession;
  if(!session||!$('#editor').open)return true;
  if(session.saving){notify('正在保存，请稍候');return false;}
  if(!editorHasChanges())return true;
  const accepted=await askDiscard(session);
  return accepted&&editorSession===session&&!session.saving;
}
async function closeEditor({force=false,session=editorSession}={}){
  if(editorSession!==session)return false;
  if(!force&&!await canLeaveEditor())return false;
  if(editorSession!==session)return false;
  if(discardRequest?.session===session)finishDiscard(false);
  $('#editor').close();editorSession=null;return true;
}
async function closeOverlay(id){if(id==='discard-confirm'){finishDiscard(false);return true;}if(id==='editor')return await closeEditor();$('#'+id)?.close();return true;}
async function closeOverlays(session=editorSession){if(!await closeEditor({force:true,session}))return false;document.querySelectorAll('dialog[open]').forEach(d=>d.close());return true;}
function viewUrl(v){return v==='home'?location.pathname:location.pathname+'#'+v;}
async function switchView(v,{historyMode='push',editorChecked=false,expectedSession=editorSession}={}){
  if(v!=='home'&&v!=='library'&&v!=='favorite'&&!categories[v])return;
  if(!editorChecked&&!await canLeaveEditor())return false;
  if(editorSession!==expectedSession)return false;
  if(transitioning){pendingNavigation={v,historyMode,editorChecked:true,expectedSession};return;}
  if(v===view&&!query){if(!await closeOverlays(expectedSession))return false;const menu=$('#studio-menu');if(menu)menu.hidden=true;document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded','false');closeSearch();window.scrollTo({top:0,behavior:'instant'});return true;}
  transitioning=true;const previous=view;const app=$('#app');app.inert=true;
  try{
    if(!await closeOverlays(expectedSession))return false;
    if(historyMode==='push'&&previous!==v){historyNavigationSequence++;historyIndex++;committedHistoryUrl=viewUrl(v);history.pushState({studioView:v,studioIndex:historyIndex},'',committedHistoryUrl);}
    await window.StudioMotion?.exit(app,{gateway:previous==='home'||v==='home'});
    view=v;query='';filter='全部';onlyFav=false;
    render({resetScroll:true});
    await window.StudioMotion?.enter(app,{gateway:previous==='home'||v==='home'});
  }finally{
    app.inert=false;transitioning=false;
    if(needsDataRender){needsDataRender=false;if(view!=='home')renderMain();}
    const focusTarget=view==='home'?$('#explore'):$('#screen-title');
    focusTarget?.focus({preventScroll:true});
    if(pendingNavigation){const next=pendingNavigation;pendingNavigation=null;void switchView(next.v,{historyMode:next.historyMode,editorChecked:next.editorChecked,expectedSession:next.expectedSession});}
  }
}
function gatewayShell(){return `<header class="site-header gateway-header">${brand()}<nav aria-label="主导航"><span class="nav-current">首页</span><button class="nav-item" data-nav="library">探索 ${arrow}</button></nav></header><main id="main" class="gateway" aria-labelledby="screen-title"><div class="gateway-center"><h1 id="screen-title" class="gateway-title" tabindex="-1" aria-label="WORKSPACE">${'WORKSPACE'.split('').map(c=>`<span aria-hidden="true"><span class="letter-float">${c}</span></span>`).join('')}</h1><button id="explore" class="explore-button magnetic" data-nav="library" aria-label="探索创作库"><span>EXPLORE</span><span class="explore-arrow">${arrow}</span></button></div></main>`;}
function libraryShell(){return `<div class="scroll-progress" aria-hidden="true"></div><header class="site-header">${brand()}<nav class="desktop-nav" aria-label="主导航">${nav('library','创作库')}${nav('characters','人物')}${nav('prompts','提示词')}${nav('works','作品')}</nav><div class="header-actions"><button class="icon-button" data-action="search" aria-label="搜索资料" aria-expanded="false" aria-controls="search-panel">${searchIcon}</button><button class="icon-button menu-toggle" data-action="menu" aria-label="全部模块" aria-expanded="false" aria-controls="studio-menu"><span class="menu-lines" aria-hidden="true"></span></button><button class="header-create" data-new="inbox">新建 <span>＋</span></button></div></header><div id="studio-menu" class="studio-menu" hidden><div class="menu-grid">${Object.entries(categories).map(([id,c],i)=>`<button data-nav="${id}"><strong>${c[0]}</strong>${arrow}</button>`).join('')}<button data-nav="favorite"><strong>我的收藏</strong>${arrow}</button></div></div><div class="search-panel" id="search-panel" hidden><label class="global-search">${searchIcon}<input id="search" aria-label="搜索创作资料" placeholder="搜索" value="${esc(query)}" autocomplete="off"><kbd>⌘ K</kbd></label><button class="icon-button" data-action="search-close" aria-label="关闭搜索">×</button></div><main id="main" class="library-main"></main><footer class="site-footer"><button data-nav="home">返回首页 ${arrow}</button><div><button data-action="import">导入</button><button data-action="export">导出</button></div></footer>`;}
function render({resetScroll=false}={}){
  stageAnimations.forEach(animation=>animation.cancel());stageAnimations=[];
  const scroll=resetScroll?0:window.scrollY;window.StudioMotion?.destroy();document.body.classList.toggle('is-gateway',view==='home');
  $('#app').innerHTML=view==='home'?gatewayShell():libraryShell();
  if(view!=='home'){renderMain();if(query){$('#search-panel').hidden=false;document.querySelector('[data-action="search"]').setAttribute('aria-expanded','true');}}else window.StudioMotion?.refresh();
  window.scrollTo({top:scroll,behavior:'instant'});
}
const stageModules=[
  {id:'projects',en:'PROJECTS',zh:'工作项目'},
  {id:'workflows',en:'WORKFLOWS',zh:'工作流'},
  {id:'inbox',en:'IDEA<br>INBOX',zh:'灵感收集箱'},
  {id:'experiments',en:'EXPERIMENTS',zh:'实验记录'},
  {id:'favorite',en:'FAVORITES',zh:'我的收藏'}
];
let activeStageId='projects';
let stageAnimations=[];
function stageRecord(id){return records.filter(r=>r.image&&(id==='favorite'?r.favorite:r.type===id)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];}
function stageContent(id){
  const module=stageModules.find(x=>x.id===id)||stageModules[0];
  const record=stageRecord(module.id);
  return `<div class="stage-copy"><h2 id="stage-title" class="stage-title" data-stage="${module.id}">${module.en}</h2><p class="stage-chinese">${module.zh}</p><div class="stage-controls"><button class="stage-enter" data-nav="${module.id}">进入 ${arrow}</button><div class="stage-arrows"><button class="stage-direction" data-stage-step="-1" aria-label="上一个模块">←</button><button class="stage-direction" data-stage-step="1" aria-label="下一个模块">→</button></div></div></div><div class="stage-media">${record?`<button class="stage-image" data-open="${record.id}" aria-label="查看 ${esc(record.title)}"><img src="${esc(record.image)}" alt="${esc(record.title)}" loading="lazy"><span class="stage-image-open">${arrow}</span></button>`:`<div class="stage-placeholder" role="img" aria-label="${module.zh}图片区域"><span aria-hidden="true">＋</span></div>`}</div>`;
}
function creativeStage(){return `<section class="collection-stage" aria-label="更多创作空间"><div class="stage-tabs" role="tablist" aria-label="创作模块">${stageModules.map(module=>`<button class="stage-tab ${activeStageId===module.id?'active':''}" id="stage-tab-${module.id}" role="tab" aria-selected="${activeStageId===module.id}" aria-controls="stage-panel" tabindex="${activeStageId===module.id?'0':'-1'}" data-stage="${module.id}">${module.zh}</button>`).join('')}</div><div class="stage-layout" id="stage-panel" role="tabpanel" aria-labelledby="stage-tab-${activeStageId}">${stageContent(activeStageId)}</div></section>`;}
function selectStage(id,{focus=false,direction=1}={}){
  if(!stageModules.some(module=>module.id===id)||!$('#stage-panel'))return;
  activeStageId=id;
  stageAnimations.forEach(animation=>animation.cancel());stageAnimations=[];
  const panel=$('#stage-panel');panel.innerHTML=stageContent(id);panel.setAttribute('aria-labelledby','stage-tab-'+id);
  document.querySelectorAll('.stage-tab').forEach(tab=>{const selected=tab.dataset.stage===id;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  if(focus)$('#stage-tab-'+id)?.focus({preventScroll:true});
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    stageAnimations.push(panel.querySelector('.stage-copy').animate([{opacity:0,transform:`translateY(${direction*18}px)`},{opacity:1,transform:'translateY(0)'}],{duration:450,easing:'cubic-bezier(.2,.8,.2,1)'}));
    stageAnimations.push(panel.querySelector('.stage-media').animate([{opacity:0,transform:`translateX(${direction*28}px) scale(.98)`},{opacity:1,transform:'translateX(0) scale(1)'}],{duration:600,easing:'cubic-bezier(.2,.8,.2,1)'}));
  }
}
function stepStage(step){const focusedStep=document.activeElement?.dataset.stageStep;const index=stageModules.findIndex(module=>module.id===activeStageId);selectStage(stageModules[(index+step+stageModules.length)%stageModules.length].id,{direction:step});if(focusedStep)document.querySelector(`[data-stage-step="${focusedStep}"]`)?.focus({preventScroll:true});}
function imageDownload(r,className='image-download'){
  if(!r?.image)return '';
  const extension=r.image.split('.').pop().toLowerCase();
  const stem=r.title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').trim().slice(0,100)||'image';
  const filename=stem+'.'+extension;
  return `<a class="${className}" href="${esc(r.image+'?download=1&name='+encodeURIComponent(filename))}" download="${esc(filename)}">下载图片 <span aria-hidden="true">↓</span></a>`;
}

function moduleTile(id){return `<button class="module-tile" data-nav="${id}" aria-label="${categories[id][0]}" data-reveal><span class="module-label">${categories[id][0]}</span><span class="module-arrow">${arrow}</span></button>`;}
function libraryOverview(){return `<div class="library-heading"><h1 id="screen-title" tabindex="-1">创作库<span class="heading-dot"></span></h1><button class="primary" data-new="works">新增资料 ＋</button></div><div class="modules-grid">${['characters','prompts','works','assets'].map(moduleTile).join('')}</div>${creativeStage()}`;}
function card(r){return `<article class="record-card" data-reveal><div class="cover-wrap"><button class="work-cover ${r.image?'has-image':'empty-cover'}" data-open="${r.id}" aria-label="打开 ${esc(r.title)}">${r.image?`<img src="${esc(r.image)}" alt="${esc(r.title)}" loading="lazy">`:'<span class="cover-plus" aria-hidden="true">＋</span>'}<span class="cover-open">${arrow}</span></button><button class="star ${r.favorite?'selected':''}" data-star="${r.id}" aria-label="${r.favorite?'取消收藏':'收藏'} ${esc(r.title)}">${r.favorite?'★':'☆'}</button></div><div class="card-meta"><span>${r.sample?'示例':categories[r.type][0]}</span><span class="status ${r.status==='已验证'||r.status==='已完成'?'green':''}">${esc(r.status)}</span></div><button class="card-title" data-open="${r.id}">${esc(r.title)} ${arrow}</button><div class="card-bottom"><div class="tags">${r.tags.slice(0,2).map(t=>`<button data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>${r.type==='prompts'?`<button class="copy-mini" data-copy="${r.id}">复制 ⧉</button>`:''}</div></article>`;}
function renderMain(){if(view==='home')return;renderContent();window.StudioMotion?.refresh();}
function renderContent(){const main=$('#main');
  if(loadError){main.innerHTML=`<div class="empty"><h1 id="screen-title" tabindex="-1">读取失败</h1><button class="primary" data-action="retry">重试</button></div>`;return;}
  if(isLoading){main.innerHTML='<div class="empty"><h1 id="screen-title" tabindex="-1">创作库</h1><span class="loading-dot" aria-label="正在加载"></span></div>';return;}
  if(view==='library'&&!query){main.innerHTML=libraryOverview();return;}
  const title=query?'搜索结果':view==='favorite'?'我的收藏':categories[view]?.[0]||'创作库';
  const stateRows=records.filter(r=>query||view==='library'||(view==='favorite'?r.favorite:r.type===view));
  if(filter!=='全部'&&!stateRows.some(r=>r.status===filter))filter='全部';
  let list=records.filter(r=>(query||view==='library'||(view==='favorite'?r.favorite:r.type===view))&&(!query||[r.title,r.description,r.content,r.model,...r.tags].join(' ').toLowerCase().includes(query.toLowerCase()))&&(filter==='全部'||r.status===filter));
  list.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title,'zh-CN'):(a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  main.innerHTML=`<nav class="library-nav" aria-label="资料类别"><button data-nav="library" aria-label="返回创作库">←</button>${Object.entries(categories).map(([id,c])=>`<button data-nav="${id}" class="${view===id?'active':''}">${c[0]}</button>`).join('')}</nav><div class="page-intro"><h1 id="screen-title" tabindex="-1">${title}</h1><button class="primary" data-new="${categories[view]?view:'inbox'}">新增 ＋</button></div><div class="filter-bar"><div class="filter-tabs">${['全部',...new Set(stateRows.map(r=>r.status))].map(s=>`<button data-filter="${esc(s)}" class="${filter===s?'active':''}" aria-pressed="${filter===s}">${esc(s)}</button>`).join('')}</div><select id="sort" aria-label="排序方式"><option value="updated" ${sort==='updated'?'selected':''}>最近更新</option><option value="title" ${sort==='title'?'selected':''}>名称排序</option></select></div>${list.length?`<div class="card-grid">${list.map(card).join('')}</div>`:`<div class="empty"><span class="empty-label">${query?'无搜索结果':'暂无内容'}</span><button class="secondary" data-new="${categories[view]?view:'inbox'}">添加 ＋</button></div>`}`;
}

async function openEditor(type='inbox',record=null){if(transitioning)return;if($('#editor').open&&!await closeEditor())return;if(transitioning||editorSession)return;if(!categories[type])type='inbox';const r=record||{type,title:'',description:'',content:'',tags:[],status:type==='prompts'?'待测试':'待整理',model:'',links:[],image:'',url:''};const dialog=$('#editor');dialog.innerHTML=`<form id="record-form"><div class="dialog-head"><div><h2 id="editor-title">${record?'编辑':'新增'}</h2></div><button type="button" class="close" data-close="editor" aria-label="关闭">×</button></div><div class="form-grid"><label>所属创作库<select name="type">${Object.entries(categories).map(([id,c])=>`<option value="${id}" ${id===r.type?'selected':''}>${c[0]}</option>`).join('')}</select></label><label>当前状态<select name="status">${statuses.map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}</select></label></div><label>名称 <em>*</em><input name="title" required maxlength="160" placeholder="名称" value="${esc(r.title)}"></label><label>简介<input name="description" maxlength="2000" placeholder="简介" value="${esc(r.description)}"></label><label>内容<textarea name="content" rows="7" maxlength="50000" placeholder="${categories[r.type][2]}">${esc(r.content)}</textarea></label><div class="form-grid"><label>标签<input name="tags" placeholder="标签，以逗号分隔" value="${esc(r.tags.join('，'))}"></label><label>模型 / 工具<input name="model" maxlength="100" placeholder="模型 / 版本" value="${esc(r.model)}"></label></div><label>链接<input name="url" type="url" placeholder="https://…" value="${esc(r.url)}"></label><label>封面图片 <small>PNG / JPG / WebP / GIF，最大 10 MB</small><input name="cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>${r.image?`<label class="check"><input type="checkbox" name="removeImage">移除当前封面</label>`:''}<label>关联资料 </label><div class="relation-picker">${records.filter(x=>x.id!==r.id).map(x=>`<label class="check"><input type="checkbox" name="links" value="${x.id}" ${r.links.includes(x.id)?'checked':''}><span>${esc(x.title)}<small>${categories[x.type][0]}</small></span></label>`).join('')||'<p>暂无资料</p>'}</div><div class="form-error" role="alert"></div><div class="dialog-footer"><button type="button" class="secondary" data-close="editor">取消</button><button type="submit" class="primary">保存</button></div></form>`;
const form=$('#record-form');
const session={id:++editorSequence,form,initial:editorSnapshot(form),saving:false};
editorSession=session;
form.onsubmit=async e=>{
  e.preventDefault();
  if(editorSession!==session||session.saving)return;
  const f=new FormData(form);const controls=[...form.elements];const submit=form.querySelector('[type=submit]');
  session.saving=true;controls.forEach(control=>control.disabled=true);submit.textContent='正在保存…';
  try{let image=f.get('removeImage')?'':r.image;const file=f.get('cover');if(file?.size){if(file.size>10*1024*1024)throw new Error('图片不能超过 10 MB');const result=await api('/api/upload',{method:'POST',headers:{'Content-Type':file.type},body:file});image=result.url;}const item={...r,type:f.get('type'),title:f.get('title'),description:f.get('description'),content:f.get('content'),status:f.get('status'),tags:f.get('tags').split(/[,，]/).map(s=>s.trim()).filter(Boolean),model:f.get('model'),url:f.get('url'),links:f.getAll('links'),image};const saved=await api('/api/records',{method:'POST',body:JSON.stringify(item)});records=[saved,...records.filter(x=>x.id!==saved.id)];
    if(editorSession===session&&await closeEditor({force:true,session})&&!editorSession){render();notify('已保存');}
  }catch(e){if(editorSession===session)form.querySelector('.form-error').textContent=e.message;}
  finally{session.saving=false;if(editorSession===session){controls.forEach(control=>control.disabled=false);submit.textContent='保存';}}
};dialog.showModal();animateDialog(dialog);}
function openDetail(id){const r=records.find(x=>x.id===id);if(!r)return;$('#detail').innerHTML=`<div class="dialog-head"><div><div class="eyebrow">${categories[r.type][0]} ${r.sample?' / 示例资料':''}</div><h2 id="detail-title" tabindex="-1">${esc(r.title)}</h2></div><button class="close" data-close="detail" aria-label="关闭">×</button></div>${r.image?`<button class="image-expand" data-enlarge="${r.id}" aria-label="放大封面"><img class="detail-image" src="${esc(r.image)}" alt="${esc(r.title)}"><span>全屏查看 ⤢</span></button>${imageDownload(r)}`:`<div class="detail-image-empty"><span>暂无图片</span><div class="detail-image-actions"><button class="secondary" data-add-image="${r.id}">添加图片 ＋</button><button class="image-download" disabled title="添加图片后可下载">下载图片 <span aria-hidden="true">↓</span></button></div></div>`}<p class="detail-description">${esc(r.description)}</p><div class="detail-meta"><span class="status">${esc(r.status)}</span>${r.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${r.model?`<span class="tag">${esc(r.model)}</span>`:''}</div><div class="content-heading"><h3>${r.type==='prompts'?'提示词正文':'详细内容'}</h3><button class="text-button" data-copy="${r.id}">⧉ 复制内容</button></div><pre class="detail-content">${esc(r.content||'暂无内容')}</pre>${r.url?`<a class="external-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">打开链接 ↗</a>`:''}<h3>关联资料</h3><div class="related">${[...new Set([...r.links,...records.filter(x=>x.links.includes(r.id)).map(x=>x.id)])].map(id=>records.find(x=>x.id===id)).filter(Boolean).map(x=>`<button data-related="${x.id}">${icons[x.type]} ${esc(x.title)} <span>↗</span></button>`).join('')||'<p>暂无关联</p>'}</div><div class="dialog-footer"><button class="danger" data-delete="${r.id}">删除资料</button><button class="secondary" data-duplicate="${r.id}">创建副本</button><button class="primary" data-edit="${r.id}">编辑资料</button></div>`;if(!$('#detail').open){$('#detail').showModal();animateDialog($('#detail'));}$('#detail').scrollTop=0;$('#detail-title')?.focus({preventScroll:true});}

async function dispatchAction(e){const b=e.target.closest('button');if(!b)return;if(b.dataset.discard){finishDiscard(b.dataset.discard==='discard');return;}if(transitioning)return;
  try{
    if(b.dataset.nav)return await switchView(b.dataset.nav);
    if(view==='home')return;
    if(b.dataset.stage){selectStage(b.dataset.stage);return;}
    if(b.dataset.stageStep){stepStage(Number(b.dataset.stageStep));return;}
    if(b.dataset.new)return await openEditor(b.dataset.new);
    if(b.dataset.open)return openDetail(b.dataset.open);
    if(b.dataset.related)return openDetail(b.dataset.related);
    if(b.dataset.close)return await closeOverlay(b.dataset.close);
    if(b.dataset.filter){filter=b.dataset.filter;return renderMain();}
    if(b.dataset.tag){query=b.dataset.tag;filter='全部';render();openSearch();return;}
    if(b.dataset.star){b.disabled=true;const r=records.find(x=>x.id===b.dataset.star);const saved=await api('/api/records/'+r.id,{method:'PATCH',body:JSON.stringify({favorite:!r.favorite})});records=records.map(x=>x.id===r.id?saved:x);render();return;}
    if(b.dataset.copy){const r=records.find(x=>x.id===b.dataset.copy);await navigator.clipboard.writeText(r.content);notify('已复制');return;}
    if(b.dataset.addImage){const r=records.find(record=>record.id===b.dataset.addImage);if(!r)return;$('#detail').close();await openEditor(r.type,r);$('#record-form [name="cover"]')?.focus();return;}
    if(b.dataset.edit){$('#detail').close();const r=records.find(x=>x.id===b.dataset.edit);await openEditor(r.type,r);return;}
    if(b.dataset.duplicate){const r=records.find(x=>x.id===b.dataset.duplicate);$('#detail').close();await openEditor(r.type,{...r,id:undefined,title:r.title+' · 副本',sample:false});return;}
    if(b.dataset.delete){if(!confirm('删除这条资料？此操作无法撤销。'))return;await api('/api/records/'+b.dataset.delete,{method:'DELETE'});records=await api('/api/records');$('#detail').close();render();notify('已删除');return;}
    if(b.dataset.enlarge){const r=records.find(record=>record.id===b.dataset.enlarge);if(!r?.image)return;const box=$('#lightbox');box.innerHTML=`<div class="lightbox-actions">${imageDownload(r)}<button class="lightbox-close" data-close="lightbox" aria-label="关闭图片">关闭 ×</button></div><img src="${esc(r.image)}" alt="${esc(r.title)}">`;box.showModal();animateDialog(box);return;}
    if(b.dataset.action==='menu'){const menu=$('#studio-menu');const open=menu.hidden;menu.hidden=!open;document.querySelector('[data-action="menu"]').setAttribute('aria-expanded',String(open));closeSearch(false);return;}
    if(b.dataset.action==='search'){const panel=$('#search-panel');if(panel.hidden)openSearch();else closeSearch();return;}
    if(b.dataset.action==='search-close'){closeSearch();return;}
    if(b.dataset.action==='retry'){await load();return;}
    if(b.dataset.action==='import'){$('#import-file').click();return;}
    if(b.dataset.action==='export'){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),note:'图片需另行备份 data/uploads。',records},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='造物间-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已导出资料；图片需单独备份');}
  }catch(error){b.disabled=false;notify(error.message);}
}

let stageTouch=null,stageSwipeBlockedUntil=0;
document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&e.target.closest('.stage-media'))stageTouch={x:e.clientX,y:e.clientY,id:e.pointerId};});
document.addEventListener('pointercancel',()=>{stageTouch=null;});
document.addEventListener('pointerup',e=>{if(!stageTouch||e.pointerId!==stageTouch.id)return;const dx=e.clientX-stageTouch.x,dy=e.clientY-stageTouch.y;stageTouch=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){stageSwipeBlockedUntil=Date.now()+350;stepStage(dx<0?1:-1);}});
document.addEventListener('click',e=>{if(Date.now()<stageSwipeBlockedUntil&&e.target.closest('.stage-media')){e.preventDefault();e.stopImmediatePropagation();}},true);

document.addEventListener('click',dispatchAction);
document.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;filter='全部';renderMain();}});
document.addEventListener('change',e=>{if(e.target.id==='sort'){sort=e.target.value;renderMain();}});
function openSearch(){if(view==='home'||transitioning)return;const panel=$('#search-panel');if(!panel)return;panel.hidden=false;document.querySelector('[data-action="search"]')?.setAttribute('aria-expanded','true');$('#studio-menu').hidden=true;document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded','false');$('#search').focus();}
function closeSearch(clear=true){const panel=$('#search-panel');if(!panel)return;const restoreFocus=panel.contains(document.activeElement);panel.hidden=true;document.querySelector('[data-action="search"]')?.setAttribute('aria-expanded','false');if(clear&&query){query='';filter='全部';$('#search').value='';renderMain();}if(restoreFocus)document.querySelector('[data-action="search"]')?.focus();}
function animateDialog(d){if(!matchMedia('(prefers-reduced-motion: reduce)').matches)d.animate([{opacity:0,transform:d.id==='detail'?'translateX(30px)':'translateY(12px)'},{opacity:1,transform:'none'}],{duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});}
document.addEventListener('keydown',e=>{
  if(e.target.matches?.('.stage-tab')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();const index=stageModules.findIndex(module=>module.id===activeStageId);const step=e.key==='ArrowLeft'?-1:1;
    const next=e.key==='Home'?0:e.key==='End'?stageModules.length-1:(index+step+stageModules.length)%stageModules.length;
    selectStage(stageModules[next].id,{focus:true,direction:step});return;
  }
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(view!=='home'&&!document.querySelector('dialog[open]'))openSearch();}
  if(e.key==='Escape'&&view!=='home'&&!document.querySelector('dialog[open]')){const menu=$('#studio-menu');if(menu)menu.hidden=true;document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded','false');closeSearch();}
});
$('#import-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>10*1024*1024)throw new Error('备份文件不能超过 10 MB');const data=JSON.parse(await f.text());await api('/api/import',{method:'POST',body:JSON.stringify(data)});await load();notify('已导入');}catch(error){notify(error.message);}finally{e.target.value='';}};
for(const d of document.querySelectorAll('dialog')){
  d.addEventListener('click',async e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)await closeOverlay(d.id);}});
  if(d.id==='editor')d.addEventListener('cancel',async e=>{e.preventDefault();await closeEditor();});
  if(d.id==='discard-confirm')d.addEventListener('cancel',e=>{e.preventDefault();finishDiscard(false);});
}
window.addEventListener('popstate',async e=>{
  const targetIndex=Number.isInteger(e.state?.studioIndex)?e.state.studioIndex:null;
  const targetUrl=location.pathname+location.search+location.hash;
  if(restoringHistory!==null){
    if(targetIndex===restoringHistory)restoringHistory=null;
    else if(targetIndex!==null)history.go(restoringHistory-targetIndex);
    else{restoringHistory=null;history.replaceState({studioView:view,studioIndex:historyIndex},'',committedHistoryUrl);}
    return;
  }
  const request=++historyNavigationSequence;const session=editorSession;
  const allowed=await canLeaveEditor();
  if(request!==historyNavigationSequence)return;
  if(!allowed||editorSession!==session){
    const delta=targetIndex===null?0:historyIndex-targetIndex;
    if(delta){restoringHistory=historyIndex;history.go(delta);}
    else history.replaceState({studioView:view,studioIndex:historyIndex},'',committedHistoryUrl);
    return;
  }
  historyIndex=targetIndex??historyIndex;committedHistoryUrl=targetUrl;
  await switchView(e.state?.studioView||'home',{historyMode:'none',editorChecked:true,expectedSession:session});
});
window.addEventListener('beforeunload',e=>{if($('#editor').open&&(editorSession?.saving||editorHasChanges())){e.preventDefault();e.returnValue='';}});
history.replaceState({studioView:'home',studioIndex:historyIndex},'',location.pathname);
async function load(){isLoading=true;try{records=await api('/api/records');loadError='';}catch(e){loadError=e.message;}finally{isLoading=false;if(transitioning)needsDataRender=true;else if(view!=='home')render();}}
render();load();
