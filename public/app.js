const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentUser = null;
let currentAddons = [];
const icon = name => ({home:"⌂",box:"◇",cat:"▦",fire:"✦",star:"★",collection:"▤",download:"⇩",like:"♡",sub:"☆",user:"○",settings:"◈",shield:"◉",search:"⌕"}[name] || "•");

async function api(url, options={}) {
  const r = await fetch(url, options);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function avatar(url, name){
  if(url) return `<img class="avatar" src="${esc(url)}" alt="">`;
  const letter = esc((name||"?").slice(0,1).toUpperCase());
  return `<span class="avatar avatar-letter">${letter}</span>`;
}
function badge(role){ return role==="admin" ? `<span class="verified" title="Официальный администратор">✓</span>` : ""; }
function stars(likes){ const n=Math.max(0,Math.min(5,Math.round(Number(likes||0)/5))); return `<span class="stars">${"★".repeat(n)}${"☆".repeat(5-n)}</span>`; }
function formatSize(n){ if(!n) return "—"; const u=["B","KB","MB","GB"]; let i=0,v=Number(n); while(v>=1024&&i<3){v/=1024;i++;} return `${v.toFixed(i?1:0)} ${u[i]}`; }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2500); }
function applyTheme(){
  const color=currentUser?.theme_color || "#159cff";
  document.documentElement.style.setProperty("--accent",color);
  document.documentElement.dataset.theme=currentUser?.theme_mode || "dark";
}
function updateUserUI(){
  if(!currentUser) return;
  applyTheme();
  $("#headerName").textContent=currentUser.username;
  $("#headerAvatar").src=currentUser.avatar_url || "/avatar-placeholder.svg";
  $("#headerBadge").innerHTML=badge(currentUser.role);
  $("#sideName").textContent=currentUser.username;
  $("#sideRole").textContent=currentUser.role==="admin"?"Администратор":"Пользователь";
  $("#sideAvatar").src=currentUser.avatar_url || "/avatar-placeholder.svg";
  $("#adminNav").classList.toggle("hidden",currentUser.role!=="admin");
}
function showApp(user){
  currentUser=user; $("#authGate").classList.add("hidden"); $("#app").classList.remove("hidden");
  updateUserUI(); showView("home"); loadHome();
}
async function boot(){
  try{ const d=await api("/api/me"); if(d.user) showApp(d.user); }catch{}
}
function showView(name){
  $$(".view").forEach(v=>v.classList.add("hidden"));
  const el=$("#view-"+name); if(el) el.classList.remove("hidden");
  $$(".side-link").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $$(".topnav a").forEach(a=>a.classList.toggle("active",a.dataset.view===name));
  if(name==="addons") loadAllAddons();
  if(name==="popular") loadSorted("popular","#popularAddons");
  if(name==="new") loadSorted("new","#newAddons");
  if(name==="categories") renderCategories();
  if(name==="profile") renderProfile();
  if(name==="admin") loadAdmin();
  window.scrollTo({top:0,behavior:"smooth"});
}
function addonCard(a){
  const cover=a.cover_image || "";
  return `<article class="addon-card" onclick="openAddon(${a.id})">
    <div class="cover">${cover?`<img src="${esc(cover)}" alt="">`:`<div class="cover-placeholder">${icon("box")}</div>`}<span class="category-chip">${esc(a.category)}</span></div>
    <div class="addon-body">
      <h3>${esc(a.title)}</h3>
      <div class="author-line">${avatar(a.author_avatar,a.author)}<span>${esc(a.author)}</span>${badge(a.author_role)}</div>
      <p>${esc(a.description||"Без описания")}</p>
      <div class="card-meta"><span>${stars(a.likes)} <b>${a.likes}</b></span><span>${a.downloads} скач.</span></div>
    </div>
  </article>`;
}
function renderAddonList(list, selector){
  const el=$(selector);
  if(!el) return;
  el.innerHTML=list.length?list.map(addonCard).join(""):`<div class="empty-panel"><div class="empty-icon">${icon("box")}</div><h2>Аддонов пока нет</h2><p>Попробуй изменить фильтры или добавь первый аддон.</p></div>`;
}
async function loadHome(){
  try{
    const [p,n]=await Promise.all([api("/api/addons?sort=popular"),api("/api/addons?sort=new")]);
    renderAddonList(p.addons.slice(0,4),"#homePopular"); renderAddonList(n.addons.slice(0,4),"#homeNew");
  }catch(e){toast(e.message)}
}
async function loadAllAddons(){
  const q=($("#addonSearch")?.value||"").trim(), c=$("#addonCategory")?.value||"All", s=$("#addonSort")?.value||"new";
  const d=await api(`/api/addons?q=${encodeURIComponent(q)}&category=${encodeURIComponent(c)}&sort=${encodeURIComponent(s)}`);
  currentAddons=d.addons; renderAddonList(d.addons,"#allAddons");
}
async function loadSorted(sort,sel){ const d=await api(`/api/addons?sort=${sort}`); renderAddonList(d.addons,sel); }
function renderCategories(){
  const cats=[
    ["Models","Модели","◇"],["Maps","Карты","⌖"],["Weapons","Оружие","＋"],["NPCs","NPC / Entity","○"],
    ["Vehicles","Транспорт","▱"],["Scripts","Скрипты","{}"],["Gamemodes","Игровые режимы","◈"],["UI","Интерфейс","▤"],
    ["Sounds","Звуки","◌"],["Other","Другое","•"]
  ];
  $("#categoriesGrid").innerHTML=cats.map(c=>`<button class="category-card" onclick="pickCategory('${c[0]}')"><span>${c[2]}</span><strong>${c[1]}</strong><small>Открыть категорию →</small></button>`).join("");
}
window.pickCategory=c=>{showView("addons");setTimeout(()=>{$("#addonCategory").value=c;loadAllAddons()},0)};
window.openAddon=async id=>{
  showView("addon");
  $("#addonView").innerHTML=`<div class="loading">Загрузка аддона...</div>`;
  try{
    const d=await api(`/api/addons/${id}`); const a=d.addon;
    const images=[a.cover_image,...d.images.map(x=>x.image_url)].filter(Boolean);
    const gallery=images.length?images.map((x,i)=>`<button class="thumb ${i===0?"active":""}" onclick="setMainImage(this,'${esc(x)}')"><img src="${esc(x)}"></button>`).join(""):"";
    $("#addonView").innerHTML=`
      <div class="addon-page-head"><button class="ghost" onclick="showView('addons')">← Назад</button><div class="rating-top">${stars(a.likes)} <span>${a.likes} оценок</span></div></div>
      <div class="addon-layout">
        <div class="addon-main">
          <div class="main-media">${images[0]?`<img id="mainAddonImage" src="${esc(images[0])}">`:`<div class="large-placeholder">${icon("box")}</div>`}</div>
          <div class="thumbs">${gallery}</div>
          <div class="panel description"><div class="panel-title">Описание</div><p>${esc(a.description||"Без описания")}</p></div>
          <div class="panel comments"><div class="panel-title">Комментарии <span>${d.comments.length}</span></div>
            <form class="comment-form" onsubmit="postComment(event,${a.id})"><input name="body" maxlength="1000" placeholder="Написать комментарий..."><button class="primary">Отправить</button></form>
            <div class="comment-list">${d.comments.map(c=>commentHtml(c)).join("")||`<div class="muted">Комментариев пока нет.</div>`}</div>
          </div>
        </div>
        <aside class="addon-side">
          <div class="panel addon-info">
            <div class="mini-cover">${images[0]?`<img src="${esc(images[0])}">`:""}</div>
            <h2>${esc(a.title)} ${badge(a.author_role)}</h2>
            <div class="author-line big-author">${avatar(a.author_avatar,a.author)}<span>${esc(a.author)}</span>${badge(a.author_role)}</div>
            <div class="info-list">
              <div><span>Тип</span><b>Аддон</b></div><div><span>Категория</span><b>${esc(a.category)}</b></div>
              <div><span>Версия</span><b>${esc(a.version)}</b></div><div><span>Размер</span><b>${formatSize(a.file_size)}</b></div>
              <div><span>Добавлен</span><b>${new Date(a.created_at).toLocaleDateString()}</b></div><div><span>Скачиваний</span><b>${a.downloads}</b></div>
            </div>
            <button class="primary wide" onclick="downloadAddon(${a.id})">${icon("download")} Скачать</button>
            <div class="action-row"><button onclick="likeAddon(${a.id})">${icon("like")} Лайк <span>${a.likes}</span></button><button onclick="subscribeAddon(${a.id})">${icon("sub")} Подписаться</button></div>
          </div>
          <div class="panel"><div class="panel-title">Информация</div><div class="tag-row"><span>${esc(a.category)}</span><span>v${esc(a.version)}</span></div></div>
        </aside>
      </div>`;
  }catch(e){$("#addonView").innerHTML=`<div class="empty-panel"><h2>Не удалось открыть аддон</h2><p>${esc(e.message)}</p></div>`}
};
window.setMainImage=(btn,url)=>{$("#mainAddonImage").src=url;$$(".thumb").forEach(x=>x.classList.remove("active"));btn.classList.add("active")};
function commentHtml(c){return `<div class="comment"><div>${avatar(c.avatar_url,c.username)}</div><div class="comment-body"><div class="comment-head"><strong>${esc(c.username)} ${badge(c.role)}</strong><span>${new Date(c.created_at).toLocaleString()}</span></div><p>${esc(c.body)}</p></div></div>`}
window.postComment=async(e,id)=>{e.preventDefault();const f=new FormData(e.target);try{await api(`/api/addons/${id}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:f.get("body")})});openAddon(id)}catch(err){toast(err.message)}};
window.likeAddon=async id=>{try{await api(`/api/addons/${id}/like`,{method:"POST"});toast("Оценка обновлена");openAddon(id)}catch(e){toast(e.message)}};
window.subscribeAddon=async id=>{try{const d=await api(`/api/addons/${id}/subscribe`,{method:"POST"});toast(d.subscribed?"Вы подписались":"Подписка отменена")}catch(e){toast(e.message)}};
window.downloadAddon=id=>{location.href=`/api/addons/${id}/download`};

function openModal(html){$("#modalContent").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
function renderProfile(){
  $("#profileView").innerHTML=`<div class="profile-cover"><div class="profile-avatar">${avatar(currentUser.avatar_url,currentUser.username)}</div><div><h1>${esc(currentUser.username)} ${badge(currentUser.role)}</h1><p>${esc(currentUser.bio||"Пользователь HL2SBPP Workshop")}</p></div><button class="primary" id="editProfile">Настройки профиля</button></div>
  <div class="profile-grid"><div class="panel"><div class="panel-title">Профиль</div><p>Здесь будут твои аддоны, подписки и избранное.</p></div><div class="panel"><div class="panel-title">Статус</div><p>${currentUser.role==="admin"?"Официальный администратор":"Участник Workshop"}</p></div></div>`;
  $("#editProfile").onclick=showSettings;
}
function showSettings(){
  openModal(`<div class="modal-title">Настройки профиля</div>
  <form id="settingsForm" class="settings-form">
    <div class="settings-avatar">${avatar(currentUser.avatar_url,currentUser.username)}<label class="secondary file-btn">Изменить аватар<input name="avatar" type="file" accept=".png,.jpg,.jpeg,.webp,.gif"></label></div>
    <label>Имя пользователя<input name="username" maxlength="32" value="${esc(currentUser.username)}"></label>
    <label>Описание профиля<textarea name="bio" maxlength="500">${esc(currentUser.bio||"")}</textarea></label>
    <label>Цвет интерфейса<div class="color-row">${["#159cff","#7c5cff","#d83cff","#f43f78","#ff6b2c","#19c37d","#6aa8ff"].map(c=>`<button type="button" class="color-dot ${currentUser.theme_color===c?"selected":""}" style="--dot:${c}" data-color="${c}"></button>`).join("")}</div></label>
    <label>Тема<select name="themeMode"><option value="dark" ${currentUser.theme_mode==="dark"?"selected":""}>Тёмная</option><option value="light" ${currentUser.theme_mode==="light"?"selected":""}>Светлая</option></select></label>
    <button class="primary wide">Сохранить изменения</button><div id="settingsMsg" class="message"></div>
  </form>`);
  let color=currentUser.theme_color||"#159cff";
  $$(".color-dot").forEach(b=>b.onclick=()=>{color=b.dataset.color;$$(".color-dot").forEach(x=>x.classList.remove("selected"));b.classList.add("selected")});
  $("#settingsForm").onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.target);f.set("themeColor",color);
    try{const d=await api("/api/profile",{method:"PUT",body:f});currentUser=d.user;updateUserUI();closeModal();renderProfile();toast("Настройки сохранены")}catch(err){$("#settingsMsg").textContent=err.message}
  };
}
async function loadAdmin(){
  if(currentUser.role!=="admin") return;
  const d=await api("/api/admin/overview");
  $("#adminView").innerHTML=`<div class="page-title"><div><span class="eyebrow">CONTROL CENTER</span><h1>Админ-панель</h1></div></div>
  <div class="admin-tabs"><button class="active" data-admin-tab="users">Пользователи</button><button data-admin-tab="addons">Аддоны</button><button data-admin-tab="comments">Комментарии</button></div>
  <div id="adminTable" class="panel admin-table"></div>`;
  const render=tab=>{
    const el=$("#adminTable");
    if(tab==="users") el.innerHTML=`<div class="panel-title">Пользователи</div>`+d.users.map(u=>`<div class="admin-row"><div class="admin-user">${avatar(u.avatar_url,u.username)}<div><strong>${esc(u.username)} ${badge(u.role)}</strong><small>${esc(u.email)}</small></div></div><span class="status ${u.banned?"bad":"ok"}">${u.banned?"Заблокирован":u.role}</span><div class="admin-actions">${u.banned?`<button onclick="adminAction('/api/admin/users/${u.id}/unban','Разблокирован')">Разблокировать</button>`:`<button onclick="adminAction('/api/admin/users/${u.id}/ban','Заблокирован')">Заблокировать</button>`}<button onclick="adminRole(${u.id},'${u.role==="admin"?"user":"admin"}')">${u.role==="admin"?"Снять admin":"Назначить admin"}</button>${u.id!==currentUser.id?`<button class="danger" onclick="deleteUser(${u.id})">Удалить</button>`:""}</div></div>`).join("");
    if(tab==="addons") el.innerHTML=`<div class="panel-title">Аддоны</div>`+d.addons.map(a=>`<div class="admin-row"><div><strong>${esc(a.title)}</strong><small>${esc(a.author)} · ${esc(a.category)}</small></div><span>${a.likes} лайков · ${a.downloads} скач.</span><div class="admin-actions"><button onclick="openAddon(${a.id})">Открыть</button><button class="danger" onclick="deleteAdminAddon(${a.id})">Удалить</button></div></div>`).join("");
    if(tab==="comments") el.innerHTML=`<div class="panel-title">Комментарии</div>`+d.comments.map(c=>`<div class="admin-row"><div><strong>${esc(c.username)}</strong><small>${esc(c.addon_title)}</small></div><span class="comment-preview">${esc(c.body)}</span><div class="admin-actions"><button class="danger" onclick="deleteAdminComment(${c.id})">Удалить</button></div></div>`).join("");
  };
  $$(".admin-tabs button").forEach(b=>b.onclick=()=>{$$(".admin-tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");render(b.dataset.adminTab)});
  render("users");
}
window.adminAction=async(url,msg)=>{try{await api(url,{method:"POST"});toast(msg);loadAdmin()}catch(e){toast(e.message)}};
window.adminRole=async(id,role)=>{try{await api(`/api/admin/users/${id}/role`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role})});toast("Роль изменена");loadAdmin()}catch(e){toast(e.message)}};
window.deleteUser=async id=>{if(!confirm("Удалить пользователя?"))return;try{await api(`/api/admin/users/${id}`,{method:"DELETE"});toast("Пользователь удалён");loadAdmin()}catch(e){toast(e.message)}};
window.deleteAdminAddon=async id=>{if(!confirm("Удалить аддон?"))return;try{await api(`/api/admin/addons/${id}`,{method:"DELETE"});toast("Аддон удалён");loadAdmin()}catch(e){toast(e.message)}};
window.deleteAdminComment=async id=>{if(!confirm("Удалить комментарий?"))return;try{await api(`/api/admin/comments/${id}`,{method:"DELETE"});toast("Комментарий удалён");loadAdmin()}catch(e){toast(e.message)}};

function openUpload(){showView("upload");}
function setupUpload(){
  $("#uploadForm").onsubmit=async e=>{
    e.preventDefault();$("#uploadMsg").textContent="Публикуем...";
    try{const f=new FormData(e.target);await api("/api/addons",{method:"POST",body:f});e.target.reset();$("#previewStrip").innerHTML="";$("#uploadMsg").textContent="Аддон опубликован.";toast("Аддон опубликован");showView("addons");loadAllAddons()}catch(err){$("#uploadMsg").textContent=err.message}
  };
  ["cover","gallery"].forEach(n=>{const input=document.querySelector(`[name=${n}]`);input.onchange=()=>{$("#previewStrip").innerHTML="";[...input.files].slice(0,6).forEach(file=>{const u=URL.createObjectURL(file);$("#previewStrip").insertAdjacentHTML("beforeend",`<img src="${u}">`)})}});
}
$("#authRegTab").onclick=()=>{$("#registerForm").classList.remove("hidden");$("#loginForm").classList.add("hidden");$("#authRegTab").classList.add("active");$("#authLoginTab").classList.remove("active")};
$("#authLoginTab").onclick=()=>{$("#registerForm").classList.add("hidden");$("#loginForm").classList.remove("hidden");$("#authLoginTab").classList.add("active");$("#authRegTab").classList.remove("active")};
$("#registerForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const d=await api("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});showApp(d.user)}catch(err){$("#authMsg").textContent=err.message}};
$("#loginForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const d=await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});showApp(d.user)}catch(err){$("#authMsg").textContent=err.message}};
$$("[data-view]").forEach(el=>el.addEventListener("click",e=>{e.preventDefault();showView(el.dataset.view);$("#sidebar").classList.remove("open")}));
$("#uploadNav").onclick=openUpload; $("#heroUpload").onclick=openUpload; $("#addonsUpload").onclick=openUpload;
$("#myProfileNav").onclick=()=>showView("profile"); $("#profileBtn").onclick=()=>showView("profile"); $("#settingsBtn").onclick=showSettings;
$("#adminNav").onclick=()=>showView("admin");
$("#logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};
$("#globalSearch").oninput=e=>{showView("addons");$("#addonSearch").value=e.target.value;loadAllAddons()};
$("#addonSearch").oninput=loadAllAddons;$("#addonCategory").onchange=loadAllAddons;$("#addonSort").onchange=loadAllAddons;
$("#mobileMenu").onclick=()=>$("#sidebar").classList.toggle("open");
$("#modalClose").onclick=closeModal;$("#modal .modal-backdrop").onclick=closeModal;
setupUpload();boot();
