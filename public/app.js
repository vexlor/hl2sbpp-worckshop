const $ = (s) => document.querySelector(s);
const authGate = $("#authGate"), app = $("#app"), account = $("#account");
let currentUser = null;

async function api(url, options={}) {
  const r = await fetch(url, options);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showApp(user) {
  currentUser = user;
  authGate.classList.add("hidden");
  app.classList.remove("hidden");
  account.innerHTML = `<div class="user"><span>👤 ${escapeHtml(user.username)}</span><button class="logout" id="logout">Выйти</button></div>`;
  $("#logout").onclick = async () => { await api("/api/logout",{method:"POST"}); location.reload(); };
  loadAddons();
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

async function boot(){
  const d = await api("/api/me");
  if(d.user) showApp(d.user);
}

$("#switchAuth").onclick = () => {
  const reg = $("#registerForm"), login = $("#loginForm");
  const registering = !reg.classList.contains("hidden");
  reg.classList.toggle("hidden", registering);
  login.classList.toggle("hidden", !registering);
  $("#authTitle").textContent = registering ? "Вход" : "Регистрация";
  $("#switchAuth").textContent = registering ? "Создать аккаунт" : "Войти";
  $("#authMsg").textContent = "";
};

$("#registerForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#authMsg").textContent = "Создаём аккаунт...";
  try {
    const d = await api("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});
    showApp(d.user);
  } catch(err){ $("#authMsg").textContent = err.message; }
};

$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const d = await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});
    showApp(d.user);
  } catch(err){ $("#authMsg").textContent = err.message; }
};

async function loadAddons(){
  const q = $("#search").value.trim(), category = $("#category").value;
  const d = await api(`/api/addons?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
  $("#count").textContent = `${d.addons.length} items`;
  $("#addons").innerHTML = d.addons.length ? d.addons.map(a => `
    <article class="addon">
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.description || "Без описания")}</p>
      <div class="meta"><span>${escapeHtml(a.author)} · ${escapeHtml(a.category)}</span><span>v${escapeHtml(a.version)}</span></div>
      <div class="meta"><span>♥ ${a.likes}</span><span>↓ ${a.downloads}</span></div>
      <div class="actions"><button onclick="likeAddon(${a.id})">♥ Like</button><button onclick="subscribeAddon(${a.id})">＋ Subscribe</button><button onclick="downloadAddon(${a.id})">↓ Скачать</button></div>
    </article>`).join("") : `<div class="addon"><h3>Пока нет аддонов</h3><p>Загрузи первый ZIP через форму справа.</p></div>`;
}
async function likeAddon(id){try{await api(`/api/addons/${id}/like`,{method:"POST"});loadAddons()}catch(e){alert(e.message)}}
async function subscribeAddon(id){try{await api(`/api/addons/${id}/subscribe`,{method:"POST"});alert("Готово")}catch(e){alert(e.message)}}
function downloadAddon(id){location.href=`/api/addons/${id}/download`}

$("#search").oninput = loadAddons;
$("#category").onchange = loadAddons;
$("#refresh").onclick = loadAddons;

$("#uploadForm").onsubmit = async e => {
  e.preventDefault();
  const form = new FormData(e.target);
  $("#uploadMsg").textContent = "Загружаем...";
  try {
    await api("/api/addons",{method:"POST",body:form});
    e.target.reset();
    $("#uploadMsg").textContent = "Аддон опубликован!";
    loadAddons();
  } catch(err){ $("#uploadMsg").textContent = err.message; }
};

boot();
