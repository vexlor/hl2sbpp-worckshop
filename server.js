const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const ADDONS_SITE_URL = (process.env.ADDONS_SITE_URL || "https://hl2sbpp-addonss.onrender.com").replace(/\/+$/, "");
const SSO_TTL_SECONDS = 10 * 60;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1d" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "package") return cb(null, ext === ".zip");
    const ok = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
    cb(null, ok);
  }
});

const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext));
  }
});

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function getSessionId(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)hl2sbpp_session=([^;]+)/)?.[1] || null;
}
function setSessionCookie(res, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `hl2sbpp_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}
function fileUrl(filename) {
  return filename ? `/uploads/${encodeURIComponent(filename)}` : null;
}
async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schema);
}
async function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)", [id, userId, expires]);
  return { id, expires };
}
async function auth(req, res, next) {
  try {
    const sid = getSessionId(req);
    if (!sid) return res.status(401).json({ error: "Authentication required" });
    const r = await pool.query(
      `SELECT u.id,u.username,u.email,u.role,u.avatar_url,u.bio,u.theme_color,u.theme_mode,u.banned
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at>NOW()`,
      [sid]
    );
    if (!r.rowCount) return res.status(401).json({ error: "Session expired" });
    if (r.rows[0].banned) return res.status(403).json({ error: "Account is banned" });
    req.user = r.rows[0];
    req.sessionId = sid;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Authentication check failed" });
  }
}
function admin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
function safeUnlink(filename) {
  if (!filename) return;
  try {
    const file = path.join(UPLOAD_DIR, path.basename(filename));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function safeReturnPath(value) {
  const v = String(value || "/");
  if (!v.startsWith("/") || v.startsWith("//") || /^(?:https?:)?\/\//i.test(v)) return "/";
  return v.slice(0, 1000);
}

app.get("/addon/:id", (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.redirect("/");
  const next = `/addon/${encodeURIComponent(req.params.id)}`;
  res.redirect(302, `${ADDONS_SITE_URL}/auth/start?next=${encodeURIComponent(next)}`);
});

app.get("/auth/transfer", async (req, res) => {
  try {
    const sid = getSessionId(req);
    const next = safeReturnPath(req.query.next);
    if (!sid) {
      const loginReturn = `/auth/transfer?next=${encodeURIComponent(next)}`;
      return res.redirect(302, `/?sso_return=${encodeURIComponent(loginReturn)}`);
    }
    const r = await pool.query(
      `SELECT u.id,u.banned FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at>NOW()`, [sid]
    );
    if (!r.rowCount || r.rows[0].banned) {
      const loginReturn = `/auth/transfer?next=${encodeURIComponent(next)}`;
      return res.redirect(302, `/?sso_return=${encodeURIComponent(loginReturn)}`);
    }
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO auth_transfers(token_hash,user_id,return_path,expires_at)
       VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')`,
      [hash, r.rows[0].id, next]
    );
    const callback = `${ADDONS_SITE_URL}/auth/callback?token=${encodeURIComponent(token)}`;
    res.redirect(302, callback);
  } catch (e) {
    console.error("SSO transfer:", e);
    res.status(500).send("Не удалось выполнить вход через Workshop. Вернитесь назад и попробуйте ещё раз.");
  }
});

app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, database: "supabase-postgres" }); }
  catch { res.status(503).json({ ok: false, database: "unavailable" }); }
});

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const username = cleanText(req.body.username, 32);
    const email = cleanText(req.body.email, 255).toLowerCase();
    const password = String(req.body.password || "");
    const repeat = String(req.body.repeatPassword || "");
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: "Username: 3-32 characters, letters/numbers/._-" });
    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (password !== repeat) return res.status(400).json({ error: "Passwords do not match" });
    const exists = await pool.query("SELECT 1 FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($2) LIMIT 1", [email, username]);
    if (exists.rowCount) return res.status(409).json({ error: "Email or username already exists" });
    const hash = await bcrypt.hash(password, 12);
    let created;
    try {
      created = await pool.query(
        `INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3)
         RETURNING id,username,email,role,avatar_url,bio,theme_color,theme_mode,banned`,
        [username, email, hash]
      );
    } catch (err) {
      if (err?.code === "23505") return res.status(409).json({ error: "Email or username already exists" });
      throw err;
    }
    const session = await createSession(created.rows[0].id);
    setSessionCookie(res, session.id, SESSION_DAYS * 86400);
    res.json({ user: created.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 255).toLowerCase();
    const password = String(req.body.password || "");
    const r = await pool.query(
      `SELECT id,username,email,password_hash,role,avatar_url,bio,theme_color,theme_mode,banned
       FROM users WHERE lower(email)=lower($1)`,
      [email]
    );
    if (!r.rowCount || !(await bcrypt.compare(password, r.rows[0].password_hash))) return res.status(401).json({ error: "Wrong email or password" });
    if (r.rows[0].banned) return res.status(403).json({ error: "Account is banned" });
    const u = r.rows[0];
    const session = await createSession(u.id);
    setSessionCookie(res, session.id, SESSION_DAYS * 86400);
    res.json({ user: u });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    const sid = getSessionId(req);
    if (sid) await pool.query("DELETE FROM sessions WHERE id=$1", [sid]);
  } finally {
    setSessionCookie(res, "", 0);
    res.json({ ok: true });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const sid = getSessionId(req);
    if (!sid) return res.json({ user: null });
    const r = await pool.query(
      `SELECT u.id,u.username,u.email,u.role,u.avatar_url,u.bio,u.theme_color,u.theme_mode,u.banned
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at>NOW()`,
      [sid]
    );
    res.json({ user: r.rowCount && !r.rows[0].banned ? r.rows[0] : null });
  } catch { res.json({ user: null }); }
});

app.put("/api/profile", auth, avatarUpload.single("avatar"), async (req, res) => {
  try {
    const username = cleanText(req.body.username, 32);
    const bio = cleanText(req.body.bio, 500);
    const themeColor = cleanText(req.body.themeColor, 20) || "#159cff";
    const themeMode = ["dark", "light"].includes(req.body.themeMode) ? req.body.themeMode : "dark";
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      if (req.file) safeUnlink(req.file.filename);
      return res.status(400).json({ error: "Invalid username" });
    }
    const dup = await pool.query("SELECT 1 FROM users WHERE lower(username)=lower($1) AND id<>$2", [username, req.user.id]);
    if (dup.rowCount) {
      if (req.file) safeUnlink(req.file.filename);
      return res.status(409).json({ error: "Username already exists" });
    }
    let avatar = req.user.avatar_url;
    if (req.file) {
      const old = req.user.avatar_url?.replace(/^\/uploads\//, "");
      safeUnlink(old);
      avatar = fileUrl(req.file.filename);
    }
    const r = await pool.query(
      `UPDATE users SET username=$1,bio=$2,theme_color=$3,theme_mode=$4,avatar_url=$5
       WHERE id=$6
       RETURNING id,username,email,role,avatar_url,bio,theme_color,theme_mode,banned`,
      [username,bio,themeColor,themeMode,avatar,req.user.id]
    );
    res.json({ user: r.rows[0] });
  } catch (e) {
    console.error(e);
    if (req.file) safeUnlink(req.file.filename);
    res.status(500).json({ error: "Profile update failed" });
  }
});

app.get("/api/addons", async (req, res) => {
  try {
    const q = cleanText(req.query.q, 100);
    const category = cleanText(req.query.category, 30);
    const sort = cleanText(req.query.sort, 20);
    const params = [];
    const where = [];
    if (q) { params.push(`%${q}%`); where.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length} OR u.username ILIKE $${params.length})`); }
    if (category && category !== "All") { params.push(category); where.push(`a.category=$${params.length}`); }
    let order = "a.created_at DESC";
    if (sort === "popular") order = "a.likes DESC, a.downloads DESC, a.created_at DESC";
    if (sort === "downloads") order = "a.downloads DESC, a.created_at DESC";
    if (sort === "rating") order = "a.likes DESC, a.created_at DESC";
    const sql = `SELECT a.id,a.title,a.description,a.category,a.version,a.downloads,a.likes,a.created_at,a.file_size,a.cover_image,
      u.username AS author,u.avatar_url AS author_avatar,u.role AS author_role
      FROM addons a JOIN users u ON u.id=a.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${order} LIMIT 100`;
    const r = await pool.query(sql, params);
    res.json({ addons: r.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "Failed to load addons" }); }
});

app.get("/api/addons/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id,a.title,a.description,a.category,a.version,a.downloads,a.likes,a.created_at,a.file_size,a.original_filename,a.cover_image,
       u.id AS author_id,u.username AS author,u.avatar_url AS author_avatar,u.role AS author_role
       FROM addons a JOIN users u ON u.id=a.user_id WHERE a.id=$1`, [req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "Addon not found" });
    const images = await pool.query("SELECT id,image_url FROM addon_images WHERE addon_id=$1 ORDER BY id", [req.params.id]);
    const comments = await pool.query(
      `SELECT c.id,c.body,c.created_at,u.id AS user_id,u.username,u.avatar_url,u.role
       FROM comments c JOIN users u ON u.id=c.user_id
       WHERE c.addon_id=$1 ORDER BY c.created_at DESC`, [req.params.id]
    );
    res.json({ addon: r.rows[0], images: images.rows, comments: comments.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "Failed to load addon" }); }
});

app.post("/api/addons", auth, upload.fields([
  { name: "package", maxCount: 1 },
  { name: "cover", maxCount: 1 },
  { name: "gallery", maxCount: 6 }
]), async (req, res) => {
  try {
    const pkg = req.files?.package?.[0];
    if (!pkg) return res.status(400).json({ error: "ZIP package required" });
    const title = cleanText(req.body.title, 100);
    const description = cleanText(req.body.description, 5000);
    const category = cleanText(req.body.category, 30) || "Other";
    const version = cleanText(req.body.version, 30) || "1.0.0";
    if (title.length < 2) {
      safeUnlink(pkg.filename);
      (req.files.cover || []).forEach(f => safeUnlink(f.filename));
      (req.files.gallery || []).forEach(f => safeUnlink(f.filename));
      return res.status(400).json({ error: "Title is required" });
    }
    const cover = req.files?.cover?.[0] ? fileUrl(req.files.cover[0].filename) : null;
    const r = await pool.query(
      `INSERT INTO addons(user_id,title,description,category,version,filename,original_filename,file_size,cover_image)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,title,description,category,version,downloads,likes,file_size,cover_image`,
      [req.user.id,title,description,category,version,pkg.filename,pkg.originalname,pkg.size,cover]
    );
    const addonId = r.rows[0].id;
    const gallery = (req.files?.gallery || []).map(f => fileUrl(f.filename));
    for (const image of gallery) await pool.query("INSERT INTO addon_images(addon_id,image_url) VALUES($1,$2)", [addonId,image]);
    res.status(201).json({ addon: r.rows[0] });
  } catch (e) {
    console.error(e);
    for (const key of ["package","cover","gallery"]) (req.files?.[key] || []).forEach(f => safeUnlink(f.filename));
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/api/addons/:id/download", async (req, res) => {
  try {
    const r = await pool.query("SELECT filename,original_filename FROM addons WHERE id=$1", [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "Аддон не найден" });
    const file = path.join(UPLOAD_DIR, path.basename(r.rows[0].filename));
    if (!fs.existsSync(file)) {
      return res.status(410).json({
        error: "ZIP-файл этого аддона больше не находится на сервере Workshop. Загрузите ZIP аддона заново.",
        code: "ADDON_FILE_MISSING"
      });
    }
    await pool.query("UPDATE addons SET downloads=downloads+1 WHERE id=$1", [req.params.id]);
    return res.download(file, r.rows[0].original_filename);
  } catch (e) {
    console.error("download:", e);
    return res.status(500).json({ error: "Не удалось скачать файл" });
  }
});

app.post("/api/addons/:id/like", auth, async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const old = await c.query("SELECT 1 FROM addon_likes WHERE addon_id=$1 AND user_id=$2", [req.params.id,req.user.id]);
    if (old.rowCount) {
      await c.query("DELETE FROM addon_likes WHERE addon_id=$1 AND user_id=$2", [req.params.id,req.user.id]);
      await c.query("UPDATE addons SET likes=GREATEST(likes-1,0) WHERE id=$1", [req.params.id]);
    } else {
      await c.query("INSERT INTO addon_likes(addon_id,user_id) VALUES($1,$2)", [req.params.id,req.user.id]);
      await c.query("UPDATE addons SET likes=likes+1 WHERE id=$1", [req.params.id]);
    }
    await c.query("COMMIT");
    const r = await pool.query("SELECT likes FROM addons WHERE id=$1", [req.params.id]);
    res.json({ likes: r.rows[0]?.likes ?? 0 });
  } catch (e) {
    await c.query("ROLLBACK");
    res.status(500).json({ error: "Like failed" });
  } finally { c.release(); }
});

app.post("/api/addons/:id/subscribe", auth, async (req, res) => {
  const old = await pool.query("SELECT 1 FROM subscriptions WHERE addon_id=$1 AND user_id=$2", [req.params.id,req.user.id]);
  if (old.rowCount) {
    await pool.query("DELETE FROM subscriptions WHERE addon_id=$1 AND user_id=$2", [req.params.id,req.user.id]);
    return res.json({ subscribed: false });
  }
  await pool.query("INSERT INTO subscriptions(addon_id,user_id) VALUES($1,$2)", [req.params.id,req.user.id]);
  res.json({ subscribed: true });
});

app.post("/api/addons/:id/comments", auth, async (req, res) => {
  const body = cleanText(req.body.body, 1000);
  if (!body) return res.status(400).json({ error: "Comment is empty" });
  const r = await pool.query(
    "INSERT INTO comments(addon_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at",
    [req.params.id,req.user.id,body]
  );
  res.status(201).json({ comment: { ...r.rows[0], username:req.user.username, avatar_url:req.user.avatar_url, role:req.user.role } });
});

app.get("/api/admin/overview", auth, admin, async (_req, res) => {
  const [users, addons, comments] = await Promise.all([
    pool.query("SELECT id,username,email,role,banned,created_at,avatar_url FROM users ORDER BY created_at DESC LIMIT 200"),
    pool.query("SELECT a.id,a.title,a.category,a.created_at,a.downloads,a.likes,u.username AS author FROM addons a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200"),
    pool.query("SELECT c.id,c.body,c.created_at,c.addon_id,a.title AS addon_title,u.username FROM comments c JOIN users u ON u.id=c.user_id JOIN addons a ON a.id=c.addon_id ORDER BY c.created_at DESC LIMIT 200")
  ]);
  res.json({ users:users.rows, addons:addons.rows, comments:comments.rows });
});

app.post("/api/admin/users/:id/ban", auth, admin, async (req, res) => {
  if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ error: "You cannot ban yourself" });
  await pool.query("UPDATE users SET banned=true WHERE id=$1", [req.params.id]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
  res.json({ ok:true });
});
app.post("/api/admin/users/:id/unban", auth, admin, async (req, res) => {
  await pool.query("UPDATE users SET banned=false WHERE id=$1", [req.params.id]);
  res.json({ ok:true });
});
app.post("/api/admin/users/:id/role", auth, admin, async (req, res) => {
  const role = req.body.role === "admin" ? "admin" : "user";
  if (String(req.params.id) === String(req.user.id) && role !== "admin") return res.status(400).json({ error: "You cannot remove your own admin role" });
  await pool.query("UPDATE users SET role=$1 WHERE id=$2", [role,req.params.id]);
  res.json({ ok:true });
});
app.delete("/api/admin/users/:id", auth, admin, async (req, res) => {
  if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ error: "You cannot delete yourself" });
  await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
  res.json({ ok:true });
});
app.delete("/api/admin/addons/:id", auth, admin, async (req, res) => {
  const r = await pool.query("SELECT filename,cover_image FROM addons WHERE id=$1", [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error:"Addon not found" });
  await pool.query("DELETE FROM addons WHERE id=$1", [req.params.id]);
  safeUnlink(r.rows[0].filename);
  safeUnlink(r.rows[0].cover_image?.replace(/^\/uploads\//,""));
  res.json({ ok:true });
});
app.delete("/api/admin/comments/:id", auth, admin, async (req, res) => {
  await pool.query("DELETE FROM comments WHERE id=$1", [req.params.id]);
  res.json({ ok:true });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

async function start() {
  try {
    await initDb();
    await pool.query("SELECT 1");
    app.listen(PORT, () => console.log(`HL2SBPP Workshop v6 running on port ${PORT}`));
  } catch (err) {
    console.error("Supabase database initialization failed:", err);
    process.exit(1);
  }
}
start();
