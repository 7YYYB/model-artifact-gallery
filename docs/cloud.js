'use strict';
(() => {
 const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const MODELS=["Claude Fable 5.1 (Max)","Claude Opus 5.5 (High)","Claude Sonnet 5.5 (Max)","GPT 6 Astra (Max)","GPT 6.1 Sol (Max)","GPT 6 Sol (Max)","Claude Opus 5 (High)","Claude Fable 5 (High)","Claude Opus 5 (Max)","Gemini 4 Argon (High)","Claude Opus 4.8 (High)","GPT 5.6 Sol (xHigh)","Claude Sonnet 5 (High)","Kimi K3 (Max)","GPT 5.5 (xHigh)","Grok 4.7 (xHigh)","Deepseek V4.1 Flash (Max)","Muse Spark 1.3 (Max)","Hy4 preview","GLM 5.2 (Max)","MiMo V2.6 Pro","Gemini 3.8 Flash (High)","Qwen3.8 Max","GLM 5.3 (Max)","GPT 6 Luna (Max)","Grok 4.6 (xHigh)","Grok 4.5","DeepSeek V4 Pro (High) (0813)","GPT 5.4 (High)","GPT 5.5","Step 5 Preview","GPT 5.6 Terra (xHigh)","GLM 5.3 Flash","MiMo V2.6 Flash","Qwen3.8 Flash Next","GPT 5.6 Luna (xHigh)","Gemini 3.7 Flash (High)","Qwen 3.8 27B","Muse Spark 1.2 (xHigh)","Muse Spark 1.1","Qwen3.7 Max","Hy3","Minimax M3","Qwen3.7 Plus","Mimo V2.5 Pro","Gemini 3.6 Flash (High)","Gemini 3.1 Pro Preview","Inkling Small","Inkling","Mistral Medium 3.5","Solar Pro 4"];
 const MIME={html:'text/html',htm:'text/html',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
 const CSP="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 let db=null,items=[],selected=null,previewVersion=0,loadVersion=0,loadError='',toastTimer;
 const contentCache=new Map();
 let coverObserver=null,coverResize=null,coverEpoch=0,coverActive=0;
 const coverQueue=[];
 function contentFor(id){
  needDB();
  if(contentCache.has(id)){const hit=contentCache.get(id);contentCache.delete(id);contentCache.set(id,hit);return hit;}
  const pending=(async()=>{const {data,error}=await db.rpc('artifact_content',{p_id:id});if(error)throw error;return data;})().catch(e=>{if(contentCache.get(id)===pending)contentCache.delete(id);throw e;});
  contentCache.set(id,pending);
  while(contentCache.size>24)contentCache.delete(contentCache.keys().next().value);
  return pending;
 }
 function resetCovers(){
  coverEpoch++;coverObserver?.disconnect();coverResize?.disconnect();coverQueue.length=0;
 }
 function fitCover(cover){
  const frame=cover.querySelector('iframe');
  if(frame)frame.style.transform='scale('+(cover.clientWidth/960)+')';
 }
 function observeCovers(){
  const covers=$('gallery').querySelectorAll('[data-cover]');
  if('ResizeObserver' in window){coverResize=new ResizeObserver(entries=>entries.forEach(e=>fitCover(e.target)));covers.forEach(c=>coverResize.observe(c));}
  if('IntersectionObserver' in window){
   coverObserver=new IntersectionObserver(entries=>entries.forEach(({target:cover,isIntersecting})=>{
    cover.dataset.visible=isIntersecting?'1':'0';
    if(isIntersecting)queueCover(cover);
    else{cover.querySelector('.card-preview').replaceChildren();cover.classList.remove('preview-ready');cover.querySelector('.cover-status').hidden=false;}
   }),{rootMargin:'220px'});
   covers.forEach(c=>coverObserver.observe(c));
  }else covers.forEach(c=>{c.dataset.visible='1';queueCover(c);});
 }
 function queueCover(cover){
  if(cover.dataset.queued==='1'||cover.dataset.loading==='1'||cover.querySelector('iframe'))return;
  cover.dataset.queued='1';coverQueue.push({cover,epoch:coverEpoch});drainCovers();
 }
 function drainCovers(){
  while(coverActive<3&&coverQueue.length){
   const job=coverQueue.shift(),cover=job.cover;delete cover.dataset.queued;
   if(job.epoch!==coverEpoch||!cover.isConnected||cover.dataset.visible!=='1')continue;
   coverActive++;cover.dataset.loading='1';
   loadCover(job).finally(()=>{delete cover.dataset.loading;coverActive--;drainCovers();});
  }
 }
 async function loadCover({cover,epoch}){
  const status=cover.querySelector('.cover-status');status.textContent='正在加载实时预览…';status.hidden=false;
  try{
   const data=await contentFor(cover.dataset.cover);
   if(epoch!==coverEpoch||!cover.isConnected||cover.dataset.visible!=='1')return;
   const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');frame.title='作品实时缩略预览';
   frame.addEventListener('load',()=>{if(frame.isConnected){cover.classList.add('preview-ready');status.hidden=true;}},{once:true});
   frame.srcdoc=sourceDocument(data);cover.querySelector('.card-preview').replaceChildren(frame);fitCover(cover);
  }catch(e){if(epoch===coverEpoch&&cover.isConnected){status.textContent='预览加载失败，点击卡片查看';status.title=err(e);}}
 }
 function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000);}
 function err(e){return e?.message||'操作失败，请稍后重试';}
 function on(id,event,fn){$(id).addEventListener(event,e=>Promise.resolve(fn(e)).catch(x=>toast(err(x))));}
 function needDB(){if(!db)throw new Error('云端配置或连接组件尚未就绪，请刷新或联系管理员');}
 $('model').innerHTML='<option value="">请选择模型</option><optgroup label="Arena Agent · 51 个模型">'+MODELS.map(m=>`<option>${esc(m)}</option>`).join('')+'</optgroup><option value="__custom__">＋ 自定义模型</option>';
 function render(){
  resetCovers();
  const model=$('filter-model').value,query=$('search').value.trim().toLowerCase();
  const filtered=items.filter(a=>(!model||a.model===model)&&(!query||[a.title,a.model,a.prompt,a.author_name].some(t=>String(t??'').toLowerCase().includes(query))));
  $('total').textContent=String(items.length);$('count').textContent=filtered.length+' 件作品';$('heading').textContent=model||'全部作品';
  $('status').textContent=loadError||(!filtered.length?(items.length?'没有符合筛选条件的作品。':'社区还没有作品。直接分享第一个作品吧。'):'');
  $('gallery').innerHTML=filtered.map(a=>{const type=a.mime==='text/html'?'HTML':a.mime==='image/svg+xml'?'SVG':'IMAGE';return `<article class="card"><div class="card-cover" data-cover="${esc(a.id)}"><div class="card-preview"></div><span class="cover-status">正在加载实时预览…</span><span class="card-type">${type}</span><button class="card-open" data-open="${esc(a.id)}" aria-label="放大预览 ${esc(a.title)}"><span>↗ 放大</span></button></div><div class="card-body"><button class="card-title" data-open="${esc(a.id)}">${esc(a.title)}</button><div class="card-model">${esc(a.model)}</div><div class="card-bottom"><span>${esc(a.author_name)}</span><time>${esc(new Date(a.created_at).toLocaleDateString('zh-CN'))}</time></div></div></article>`;}).join('');
  observeCovers();
 }
 function modelFilters(){const previous=$('filter-model').value,models=[...new Set(items.map(a=>a.model))].sort((a,b)=>a.localeCompare(b));$('filter-model').innerHTML='<option value="">全部模型</option>'+models.map(m=>`<option>${esc(m)}</option>`).join('');$('filter-model').value=models.includes(previous)?previous:'';$('model-nav').innerHTML=models.map(m=>`<button class="nav" data-filter="${esc(m)}"><span>${esc(m)}</span><b>${items.filter(a=>a.model===m).length}</b></button>`).join('')||'<p class="hint">发布后自动归类</p>';}
 async function load(){needDB();const version=++loadVersion;$('refresh').disabled=true;$('status').textContent='正在读取社区作品…';try{const all=[];for(let offset=0;;offset+=500){const {data,error}=await db.from('artifacts').select('id,title,model,author_name,prompt,mime,byte_size,created_at').order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);if(version!==loadVersion)return;if(error)throw error;all.push(...(data||[]));if(!data||data.length<500)break;}items=[...new Map(all.map(a=>[a.id,a])).values()];loadError='';modelFilters();render();}catch(e){if(version===loadVersion){loadError='读取失败：'+err(e);render();}}finally{if(version===loadVersion)$('refresh').disabled=false;}}
 async function filePayload(file){if(!file||!file.size||file.size>1048576)throw new Error('请选择不超过1 MiB的非空文件');const extension=file.name.split('.').pop().toLowerCase(),mime=MIME[extension];if(!mime)throw new Error('仅支持 HTML、SVG、PNG、JPEG、WEBP、GIF');if(mime==='text/html'||mime==='image/svg+xml'){const content=await file.text();if(new TextEncoder().encode(content).length>1048576)throw new Error('UTF-8内容超过1 MiB');return {content,mime};}const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file);});return {content:data.substring(data.indexOf(',')+1),mime};}
 async function publish(e){e.preventDefault();needDB();if(!$('upload-form').reportValidity())return;$('publish').disabled=true;$('upload-status').textContent='正在校验并上传，请不要关闭窗口…';try{const payload=await filePayload($('file').files[0]);const model=$('model').value==='__custom__'?$('custom-model').value.trim():$('model').value;const {error}=await db.rpc('publish_artifact',{p_title:$('title').value.trim(),p_model:model,p_author_name:$('author').value.trim(),p_prompt:$('prompt').value.trim(),p_mime:payload.mime,p_content:payload.content});if(error)throw error;$('upload-form').reset();$('custom-label').hidden=true;$('custom-model').required=false;$('upload-status').textContent='';$('upload-dialog').close();toast('作品已发布到公开社区');await load();}catch(e){$('upload-status').textContent=err(e);}finally{$('publish').disabled=false;}}
 function sourceDocument(data){if(!data||typeof data.content!=='string'||!Object.values(MIME).includes(data.mime))throw new Error('作品内容不存在或格式无效');const prefix='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+CSP+'"><meta name="referrer" content="no-referrer">';if(data.mime==='text/html'||data.mime==='image/svg+xml')return prefix+data.content;if(!/^[A-Za-z0-9+/]*={0,2}$/.test(data.content))throw new Error('图片编码无效');return prefix+'<style>html,body{margin:0;height:100%;background:#111820;display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style><img alt="社区图片作品" src="data:'+data.mime+';base64,'+data.content+'">';}
 async function preview(id){needDB();selected=items.find(a=>a.id===id);if(!selected)return;const version=++previewVersion;$('preview-title').textContent=selected.title;$('preview-model').textContent=selected.model;$('preview-author').textContent='作者：'+selected.author_name;$('preview-prompt').textContent=selected.prompt||'作者未提供提示词';$('preview-area').replaceChildren();$('preview-status').textContent='正在读取作品…';$('preview-dialog').showModal();try{const data=await contentFor(id);if(version!==previewVersion||!$('preview-dialog').open)return;const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.referrerPolicy='no-referrer';f.title=selected.title;f.srcdoc=sourceDocument(data);$('preview-area').append(f);$('preview-status').textContent='';}catch(e){if(version===previewVersion)$('preview-status').textContent=err(e);}}
 document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));$('preview-dialog').addEventListener('close',()=>{previewVersion++;$('preview-area').replaceChildren();selected=null;});
 on('upload-open','click',()=>{needDB();$('upload-status').textContent='';$('upload-dialog').showModal();});on('upload-form','submit',publish);on('model','change',()=>{const custom=$('model').value==='__custom__';$('custom-label').hidden=!custom;$('custom-model').required=custom;});on('file','change',()=>{const f=$('file').files[0];if(f&&!$('title').value)$('title').value=f.name.replace(/\.[^.]+$/,'').slice(0,160);});
 on('refresh','click',load);on('search','input',render);on('filter-model','change',render);on('browse','click',()=>{$('filter-model').value='';render();});on('model-nav','click',e=>{const b=e.target.closest('[data-filter]');if(b){$('filter-model').value=b.dataset.filter;render();}});on('gallery','click',e=>{const b=e.target.closest('[data-open]');if(b)return preview(b.dataset.open);});
 async function init(){try{const config=window.CLOUD_CONFIG;if(!window.supabase?.createClient)throw new Error('社区连接组件加载失败，请检查网络后刷新');if(!config?.url?.startsWith('https://')||!config.anonKey)throw new Error('云端尚未配置完成，请稍后再来');db=window.supabase.createClient(config.url,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});await load();}catch(e){loadError=err(e);render();$('upload-open').disabled=$('refresh').disabled=true;}}
 init();
})();
