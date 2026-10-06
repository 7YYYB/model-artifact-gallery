"use strict";
const $ = id => document.getElementById(id);
const state = {items: [], model: '', favorites: false, edit: null, detail: null, mode: 'file', files: [], collapsed: new Set()};
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette = ['#75d6b4','#c1a0f0','#e4b277','#7ebee5','#ec96ac','#a8c97d','#8bcfcc'];
const color = model => palette[Array.from(model).reduce((n,c) => (n + c.codePointAt(0)) % palette.length,0)];
const date = text => new Date(text).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const size = n => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1) + ' KB' : (n/1048576).toFixed(1) + ' MB';
let toastTimer;
function toast(text) { $('toast').textContent=text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4000); }
async function api(path, options={}) {
 const response=await fetch(path, {...options,headers:{'Content-Type':'application/json','X-Library-Request':'1',...options.headers}});
 let data; try { data=await response.json(); } catch { throw new Error('服务响应异常，请检查启动窗口'); }
 if(!response.ok) throw new Error(data.error || '请求失败');
 return data;
}
function listen(id,event,fn) { $(id).addEventListener(event,e=>Promise.resolve(fn(e)).catch(err=>toast(err.message))); }
function iframe(id, title) { const f=document.createElement('iframe'); f.sandbox='allow-scripts'; f.referrerPolicy='no-referrer'; f.title=title; f.src='/preview/'+encodeURIComponent(id); return f; }
const observer=new IntersectionObserver(entries=>{
 for(const entry of entries){const holder=entry.target;
  if(entry.isIntersecting && $('autoplay').checked && !holder.querySelector('iframe')) {
   const f=iframe(holder.dataset.id, holder.dataset.title); f.tabIndex=-1; holder.prepend(f);
  } else if(!entry.isIntersecting) holder.querySelector('iframe')?.remove();
 }
},{rootMargin:'120px'});
const resizeObserver=new ResizeObserver(entries=>{for(const e of entries)e.target.style.setProperty('--scale',String(e.contentRect.width/1000));});
function sorted(items) {
 const mode=$('sort').value;
 return [...items].sort((a,b)=>mode==='rating'?b.rating-a.rating || b.createdAt.localeCompare(a.createdAt):mode==='name'?a.title.localeCompare(b.title,'zh'):mode==='old'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
}
function render() {
 observer.disconnect(); resizeObserver.disconnect();
 const models=[...new Set(state.items.map(x=>x.model))].sort((a,b)=>a.localeCompare(b));
 const favs=state.items.filter(x=>x.favorite).length;
 for(const id of ['all-count','stat-items']) $(id).textContent=state.items.length;
 for(const id of ['fav-count','stat-favorites']) $(id).textContent=favs;
 for(const id of ['model-count','stat-models']) $(id).textContent=models.length;
 $('nav-all').classList.toggle('active',!state.model&&!state.favorites);
 $('nav-favorites').classList.toggle('active',state.favorites);
 // Arena Agent leaderboard snapshot: 2026-10-06; source: https://arena.ai/leaderboard/agent
 const arenaModels=["Claude Fable 5.1 (Max)", "Claude Opus 5.5 (High)", "Claude Sonnet 5.5 (Max)", "GPT 6 Astra (Max)", "GPT 6.1 Sol (Max)", "GPT 6 Sol (Max)", "Claude Opus 5 (High)", "Claude Fable 5 (High)", "Claude Opus 5 (Max)", "Gemini 4 Argon (High)", "Claude Opus 4.8 (High)", "GPT 5.6 Sol (xHigh)", "Claude Sonnet 5 (High)", "Kimi K3 (Max)", "GPT 5.5 (xHigh)", "Grok 4.7 (xHigh)", "Deepseek V4.1 Flash (Max)", "Muse Spark 1.3 (Max)", "Hy4 preview", "GLM 5.2 (Max)", "MiMo V2.6 Pro", "Gemini 3.8 Flash (High)", "Qwen3.8 Max", "GLM 5.3 (Max)", "GPT 6 Luna (Max)", "Grok 4.6 (xHigh)", "Grok 4.5", "DeepSeek V4 Pro (High) (0813)", "GPT 5.4 (High)", "GPT 5.5", "Step 5 Preview", "GPT 5.6 Terra (xHigh)", "GLM 5.3 Flash", "MiMo V2.6 Flash", "Qwen3.8 Flash Next", "GPT 5.6 Luna (xHigh)", "Gemini 3.7 Flash (High)", "Qwen 3.8 27B", "Muse Spark 1.2 (xHigh)", "Muse Spark 1.1", "Qwen3.7 Max", "Hy3", "Minimax M3", "Qwen3.7 Plus", "Mimo V2.5 Pro", "Gemini 3.6 Flash (High)", "Gemini 3.1 Pro Preview", "Inkling Small", "Inkling", "Mistral Medium 3.5", "Solar Pro 4"];
 const select=$('models'), previous=select.value;
 const customModels=models.filter(model=>!arenaModels.includes(model));
 const options=list=>list.map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join('');
 select.innerHTML='<option value="">请选择模型</option><optgroup label="Arena Agent · 51 个模型">'+options(arenaModels)+'</optgroup>'+(customModels.length?'<optgroup label="已使用的其他模型">'+options(customModels)+'</optgroup>':'')+'<option value="__custom_model__">＋ 自定义模型…</option>';
 select.value=previous;
 select.onchange=()=>{const custom=select.value==='__custom_model__';$('custom-model').hidden=!custom;$('custom-model').required=custom;if(custom)$('custom-model').focus();};
 $('model-nav').innerHTML=models.map(m=>`<button class="model-link ${state.model===m?'active':''}" data-model="${esc(m)}"><i class="model-dot" style="background:${color(m)}"></i><span>${esc(m)}</span><b>${state.items.filter(x=>x.model===m).length}</b></button>`).join('') || '<p class="hint">添加作品后，模型会自动出现在这里。</p>';
 const query=$('search').value.trim().toLowerCase(), category=$('category-filter').value;
 const items=sorted(state.items.filter(x=>(!state.model||x.model===state.model)&&(!state.favorites||x.favorite)&&(!category||x.category===category)&&(!query||[x.title,x.model,x.prompt,x.notes,x.source,...x.tags].join(' ').toLowerCase().includes(query))));
 $('view-label').textContent=state.model || (state.favorites?'我的收藏':'全部作品');
 $('result-count').textContent=items.length+' 件作品';
 $('empty').hidden=state.items.length!==0;
 const groups=new Map(); for(const item of items){if(!groups.has(item.model))groups.set(item.model,[]);groups.get(item.model).push(item);}
 $('gallery').innerHTML=[...groups].map(([model,entries])=>{
  const collapsed=state.collapsed.has(model), kinds=[...new Set(entries.map(x=>x.category))];
  return `<section class="group"><button class="group-heading" data-collapse="${esc(model)}" aria-expanded="${!collapsed}"><i class="model-dot" style="background:${color(model)}"></i><strong>${esc(model)}</strong><span class="group-count">${entries.length} 件作品</span><span class="group-types">${kinds.map(esc).join(' / ')}　${collapsed?'＋':'−'}</span></button><div class="cards" ${collapsed?'hidden':''}>${entries.map(card).join('')}</div></section>`;
 }).join('');
 if(state.items.length&&!items.length) $('gallery').innerHTML='<div class="no-results">没有符合条件的作品<button id="reset-filters" class="secondary">清除筛选</button></div>';
 $('gallery').querySelectorAll('.thumb').forEach(el=>{resizeObserver.observe(el);if(!el.closest('[hidden]'))observer.observe(el);});
}
function card(item) {
 const stars=item.rating?'★'.repeat(item.rating)+'☆'.repeat(5-item.rating):'未评分';
 return `<article class="card"><div class="thumb" data-id="${item.id}" data-title="${esc(item.title)}" role="button" tabindex="0" aria-label="预览 ${esc(item.title)}"><div class="placeholder"><span>${item.kind==='image'?'▧':'◈'}</span><small>${$('autoplay').checked?'正在载入预览…':'点击查看作品'}</small></div><span class="badge">${esc(item.category)}</span><button class="card-fav ${item.favorite?'on':''}" data-fav="${item.id}" aria-label="${item.favorite?'取消收藏':'收藏'} ${esc(item.title)}">${item.favorite?'★':'☆'}</button></div><div class="card-info"><button class="card-title" data-open="${item.id}" title="${esc(item.title)}">${esc(item.title)}</button><div class="card-model" style="color:${color(item.model)}">${esc(item.model)} <span style="color:#597681">· ${esc(item.source||'手动导入')}</span></div><div class="card-bottom"><span>${date(item.createdAt)}</span><span class="rating">${stars}</span></div></div></article>`;
}
async function load() { const result=await api('/api/items');state.items=result.items;render(); }
async function patch(id, data) {
 const updated=await api('/api/items/'+id,{method:'PUT',body:JSON.stringify(data)});
 state.items=state.items.map(x=>x.id===id?updated:x);
 if(state.detail?.id===id)state.detail={...state.detail,...updated};
 render(); return updated;
}
function resetFilters(){state.model='';state.favorites=false;$('search').value='';$('category-filter').value='';render();}
function chooseMode(mode){state.mode=mode;$('dropzone').hidden=mode!=='file';$('code-wrap').hidden=mode!=='code';$('tab-file').classList.toggle('selected',mode==='file');$('tab-code').classList.toggle('selected',mode==='code');}
function setFiles(files){state.files=[...files];$('file-label').textContent=state.files.length?`已选择 ${state.files.length} 个文件：${state.files.map(f=>f.name).join('、')}`:'点击选择，或将作品拖到这里';}
function openEditor(item=null){
 state.edit=item;const form=$('item-form');form.reset();setFiles([]);$('files').value='';$('html-code').value='';$('form-error').textContent='';$('save-button').disabled=false;
 $('editor-title').textContent=item?'编辑作品':'添加作品';$('upload-section').hidden=!!item;chooseMode('file');
 for(const name of ['model','title','category','source','prompt','notes'])form.elements[name].value=item?.[name] || (name==='category'?'2D':name==='model'?state.model:'');
 form.elements.tags.value=item?.tags.join(', ')||'';
 $('custom-model').hidden=true;$('custom-model').required=false;$('custom-model').value='';
 $('editor').showModal();
}
function closeEditor(){if(!$('save-button').disabled)$('editor').close();}
async function readFile(file){
 if(file.size>10*1024*1024)throw new Error(file.name+' 超过10MB上限');
 const ext=file.name.split('.').pop().toLowerCase();
 if(['html','htm'].includes(ext))return {kind:'html',mime:'text/html',content:await file.text(),originalName:file.name};
 const mimes={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
 if(!mimes[ext])throw new Error('不支持的文件类型：'+file.name);
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取文件失败：'+file.name));reader.readAsDataURL(file);});
 return {kind:'image',mime:mimes[ext],content:data.slice(data.indexOf(',')+1),originalName:file.name};
}
async function submit(e){
 e.preventDefault();const form=e.currentTarget;const save=$('save-button');save.disabled=true;save.textContent='正在保存…';$('form-error').textContent='';
 try{
  const fields=Object.fromEntries(['title','model','category','source','prompt','notes'].map(name=>[name,form.elements[name].value.trim()]));
  fields.tags=form.elements.tags.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean);
  if(fields.model==='__custom_model__')fields.model=form.elements.customModel.value.trim();
  if(!fields.model)throw new Error('请填写模型名称');
  if(state.edit){if(!fields.title)throw new Error('请填写作品名称');await patch(state.edit.id,fields);}
  else if(state.mode==='code'){
   if(!fields.title)throw new Error('请填写作品名称');
   let content=$('html-code').value.trim().replace(/^```(?:html)?\s*\n/i,'').replace(/\n```\s*$/,'');
   if(!content)throw new Error('请粘贴HTML代码');
   await api('/api/items',{method:'POST',body:JSON.stringify({...fields,kind:'html',content,originalName:fields.title+'.html'})});
  } else {
   if(!state.files.length)throw new Error('请选择至少一个文件');
   const items=[];
   for(const file of state.files){const data=await readFile(file);items.push({...fields,...data,title:state.files.length===1&&fields.title?fields.title:file.name.replace(/\.[^.]+$/,''),category:data.kind==='image'&&fields.category==='2D'?'图像':fields.category});}
   await api('/api/import',{method:'POST',body:JSON.stringify({format:'model-library',version:1,items})});
  }
  $('editor').close();if(state.edit&&state.detail){state.detail={...state.detail,...fields};updateDetail();}await load();toast('作品已保存到本机');
 }catch(err){$('form-error').textContent=err.message;}finally{save.disabled=false;save.textContent='保存到作品库';}
}
async function showDetail(id){
 state.detail=await api('/api/items/'+id);$('large-preview').replaceChildren(iframe(id,state.detail.title));updateDetail();$('detail').showModal();
}
function updateDetail(){
 const d=state.detail;if(!d)return;
 $('detail-model').textContent=d.model+' / '+d.category;$('detail-title').textContent=d.title;
 $('detail-fav').textContent=d.favorite?'★ 已收藏':'☆ 收藏';
 $('stars').innerHTML=[1,2,3,4,5].map(n=>`<button class="${d.rating>=n?'on':''}" data-rating="${n}" aria-label="评分 ${n} 星" title="再次点击当前评分可清零">★</button>`).join('');
 $('detail-tags').innerHTML=d.tags.length?d.tags.map(t=>`<span>${esc(t)}</span>`).join(''):'<span>暂无标签</span>';
 $('detail-prompt').textContent=d.prompt||'尚未记录提示词';$('detail-notes').textContent=d.notes||'尚未添加笔记';
 $('detail-meta').innerHTML=`<dt>来源</dt><dd>${esc(d.source||'手动导入')}</dd><dt>文件</dt><dd>${esc(d.originalName||'粘贴的 HTML')}</dd><dt>大小</dt><dd>${size(d.bytes)}</dd><dt>添加于</dt><dd>${date(d.createdAt)}</dd><dt>预览</dt><dd>沙箱隔离 · 禁止联网</dd>`;
}
function closeDetail(){ $('detail').close();$('large-preview').replaceChildren(); }
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
listen('add-button','click',()=>openEditor());listen('empty-add','click',()=>openEditor());
for(const btn of document.querySelectorAll('.close-editor'))btn.addEventListener('click',closeEditor);
$('editor').addEventListener('cancel',e=>{if($('save-button').disabled)e.preventDefault();});
listen('tab-file','click',()=>chooseMode('file'));listen('tab-code','click',()=>chooseMode('code'));
listen('files','change',e=>setFiles(e.target.files));listen('item-form','submit',submit);
for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(type==='drop')setFiles(e.dataTransfer.files);});
listen('nav-all','click',resetFilters);listen('nav-favorites','click',()=>{state.model='';state.favorites=true;render();});
listen('model-nav','click',e=>{const button=e.target.closest('[data-model]');if(button){state.model=button.dataset.model;state.favorites=false;render();}});
listen('search','input',render);listen('sort','change',render);listen('category-filter','change',render);listen('autoplay','change',render);
listen('gallery','click',async e=>{
 const favorite=e.target.closest('[data-fav]');if(favorite){const item=state.items.find(x=>x.id===favorite.dataset.fav);await patch(item.id,{favorite:!item.favorite});return;}
 const collapse=e.target.closest('[data-collapse]');if(collapse){const model=collapse.dataset.collapse;state.collapsed.has(model)?state.collapsed.delete(model):state.collapsed.add(model);render();return;}
 const open=e.target.closest('[data-open]')||e.target.closest('.thumb');if(open){await showDetail(open.dataset.open||open.dataset.id);return;}
 if(e.target.id==='reset-filters')resetFilters();
});
listen('gallery','keydown',e=>{if(e.target.classList.contains('thumb')&&['Enter',' '].includes(e.key)){e.preventDefault();return showDetail(e.target.dataset.id);}});
listen('close-detail','click',closeDetail);$('detail').addEventListener('close',()=>$('large-preview').replaceChildren());
listen('detail-fav','click',async()=>{await patch(state.detail.id,{favorite:!state.detail.favorite});updateDetail();});
listen('stars','click',async e=>{const btn=e.target.closest('[data-rating]');if(btn){const value=Number(btn.dataset.rating);await patch(state.detail.id,{rating:state.detail.rating===value?0:value});updateDetail();}});
listen('edit-item','click',()=>{const item=state.detail;closeDetail();openEditor(item);});
listen('delete-item','click',async()=>{if(!confirm('永久删除「'+state.detail.title+'」？建议先导出备份。'))return;await api('/api/items/'+state.detail.id,{method:'DELETE'});closeDetail();await load();toast('作品已删除');});
listen('download-item','click',()=>{
 const d=state.detail;let blob;
 if(d.kind==='html')blob=new Blob([d.content],{type:'text/html;charset=utf-8'});
 else{const bytes=Uint8Array.from(atob(d.content),c=>c.charCodeAt(0));blob=new Blob([bytes],{type:d.mime});}
 const ext={ 'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/svg+xml':'svg'};
 download(blob,(d.originalName||d.title+'.'+(d.kind==='html'?'html':ext[d.mime])).replace(/[\\/:*?"<>|]/g,'_'));
});
listen('export','click',async()=>{const data=await api('/api/export');download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'model-library-'+new Date().toISOString().slice(0,10)+'.json');toast('备份包含所有作品内容和记录');});
listen('restore','click',()=>$('backup-file').click());
listen('backup-file','change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{if(file.size>100*1024*1024)throw new Error('备份文件超过100MB，请拆分导入');
 const data=JSON.parse(await file.text());if(data.format!=='model-library'||data.version!==1||!Array.isArray(data.items))throw new Error('不是有效的作品库备份');
 if(!confirm('将追加导入 '+data.items.length+' 件作品，不覆盖现有记录。继续吗？'))return;
 const result=await api('/api/import',{method:'POST',body:JSON.stringify(data)});await load();toast('已恢复 '+result.imported+' 件作品');
 }finally{e.target.value='';}
});
(async()=>{try{const info=await api('/api/info');$('connection').innerHTML='<i></i>本地服务已连接';$('data-path').textContent=info.dataPath;await load();}catch(err){$('connection').textContent='服务未连接';$('error-banner').hidden=false;$('error-banner').textContent='无法连接本地服务。请双击项目目录中的“启动作品库.cmd”，然后通过 http://127.0.0.1:8765 打开。'+err.message;}})();
