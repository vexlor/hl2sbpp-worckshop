const grid=document.querySelector('#grid'), search=document.querySelector('#search'), status=document.querySelector('#status');
const ADDON_CATEGORIES=[['NPCs','◉'],['Weapons','✦'],['Maps','⌖'],['Models','◇'],['Scripts','{}'],['Vehicles','▱'],['Other','•']];
function periodList(addons,period){const now=Date.now(),span=period==='week'?7*864e5:period==='year'?365*864e5:Infinity;return [...addons].filter(a=>period==='all'||(a.created_at && now-new Date(a.created_at).getTime()<=span)).sort((a,b)=>Number(b.likes||0)-Number(a.likes||0)||Number(b.downloads||0)-Number(a.downloads||0)||new Date(b.created_at||0)-new Date(a.created_at||0));}
function renderTags(){const el=document.querySelector('#tags');if(!el)return;el.innerHTML=ADDON_CATEGORIES.map(([name,icon])=>`<button class="tag-nav" data-cat="${name}"><span>${icon}</span>${name==='Weapons'?'SWEP / оружие':name}</button>`).join('');el.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>load(b.dataset.cat,document.querySelector('#periods .active')?.dataset.period||'week'));}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=n=>{n=Number(n||0);if(!n)return '—';const u=['Б','КБ','МБ','ГБ'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i?1:0)} ${u[i]}`};
function asset(v){
  if(!v)return '';
  const x=String(v);
  if(/^https?:\/\//i.test(x)){try{const u=new URL(x);if(u.origin==='https://hl2sbpp-worckshop-v1.onrender.com')return '/media?url='+encodeURIComponent(u.pathname+u.search);}catch{}return x;}
  if(x.startsWith('/uploads/'))return '/media?url='+encodeURIComponent(x);
  return x;
}
function card(a){return `<a class="card reveal" href="/addon/${encodeURIComponent(a.id)}"><div class="cover">${a.cover_image?`<img src="${esc(asset(a.cover_image))}" alt="">`:'<div class="placeholder">HL2SBPP</div>'}<span class="cover-tag">${esc(a.category||'Other')}</span></div><div class="pad"><div class="tag-line"><span class="tag">${esc(a.category||'Other')}</span><span class="stars">★ ${esc(a.likes||0)}</span></div><h2>${esc(a.title)}</h2><div class="author">${esc(a.author||'Unknown')}</div><p>${esc(a.description||'')}</p><footer><span>♥ ${esc(a.likes||0)}</span><span>${esc(a.downloads||0)} скач.</span></footer></div></a>`}

async function load(category='',period='week'){status.textContent='Загрузка...';try{const q=search.value.trim();const params=new URLSearchParams();if(q)params.set('q',q);if(category)params.set('category',category);const r=await fetch('/api/addons'+(params.toString()?'?'+params.toString():''));const d=await r.json();if(!r.ok)throw Error(d.error||'Ошибка');grid.innerHTML=periodList(d.addons||[],period).map(card).join('')||'<div class="empty">Аддоны не найдены.</div>';status.textContent='';window.HL2Motion?.reveal(grid)}catch(e){status.textContent=e.message}}
search.addEventListener('input',()=>{clearTimeout(window.t);window.t=setTimeout(()=>load('',document.querySelector('#periods .active')?.dataset.period||'week'),250)});document.querySelectorAll('#periods button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#periods button').forEach(x=>x.classList.remove('active'));b.classList.add('active');load('',b.dataset.period)});renderTags();load();
async function openCreate(){
 const m=document.createElement('div');m.className='create-modal';m.innerHTML=`<div class="create-backdrop"></div><div class="create-card"><button class="create-close">×</button><div class="side-kicker">PUBLISH</div><h2>Создать аддон</h2><p class="create-hint">ZIP, обложка и изображения — прямо с телефона.</p><form id="createAddonForm"><label>Название<input name="title" required maxlength="100"></label><div class="create-two"><label>Категория<select name="category">${ADDON_CATEGORIES.map(([n])=>`<option value="${n}">${n==='Weapons'?'SWEP / оружие':n}</option>`).join('')}</select></label><label>Версия<input name="version" value="1.0.0" maxlength="30"></label></div><label>Описание<textarea name="description" maxlength="5000" rows="5"></textarea></label><label>ZIP аддона<input name="package" type="file" accept=".zip" required></label><label>Обложка<input name="cover" type="file" accept="image/*"></label><label>Галерея<input name="gallery" type="file" accept="image/*" multiple></label><button class="btn create-submit">Опубликовать</button><div id="createMsg" class="create-msg"></div></form></div>`;document.body.appendChild(m);const close=()=>m.remove();m.querySelector('.create-close').onclick=close;m.querySelector('.create-backdrop').onclick=close;m.querySelector('#createAddonForm').onsubmit=async e=>{e.preventDefault();const msg=m.querySelector('#createMsg');msg.textContent='Публикуем…';try{const r=await fetch('/api/addons',{method:'POST',body:new FormData(e.target)});const d=await r.json().catch(()=>({}));if(r.status===401){location.href='/auth/start?next=/';return}if(!r.ok)throw Error(d.error||'Не удалось опубликовать');msg.textContent='Готово!';setTimeout(()=>{close();load('',document.querySelector('#periods .active')?.dataset.period||'week')},500)}catch(err){msg.textContent=err.message}};
}
function profileModal(user){
 const old=document.querySelector('.profile-sync-modal'); if(old)old.remove();
 const av=user.avatar_url||'/avatar-placeholder.svg';
 const st=user.stats||{};
 const m=document.createElement('div');m.className='profile-sync-modal';
 m.innerHTML=`<div class="profile-sync-backdrop"></div><section class="profile-sync-card">
   <button class="profile-sync-close" aria-label="Закрыть">×</button>
   <div class="profile-sync-kicker">WORKSHOP ACCOUNT / SYNCED</div>
   <div class="profile-sync-head"><img src="${esc(av)}" alt=""><div><h2>${esc(user.username)}</h2><p>${user.role==='admin'?'Администратор':'Игрок HL2SBPP'} · аккаунт синхронизирован</p></div></div>
   <div class="profile-sync-grid"><div><span>E-MAIL</span><b>${esc(user.email||'—')}</b></div><div><span>РЕГИСТРАЦИЯ</span><b>${user.created_at?new Date(user.created_at).toLocaleDateString('ru-RU'):'—'}</b></div><div><span>АДДОНЫ</span><b>${st.addons??0}</b></div><div><span>ЛАЙКИ</span><b>${st.likes??0}</b></div><div><span>ПОДПИСКИ</span><b>${st.subscriptions??0}</b></div><div><span>КОММЕНТАРИИ</span><b>${st.comments??0}</b></div></div>
   <div class="profile-sync-bio"><span>О СЕБЕ</span><p>${esc(user.bio||'Профиль без описания.')}</p></div>
   <div class="profile-sync-actions"><button class="profile-sync-workshop">Открыть профиль Workshop →</button><button class="profile-sync-ok">Закрыть</button></div>
 </section>`;
 document.body.appendChild(m);
 const close=()=>m.remove();m.querySelector('.profile-sync-close').onclick=close;m.querySelector('.profile-sync-backdrop').onclick=close;m.querySelector('.profile-sync-ok').onclick=close;
 m.querySelector('.profile-sync-workshop').onclick=()=>location.href=`${'https://hl2sbpp-worckshop-v1.onrender.com'}/`;
}
async function openProfile(){
 try{const d=await fetch('/api/me',{credentials:'same-origin'}).then(r=>r.json());if(d.user)return profileModal(d.user);}catch{}
 location.href='/auth/start?next=/';
}
function setupShell(){
 document.getElementById('createBtn')?.addEventListener('click',openCreate);
 document.getElementById('mobileCreate')?.addEventListener('click',openCreate);
 document.getElementById('profileBtn')?.addEventListener('click',openProfile);
 fetch('/api/me').then(r=>r.json()).then(d=>{
   const n=document.getElementById('userName'),a=document.getElementById('userAvatar'),st=document.getElementById('playerStatus');
   if(d.user){
     if(n)n.textContent=d.user.username;
     if(a){a.src=d.user.avatar_url||'/avatar-placeholder.svg';a.alt=d.user.username}
     if(st){st.textContent='ONLINE';st.classList.add('online')}
     document.querySelector('.player-chip')?.classList.add('signed-in');
   }else if(n)n.textContent='Войти через Workshop';
 });
}
setupShell();
