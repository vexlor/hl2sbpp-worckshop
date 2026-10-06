# Workshop SSO patch for Addons FINAL-v2

Этот патч нужен один раз на Workshop, чтобы кнопка «Войти через Workshop» могла создать одноразовый токен.

## 1. Добавьте в Workshop server.js после `createSession()`

```js
function cleanTransferReturn(v){
  const p=String(v||'/');
  if(!p.startsWith('/')||p.startsWith('//')||p.includes('\\\\')||p.includes('\\0')) return '/';
  return p.slice(0,500);
}
function hashTransferToken(token){
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

app.get('/auth/transfer', async (req,res)=>{
  try{
    const sid=getSessionId(req);
    if(!sid) return res.redirect('/?login=1');
    const r=await pool.query(`SELECT u.id,u.banned FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()`,[sid]);
    if(!r.rowCount || r.rows[0].banned) return res.redirect('/?login=1');

    const returnTo=String(req.query.return_to||'');
    if(!returnTo.startsWith('https://hl2sbpp-addonss.onrender.com/auth/callback')) return res.status(400).send('Invalid SSO target');
    const u=new URL(returnTo);
    const next=cleanTransferReturn(u.searchParams.get('next')||'/');
    const token=crypto.randomBytes(32).toString('hex');
    const hash=hashTransferToken(token);
    await pool.query(`INSERT INTO auth_transfers(token_hash,user_id,return_path,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '2 minutes')`,[hash,r.rows[0].id,next]);
    u.searchParams.set('token',token);
    u.searchParams.set('next',next);
    res.redirect(302,u.toString());
  }catch(e){console.error('SSO transfer:',e);res.status(500).send('SSO transfer failed');}
});
```

## 2. В Workshop db/schema.sql добавьте

```sql
CREATE TABLE IF NOT EXISTS auth_transfers (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_path TEXT NOT NULL DEFAULT '/',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_transfers_expiry_idx ON auth_transfers(expires_at);
CREATE INDEX IF NOT EXISTS auth_transfers_user_idx ON auth_transfers(user_id);
```

После деплоя Workshop и Addons используют одну и ту же Supabase БД, поэтому токен виден обоим сервисам.
