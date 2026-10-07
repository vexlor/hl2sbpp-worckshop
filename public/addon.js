const $ = s => document.querySelector(s);
let addonId = Number(location.pathname.match(/^\/addon\/(\d+)\/?$/)?.[1] || 0);
let addonData = null;

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function avatar(url,name){return url?`<img class="avatar" src="${esc(url)}" alt="">`:`<span class="avatar avatar-letter">${esc((name||'?')[0].toUpperCase())}</span>`;}
function badge(role){return role==='admin'?'<span class="verified" title="Официальный администратор">✓</span>':'';}
function stars(likes){const n=Math.max(0,Math.min(5,Math.round(Number(likes||0)/5)));return `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5-n)}</span>`;}
function formatSize(n){if(!n)return '—';const u=['B','KB','MB','GB'];let i=0,v=Number(n);while(v>=1024&&i<3){v/=1024;i++;}return `${v.toFixed(i?1:0)} ${u[i]}`;}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Ошибка ${r.status}`);return data;}
function setStatus(s){$('#pageStatus').textContent=s||'';}

function render(d){
  addonData=d; const a=d.addon; const images=[a.cover_image,...(d.images||[]).map(x=>x.image_url)].filter(Boolean);
  document.title=`${a.title} — HL2SBPP Workshop`;
  $('#addonPage').innerHTML=`
    <div>
      <article class="addon-card-page">
        <div class="hero-media">${images[0]?`<img id="mainImage" src="${esc(images[0])}" alt="${esc(a.title)}">`:'<div class="media-empty">◇</div>'}</div>
        ${images.length?`<div class="thumb-row">${images.map((src,i)=>`<button type="button" class="${i===0?'active':''}" data-src="${esc(src)}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>`:''}
        <div class="addon-content">
          <div class="addon-title-row"><div><h1>${esc(a.title)}</h1><div class="author-row">${avatar(a.author_avatar,a.author)}<span>${esc(a.author)} ${badge(a.author_role)}</span></div></div><div class="rating-box">${stars(a.likes)}<small>${a.likes} оценок</small></div></div>
          <div class="desc">${esc(a.description||'Без описания')}</div>
          <div class="tags"><span class="tag">${esc(a.category)}</span><span class="tag">v${esc(a.version)}</span></div>
        </div>
      </article>
      <section class="comments-box">
        <div class="comments-head"><h2>Комментарии</h2><span id="commentCount">${d.comments?.length||0}</span></div>
        <form id="commentForm" class="comment-form"><input id="commentInput" name="body" maxlength="1000" autocomplete="off" placeholder="Написать комментарий..." required><button type="submit">Отправить</button></form>
        <div id="commentsList">${renderComments(d.comments||[])}</div>
      </section>
    </div>
    <aside class="side-card">
      <div class="mini-cover">${images[0]?`<img src="${esc(images[0])}" alt="">`:''}</div>
      <h2>Информация об аддоне</h2>
      <div class="info-list"><div><span>Автор</span><b>${esc(a.author)}</b></div><div><span>Категория</span><b>${esc(a.category)}</b></div><div><span>Версия</span><b>${esc(a.version)}</b></div><div><span>Размер</span><b>${formatSize(a.file_size)}</b></div><div><span>Скачиваний</span><b id="downloadCount">${a.downloads}</b></div><div><span>Добавлен</span><b>${new Date(a.created_at).toLocaleDateString('ru-RU')}</b></div></div>
      <button id="downloadBtn" class="primary wide" type="button">⇩ Скачать аддон</button>
      <div class="action-row"><button id="likeBtn" type="button">♡ Лайк <span id="likeCount">${a.likes}</span></button><button id="subBtn" type="button">☆ Подписаться</button></div>
    </aside>`;
  $('#addonPage').hidden=false; setStatus('');
  document.querySelectorAll('.thumb-row button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.thumb-row button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#mainImage').src=b.dataset.src;}));
  $('#commentForm').addEventListener('submit',submitComment);
  $('#downloadBtn').addEventListener('click',downloadAddon);
  $('#likeBtn').addEventListener('click',likeAddon);
  $('#subBtn').addEventListener('click',subscribeAddon);
}
function renderComments(list){if(!list.length)return '<div class="muted">Комментариев пока нет.</div>';return list.map(c=>`<div class="comment"><div>${avatar(c.avatar_url,c.username)}</div><div class="comment-body"><div class="comment-head"><strong>${esc(c.username)} ${badge(c.role)}</strong><span>${new Date(c.created_at).toLocaleString('ru-RU')}</span></div><p>${esc(c.body)}</p></div></div>`).join('');}

async function load(){
  if(!addonId){setStatus('Некорректный адрес аддона.');return;}
  try{const me=await api('/api/me');if(!me.user){setStatus('Нужно войти в аккаунт.');$('#addonPage').hidden=false;$('#addonPage').innerHTML='<div class="addon-card-page error-box"><h1>Вход требуется</h1><p>Открой главную страницу и войди в аккаунт, затем вернись к аддону.</p><a class="primary" href="/">Открыть Workshop</a></div>';return;}const d=await api(`/api/addons/${addonId}`);render(d);}catch(e){setStatus('');$('#addonPage').hidden=false;$('#addonPage').innerHTML=`<div class="addon-card-page error-box"><h1>Не удалось открыть аддон</h1><p>${esc(e.message)}</p><a class="primary" href="/">Вернуться в Workshop</a></div>`;}}

async function submitComment(e){e.preventDefault();e.stopImmediatePropagation();const input=$('#commentInput');const body=input.value.trim();if(!body)return;const btn=e.submitter;btn.disabled=true;try{const d=await api(`/api/addons/${addonId}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body})});const list=document.querySelector('#commentsList');if(list.querySelector('.muted'))list.innerHTML='';list.insertAdjacentHTML('afterbegin',`<div class="comment"><div>${avatar(d.comment.avatar_url,d.comment.username)}</div><div class="comment-body"><div class="comment-head"><strong>${esc(d.comment.username)} ${badge(d.comment.role)}</strong><span>${new Date(d.comment.created_at).toLocaleString('ru-RU')}</span></div><p>${esc(d.comment.body)}</p></div></div>`);const count=$('#commentCount');count.textContent=String(Number(count.textContent||0)+1);input.value='';toast('Комментарий добавлен');}catch(err){toast(err.message);}finally{btn.disabled=false;}}

async function downloadAddon(){const btn=$('#downloadBtn');btn.disabled=true;const old=btn.textContent;btn.textContent='Подготовка файла...';try{const r=await fetch(`/api/addons/${addonId}/download`,{credentials:'same-origin'});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Не удалось скачать файл');}const blob=await r.blob();const cd=r.headers.get('Content-Disposition')||'';let name='addon.zip';const m=cd.match(/filename="?([^";]+)"?/i);if(m)name=decodeURIComponent(m[1]);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);const n=$('#downloadCount');n.textContent=String(Number(n.textContent||0)+1);toast('Скачивание началось');}catch(err){toast(err.message);}finally{btn.disabled=false;btn.textContent=old;}}
async function likeAddon(){try{const d=await api(`/api/addons/${addonId}/like`,{method:'POST'});$('#likeCount').textContent=d.likes;toast('Оценка обновлена');}catch(e){toast(e.message);}}
async function subscribeAddon(){try{const d=await api(`/api/addons/${addonId}/subscribe`,{method:'POST'});$('#subBtn').textContent=d.subscribed?'✓ Подписка':'☆ Подписаться';toast(d.subscribed?'Вы подписались':'Подписка отменена');}catch(e){toast(e.message);}}

$('#backBtn').addEventListener('click',()=>{if(history.length>1)history.back();else location.href='/';});
load();
