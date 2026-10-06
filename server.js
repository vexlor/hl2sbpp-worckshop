const express=require('express');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const bcrypt=require('bcrypt');
const multer=require('multer');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const {Pool}=require('pg');
const {Readable}=require('stream');

const app=express();
const PORT=Number(process.env.PORT||3000);
const UPLOAD_DIR=path.resolve(process.env.UPLOAD_DIR||'./uploads');
const MAX_UPLOAD_MB=Number(process.env.MAX_UPLOAD_MB||200);
const SESSION_DAYS=Number(process.env.SESSION_DAYS||30);
const WORKSHOP_PUBLIC_URL=(process.env.WORKSHOP_PUBLIC_URL||'https://hl2sbpp-worckshop-v1.onrender.com').replace(/\/+$/,'');
const ADDONS_PUBLIC_URL=(process.env.PUBLIC_URL||'https://hl2sbpp-addonss.onrender.com').replace(/\/+$/,'');
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is missing.');process.exit(1)}
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const pool=new Pool({connectionString:process.env.DATABASE_URL});
if(process.env.NODE_ENV==='production')app.set('trust proxy',1);
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(express.json({limit:'2mb'}));app.use(express.urlencoded({extended:false}));
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads',express.static(UPLOAD_DIR,{maxAge:'1d'}));
const authLimiter=rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:true,legacyHeaders:false});
const storage=multer.diskStorage({destination:(_q,_f,cb)=>cb(null,UPLOAD_DIR),filename:(_q,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();cb(null,`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`)}});
const upload=multer({storage,limits:{fileSize:MAX_UPLOAD_MB*1024*1024},fileFilter:(_q,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();if(file.fieldname==='package')return cb(null,ext==='.zip');cb(null,['.png','.jpg','.jpeg','.webp','.gif'].includes(ext))}});
function cleanText(v,max){return String(v??'').trim().slice(0,max)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function getSid(req){return req.headers.cookie?.match(/(?:^|;\s*)hl2sbpp_session=([^;]+)/)?.[1]||null}
function setSid(res,id,maxAge){const secure=process.env.NODE_ENV==='production'?'; Secure':'';res.setHeader('Set-Cookie',`hl2sbpp_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`)}
function workshopAsset(v){if(!v)return v;if(/^https?:\/\//i.test(v))return v;if(v.startsWith('/'))return WORKSHOP_PUBLIC_URL+v;return v}
function localUrl(req,filename){return `${process.env.PUBLIC_URL?.replace(/\/+$/,'')||`${req.protocol}://${req.get('host')}`}/uploads/${encodeURIComponent(filename)}`}
async function workshopJson(url){const r=await fetch(url,{headers:{accept:'application/json'}});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{};if(!r.ok)throw new Error(data.error||`Workshop API ${r.status}`);return data}
function safeUnlink(f){if(!f)return;try{const p=path.join(UPLOAD_DIR,path.basename(f));if(fs.existsSync(p))fs.unlinkSync(p)}catch{}}
async function createSession(uid){const id=crypto.randomBytes(32).toString('hex');const exp=new Date(Date.now()+SESSION_DAYS*86400000);await pool.query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)',[id,uid,exp]);return id}
function cleanReturnPath(v){
  const p=String(v||'/');
  if(!p.startsWith('/')||p.startsWith('//')||p.includes('\\')||p.includes('\0'))return '/';
  return p.slice(0,500);
}
function hashTransferToken(token){return crypto.createHash('sha256').update(String(token)).digest('hex')}
app.get('/auth/start',async(req,res)=>{
  const next=cleanReturnPath(req.query.next||'/');
  const target=`${WORKSHOP_PUBLIC_URL}/auth/transfer?return_to=${encodeURIComponent(ADDONS_PUBLIC_URL+'/auth/callback?next='+encodeURIComponent(next))}`;
  res.redirect(302,target);
});
app.get('/auth/callback',async(req,res)=>{
  const token=String(req.query.token||'');
  const requested=cleanReturnPath(req.query.next||'/');
  if(!/^[a-f0-9]{64}$/i.test(token))return res.status(400).send('Недействительный или отсутствующий токен входа.');
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const r=await c.query('SELECT token_hash,user_id,return_path,expires_at,used_at FROM auth_transfers WHERE token_hash=$1 FOR UPDATE',[hashTransferToken(token)]);
    if(!r.rowCount||r.rows[0].used_at||new Date(r.rows[0].expires_at).getTime()<=Date.now()){await c.query('ROLLBACK');return res.status(401).send('Ссылка входа истекла или уже использована.');}
    const u=await c.query('SELECT id,banned FROM users WHERE id=$1',[r.rows[0].user_id]);
    if(!u.rowCount||u.rows[0].banned){await c.query('UPDATE auth_transfers SET used_at=NOW() WHERE token_hash=$1',[r.rows[0].token_hash]);await c.query('COMMIT');return res.status(403).send('Аккаунт недоступен.');}
    const sid=crypto.randomBytes(32).toString('hex');
    const exp=new Date(Date.now()+SESSION_DAYS*86400000);
    await c.query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)',[sid,u.rows[0].id,exp]);
    await c.query('UPDATE auth_transfers SET used_at=NOW() WHERE token_hash=$1',[r.rows[0].token_hash]);
    await c.query('COMMIT');
    setSid(res,sid,SESSION_DAYS*86400);
    res.redirect(302,requested||r.rows[0].return_path||'/');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('SSO callback:',e);res.status(500).send('Не удалось выполнить вход.');}finally{c.release()}
});
async function auth(req,res,next){try{const sid=getSid(req);if(!sid)return res.status(401).json({error:'Authentication required'});const r=await pool.query(`SELECT u.id,u.username,u.email,u.role,u.avatar_url,u.bio,u.theme_color,u.theme_mode,u.banned FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()`,[sid]);if(!r.rowCount)return res.status(401).json({error:'Session expired'});if(r.rows[0].banned)return res.status(403).json({error:'Account is banned'});req.user=r.rows[0];req.sessionId=sid;next()}catch(e){console.error(e);res.status(500).json({error:'Authentication check failed'})}}
async function initDb(){try{const schema=fs.readFileSync(path.join(__dirname,'db','schema.sql'),'utf8');await pool.query(schema)}catch(e){console.error('DB schema init failed',e.message)}}

app.get('/addon/:id',(req,res)=>/^\d+$/.test(req.params.id)?res.sendFile(path.join(__dirname,'public','addon.html')):res.redirect('/'));
app.get('/api/health',async(_q,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,database:'supabase-postgres',workshop:WORKSHOP_PUBLIC_URL})}catch{res.status(503).json({ok:false,database:'unavailable',workshop:WORKSHOP_PUBLIC_URL})}});
app.get('/api/me',async(req,res)=>{try{const sid=getSid(req);if(!sid)return res.json({user:null});const r=await pool.query(`SELECT u.id,u.username,u.email,u.role,u.avatar_url,u.bio,u.theme_color,u.theme_mode,u.banned FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()`,[sid]);res.json({user:r.rowCount&&!r.rows[0].banned?r.rows[0]:null})}catch{res.json({user:null})}});
app.post('/api/register',authLimiter,async(req,res)=>{try{const username=cleanText(req.body.username,32),email=cleanText(req.body.email,255).toLowerCase(),password=String(req.body.password||''),repeat=String(req.body.repeatPassword||'');if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(username))return res.status(400).json({error:'Username: 3-32 characters, letters/numbers/._-'});if(!validEmail(email))return res.status(400).json({error:'Invalid email'});if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters'});if(password!==repeat)return res.status(400).json({error:'Passwords do not match'});const hash=await bcrypt.hash(password,12);let r;try{r=await pool.query(`INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,email,role,avatar_url,bio,theme_color,theme_mode,banned`,[username,email,hash])}catch(e){if(e?.code==='23505')return res.status(409).json({error:'Email or username already exists'});throw e}const sid=await createSession(r.rows[0].id);setSid(res,sid,SESSION_DAYS*86400);res.json({user:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:'Registration failed'})}});
app.post('/api/login',authLimiter,async(req,res)=>{try{const email=cleanText(req.body.email,255).toLowerCase(),password=String(req.body.password||'');const r=await pool.query(`SELECT id,username,email,password_hash,role,avatar_url,bio,theme_color,theme_mode,banned FROM users WHERE lower(email)=lower($1)`,[email]);if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Wrong email or password'});if(r.rows[0].banned)return res.status(403).json({error:'Account is banned'});const u=r.rows[0],sid=await createSession(u.id);setSid(res,sid,SESSION_DAYS*86400);res.json({user:u})}catch(e){console.error(e);res.status(500).json({error:'Login failed'})}});
app.post('/api/logout',async(req,res)=>{try{const sid=getSid(req);if(sid)await pool.query('DELETE FROM sessions WHERE id=$1',[sid])}finally{setSid(res,'',0);res.json({ok:true})}});

async function workshopList(req){const d=await workshopJson(`${WORKSHOP_PUBLIC_URL}/api/addons`);return (d.addons||[]).map(a=>({...a,cover_image:workshopAsset(a.cover_image),author_avatar:workshopAsset(a.author_avatar)}))}
function filterList(addons,req){const q=cleanText(req.query.q,100).toLowerCase(),cat=cleanText(req.query.category,30),sort=cleanText(req.query.sort,20);let out=addons;if(q)out=out.filter(a=>`${a.title||''} ${a.description||''} ${a.author||''}`.toLowerCase().includes(q));if(cat&&cat!=='All')out=out.filter(a=>a.category===cat);if(sort==='downloads')out=[...out].sort((a,b)=>Number(b.downloads||0)-Number(a.downloads||0));else if(sort==='popular'||sort==='rating')out=[...out].sort((a,b)=>(Number(b.likes||0)-Number(a.likes||0))||(Number(b.downloads||0)-Number(a.downloads||0)));return out}
app.get('/api/addons',async(req,res)=>{
 try{
  const q=cleanText(req.query.q,100),category=cleanText(req.query.category,30),sort=cleanText(req.query.sort,20),params=[],where=[];
  if(q){params.push(`%${q}%`);where.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length} OR u.username ILIKE $${params.length})`)}
  if(category&&category!=='All'){params.push(category);where.push(`a.category=$${params.length}`)}
  let order='a.created_at DESC';if(sort==='popular'||sort==='rating')order='a.likes DESC,a.downloads DESC,a.created_at DESC';if(sort==='downloads')order='a.downloads DESC,a.created_at DESC';
  const r=await pool.query(`SELECT a.id,a.title,a.description,a.category,a.version,a.downloads,a.likes,a.created_at,a.file_size,a.cover_image,u.username AS author,u.avatar_url AS author_avatar,u.role AS author_role FROM addons a JOIN users u ON u.id=a.user_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${order} LIMIT 100`,params);
  if(r.rowCount)return res.json({addons:r.rows.map(a=>({...a,cover_image:workshopAsset(a.cover_image),author_avatar:workshopAsset(a.author_avatar)})),source:'database'});
 }catch(e){console.error('GET /api/addons DB:',e.message)}
 try{return res.json({addons:filterList(await workshopList(req),req),source:'workshop'})}catch(e){console.error('GET /api/addons Workshop:',e.message);return res.status(502).json({error:'Не удалось загрузить аддоны'})}
});

async function getWorkshopDetail(id){const d=await workshopJson(`${WORKSHOP_PUBLIC_URL}/api/addons/${encodeURIComponent(id)}`);if(!d.addon)throw new Error('Addon not found');const a={...d.addon,cover_image:workshopAsset(d.addon.cover_image),author_avatar:workshopAsset(d.addon.author_avatar)};const images=(d.images||[]).map(x=>({...x,image_url:workshopAsset(x.image_url)}));return {addon:a,images,comments:d.comments||[],source:'workshop'};}

app.get('/api/addons/:id',async(req,res)=>{
 const id=String(req.params.id);
 try{
  const r=await pool.query(`SELECT a.id,a.title,a.description,a.category,a.version,a.downloads,a.likes,a.created_at,a.file_size,a.original_filename,a.cover_image,u.id AS author_id,u.username AS author,u.avatar_url AS author_avatar,u.role AS author_role FROM addons a JOIN users u ON u.id=a.user_id WHERE a.id=$1`,[id]);
  if(r.rowCount){
   let addon={...r.rows[0],cover_image:workshopAsset(r.rows[0].cover_image),author_avatar:workshopAsset(r.rows[0].author_avatar)}, images=[],comments=[];
   try{const im=await pool.query('SELECT id,image_url FROM addon_images WHERE addon_id=$1 ORDER BY id', [id]);images=im.rows.map(x=>({...x,image_url:workshopAsset(x.image_url)}));}catch{}
   try{const co=await pool.query(`SELECT c.id,c.body,c.created_at,u.id AS user_id,u.username,u.avatar_url,u.role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.addon_id=$1 ORDER BY c.created_at DESC`,[id]);comments=co.rows;}catch{}
   // If the shared DB row is incomplete, enrich it from the original Workshop record.
   if(!addon.cover_image||!images.length){try{const w=await getWorkshopDetail(id);addon={...w.addon,...addon};if(!addon.cover_image)addon.cover_image=w.addon.cover_image;if(!images.length)images=w.images;}catch{}}
   return res.json({addon,images,comments,source:'database'});
  }
 }catch(e){console.error('GET /api/addons/:id DB:',e.message)}
 try{return res.json(await getWorkshopDetail(id))}catch(e){console.error('GET /api/addons/:id Workshop:',e.message);return res.status(404).json({error:'Аддон не найден'})}
});

app.get('/api/debug/addon/:id',async(req,res)=>{const out={id:String(req.params.id),databaseConfigured:Boolean(process.env.DATABASE_URL),workshopUrl:WORKSHOP_PUBLIC_URL};try{const p=await pool.query('SELECT current_database() AS database,current_user AS user_name,NOW() AS now');out.database=p.rows[0];const r=await pool.query('SELECT id,title,user_id FROM addons WHERE id=$1',[req.params.id]);out.addon=r.rows[0]||null}catch(e){out.error=e.message}res.json(out)});

app.post('/api/addons',auth,upload.fields([{name:'package',maxCount:1},{name:'cover',maxCount:1},{name:'gallery',maxCount:6}]),async(req,res)=>{try{const pkg=req.files?.package?.[0];if(!pkg)return res.status(400).json({error:'ZIP package required'});const title=cleanText(req.body.title,100),description=cleanText(req.body.description,5000),category=cleanText(req.body.category,30)||'Other',version=cleanText(req.body.version,30)||'1.0.0';if(title.length<2){safeUnlink(pkg.filename);return res.status(400).json({error:'Title is required'})}const cover=req.files?.cover?.[0]?localUrl(req,req.files.cover[0].filename):null;const r=await pool.query(`INSERT INTO addons(user_id,title,description,category,version,filename,original_filename,file_size,cover_image) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title,description,category,version,downloads,likes,file_size,cover_image`,[req.user.id,title,description,category,version,pkg.filename,pkg.originalname,pkg.size,cover]);const id=r.rows[0].id;for(const f of(req.files?.gallery||[]))await pool.query('INSERT INTO addon_images(addon_id,image_url) VALUES($1,$2)',[id,localUrl(req,f.filename)]);res.status(201).json({addon:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:'Upload failed'})}});

function filenameFromDisposition(v){if(!v)return null;const m=v.match(/filename\*=UTF-8''([^;]+)/i)||v.match(/filename="?([^";]+)"?/i);return m?decodeURIComponent(m[1]):null}
app.get('/api/addons/:id/download',async(req,res)=>{
 const id=String(req.params.id);
 try{
  const r=await pool.query('SELECT filename,original_filename FROM addons WHERE id=$1',[id]);
  if(r.rowCount){const file=path.join(UPLOAD_DIR,path.basename(r.rows[0].filename));if(fs.existsSync(file)){await pool.query('UPDATE addons SET downloads=downloads+1 WHERE id=$1',[id]).catch(()=>{});return res.download(file,r.rows[0].original_filename)}}
 }catch(e){console.error('local download DB:',e.message)}
 // The shared DB may know the addon while the ZIP lives only on Workshop's Render disk.
 try{
  let r=await fetch(`${WORKSHOP_PUBLIC_URL}/api/addons/${encodeURIComponent(id)}/download`,{redirect:'manual'});
  if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(loc)r=await fetch(new URL(loc,WORKSHOP_PUBLIC_URL),{redirect:'follow'})}
  if(!r.ok||!r.body){
    const meta=await pool.query('SELECT filename,original_filename FROM addons WHERE id=$1',[id]);
    if(meta.rowCount&&meta.rows[0].filename){
      const filename=path.basename(meta.rows[0].filename);
      r=await fetch(`${WORKSHOP_PUBLIC_URL}/uploads/${encodeURIComponent(filename)}`,{redirect:'follow'});
    }
  }
  if(!r.ok||!r.body)return res.status(r.status||502).json({error:'Файл аддона недоступен на Workshop'});
  res.statusCode=200;
  const ct=r.headers.get('content-type');if(ct)res.setHeader('Content-Type',ct);
  const cd=r.headers.get('content-disposition');if(cd)res.setHeader('Content-Disposition',cd);
  const len=r.headers.get('content-length');if(len)res.setHeader('Content-Length',len);
  Readable.fromWeb(r.body).pipe(res);
 }catch(e){console.error('Workshop download:',e.message);res.status(502).json({error:'Download failed'})}
});

app.post('/api/addons/:id/like',auth,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const old=await c.query('SELECT 1 FROM addon_likes WHERE addon_id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(old.rowCount){await c.query('DELETE FROM addon_likes WHERE addon_id=$1 AND user_id=$2',[req.params.id,req.user.id]);await c.query('UPDATE addons SET likes=GREATEST(likes-1,0) WHERE id=$1',[req.params.id])}else{await c.query('INSERT INTO addon_likes(addon_id,user_id) VALUES($1,$2)',[req.params.id,req.user.id]);await c.query('UPDATE addons SET likes=likes+1 WHERE id=$1',[req.params.id])}await c.query('COMMIT');const r=await pool.query('SELECT likes FROM addons WHERE id=$1',[req.params.id]);res.json({likes:r.rows[0]?.likes??0})}catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Like failed'})}finally{c.release()}});
app.post('/api/addons/:id/subscribe',auth,async(req,res)=>{try{const old=await pool.query('SELECT 1 FROM subscriptions WHERE addon_id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(old.rowCount){await pool.query('DELETE FROM subscriptions WHERE addon_id=$1 AND user_id=$2',[req.params.id,req.user.id]);return res.json({subscribed:false})}await pool.query('INSERT INTO subscriptions(addon_id,user_id) VALUES($1,$2)',[req.params.id,req.user.id]);res.json({subscribed:true})}catch(e){res.status(500).json({error:'Subscribe failed'})}});
app.post('/api/addons/:id/comments',auth,async(req,res)=>{try{const body=cleanText(req.body.body,1000);if(!body)return res.status(400).json({error:'Comment is empty'});const r=await pool.query('INSERT INTO comments(addon_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[req.params.id,req.user.id,body]);res.status(201).json({comment:{...r.rows[0],username:req.user.username,avatar_url:req.user.avatar_url,role:req.user.role}})}catch(e){res.status(500).json({error:'Comment failed'})}});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
initDb().then(()=>app.listen(PORT,()=>console.log(`HL2SBPP Addons FINAL running on port ${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
