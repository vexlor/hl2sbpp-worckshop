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

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Copy .env.example to .env and set your Supabase PostgreSQL URL.");
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Supabase PostgreSQL. sslmode=require can be supplied in DATABASE_URL.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = path.extname(file.originalname).toLowerCase() === ".zip";
    cb(ok ? null : new Error("Only .zip addon packages are allowed"), ok);
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

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schema);
}

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query("INSERT INTO sessions (id,user_id,expires_at) VALUES ($1,$2,$3)", [id, userId, expires]);
  return { id, expires };
}

async function auth(req, res, next) {
  try {
    const sid = getSessionId(req);
    if (!sid) return res.status(401).json({ error: "Authentication required" });
    const result = await pool.query(
      `SELECT u.id,u.username,u.email,u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at > NOW()`,
      [sid]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Session expired" });
    req.user = result.rows[0];
    req.sessionId = sid;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Authentication check failed" });
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "supabase-postgres" });
  } catch (e) {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const username = cleanText(req.body.username, 32);
    const email = cleanText(req.body.email, 255).toLowerCase();
    const password = String(req.body.password || "");
    const repeat = String(req.body.repeatPassword || "");

    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username))
      return res.status(400).json({ error: "Username: 3-32 characters, letters/numbers/._-" });
    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (password !== repeat) return res.status(400).json({ error: "Passwords do not match" });

    const exists = await pool.query(
      "SELECT 1 FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($2) LIMIT 1",
      [email, username]
    );
    if (exists.rowCount) return res.status(409).json({ error: "Email or username already exists" });

    const hash = await bcrypt.hash(password, 12);
    const created = await pool.query(
      "INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,email,role",
      [username, email, hash]
    );
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
    const result = await pool.query(
      "SELECT id,username,email,password_hash,role FROM users WHERE lower(email)=lower($1)",
      [email]
    );
    if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash)))
      return res.status(401).json({ error: "Wrong email or password" });

    const u = result.rows[0];
    const session = await createSession(u.id);
    setSessionCookie(res, session.id, SESSION_DAYS * 86400);
    res.json({ user: { id: u.id, username: u.username, email: u.email, role: u.role } });
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
      `SELECT u.id,u.username,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at > NOW()`, [sid]
    );
    res.json({ user: r.rowCount ? r.rows[0] : null });
  } catch {
    res.json({ user: null });
  }
});

app.get("/api/addons", async (req, res) => {
  const q = cleanText(req.query.q, 100);
  const category = cleanText(req.query.category, 30);
  const params = [];
  const where = [];
  if (q) { params.push(`%${q}%`); where.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length})`); }
  if (category && category !== "All") { params.push(category); where.push(`a.category=$${params.length}`); }
  const sql = `SELECT a.id,a.title,a.description,a.category,a.version,a.downloads,a.likes,a.created_at,
                      u.username AS author
               FROM addons a JOIN users u ON u.id=a.user_id
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY a.created_at DESC LIMIT 100`;
  const r = await pool.query(sql, params);
  res.json({ addons: r.rows });
});

app.get("/api/addons/:id", async (req, res) => {
  const r = await pool.query(
    `SELECT a.id,a.title,a.description,a.category,a.version,a.downloads,a.likes,a.created_at,
            u.username AS author
     FROM addons a JOIN users u ON u.id=a.user_id WHERE a.id=$1`, [req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Addon not found" });
  const comments = await pool.query(
    `SELECT c.id,c.body,c.created_at,u.username FROM comments c JOIN users u ON u.id=c.user_id
     WHERE c.addon_id=$1 ORDER BY c.created_at DESC`, [req.params.id]
  );
  res.json({ addon: r.rows[0], comments: comments.rows });
});

app.post("/api/addons", auth, upload.single("package"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "ZIP package required" });
    const title = cleanText(req.body.title, 100);
    const description = cleanText(req.body.description, 5000);
    const category = cleanText(req.body.category, 30) || "Other";
    const version = cleanText(req.body.version, 30) || "1.0.0";
    if (title.length < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Title is required" });
    }
    const r = await pool.query(
      `INSERT INTO addons(user_id,title,description,category,version,filename,original_filename,file_size)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,title,description,category,version,downloads,likes`,
      [req.user.id,title,description,category,version,path.basename(req.file.path),req.file.originalname,req.file.size]
    );
    res.status(201).json({ addon: r.rows[0] });
  } catch (e) {
    console.error(e);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/api/addons/:id/download", async (req, res) => {
  const r = await pool.query("SELECT filename,original_filename FROM addons WHERE id=$1", [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Addon not found" });
  const file = path.join(UPLOAD_DIR, r.rows[0].filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "File missing" });
  await pool.query("UPDATE addons SET downloads=downloads+1 WHERE id=$1", [req.params.id]);
  res.download(file, r.rows[0].original_filename);
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
    await c.query("ROLLBACK"); res.status(500).json({ error: "Like failed" });
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
  res.status(201).json({ comment: { ...r.rows[0], username: req.user.username } });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.message?.includes(".zip")) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

async function start() {
  try {
    await initDb();
    await pool.query("SELECT 1");
    app.listen(PORT, () => console.log(`HL2SBPP Workshop v5 Supabase running on port ${PORT}`));
  } catch (err) {
    console.error("Supabase database initialization failed:", err);
    process.exit(1);
  }
}

start();
