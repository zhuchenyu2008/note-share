import express from 'express';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3160);
const DATA_DIR = path.join(ROOT, 'data');
const DIST_DIR = path.join(ROOT, 'dist');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const VAULT_ROOT = process.env.VAULT_ROOT || '/vault/B 学科';
const SESSION_COOKIE = 'classnotes_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

fs.mkdirSync(DATA_DIR, { recursive: true });

marked.use(markedKatex({ throwOnError: false, output: 'html' }));
marked.setOptions({ gfm: true, breaks: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS auth_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT,
  mtime_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  summary TEXT,
  content_md TEXT NOT NULL,
  content_html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  note_id TEXT,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

function ensureAdminSeed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;
  const bootstrapPassword = crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO users (name, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword(bootstrapPassword));
  const bootstrapPath = path.join(DATA_DIR, 'bootstrap-admin.json');
  fs.writeFileSync(bootstrapPath, JSON.stringify({
    created_at: nowIso(),
    username: 'admin',
    password: bootstrapPassword,
    note: '首次登录后请在后台新增/修改用户密码。'
  }, null, 2));
}

function setMeta(key, value) {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

function getMeta(key) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

function extractFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return raw;
  const second = raw.indexOf('\n---\n', 4);
  if (second === -1) return raw;
  return raw.slice(second + 5);
}

function normalizeNoteRef(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/#.*/, '');
}

function buildNoteAliases(files) {
  const map = new Map();
  for (const filePath of files) {
    const id = noteIdFromPath(filePath);
    const relative = path.relative(VAULT_ROOT, filePath).replace(/\\/g, '/');
    const relativeNoExt = relative.replace(/\.md$/i, '');
    const base = path.basename(filePath);
    const baseNoExt = path.basename(filePath, '.md');
    for (const key of [relative, relativeNoExt, base, baseNoExt]) {
      if (key && !map.has(key)) map.set(key, id);
    }
  }
  return map;
}

function resolveInternalNoteId(target, aliasMap) {
  const normalized = normalizeNoteRef(target);
  const candidates = [
    normalized,
    normalized.endsWith('.md') ? normalized.slice(0, -3) : `${normalized}.md`,
    path.basename(normalized),
    path.basename(normalized).replace(/\.md$/i, ''),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (aliasMap.has(candidate)) return aliasMap.get(candidate);
  }
  return null;
}

function normalizeObsidianMarkdown(md, aliasMap = new Map()) {
  return md
    .replace(/!\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, target, label) => `附件：${label || path.basename(target)}`)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target, label) => {
      const noteId = resolveInternalNoteId(target, aliasMap);
      return noteId
        ? `<a href="#note-${noteId}" data-note-id="${noteId}" class="internal-note-link">${label}</a>`
        : label;
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_m, target) => {
      const noteId = resolveInternalNoteId(target, aliasMap);
      const text = path.basename(String(target)).replace(/\.md$/i, '');
      return noteId
        ? `<a href="#note-${noteId}" data-note-id="${noteId}" class="internal-note-link">${text}</a>`
        : text;
    })
    .replace(/^>\s*\[!([^\]]+)\]\s*/gim, (_m, kind) => `**${kind.toUpperCase()}：** `);
}

function summarizeMarkdown(md) {
  const text = normalizeObsidianMarkdown(md)
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_>`~-]/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' 数学公式 ')
    .replace(/\$[^$]+\$/g, ' 数学公式 ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 180);
}

function noteIdFromPath(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex');
}

function walkMarkdownFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md') && full.includes(`${path.sep}课堂笔记${path.sep}`)) {
      out.push(full);
    }
  }
  return out;
}

function syncNotes() {
  const files = walkMarkdownFiles(VAULT_ROOT);
  const aliasMap = buildNoteAliases(files);
  const existing = new Set();
  const upsert = db.prepare(`
    INSERT INTO notes (id, path, subject, title, date, mtime_ms, updated_at, summary, content_md, content_html)
    VALUES (@id, @path, @subject, @title, @date, @mtime_ms, @updated_at, @summary, @content_md, @content_html)
    ON CONFLICT(id) DO UPDATE SET
      path=excluded.path,
      subject=excluded.subject,
      title=excluded.title,
      date=excluded.date,
      mtime_ms=excluded.mtime_ms,
      updated_at=excluded.updated_at,
      summary=excluded.summary,
      content_md=excluded.content_md,
      content_html=excluded.content_html
  `);

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const id = noteIdFromPath(filePath);
    existing.add(id);
    const known = db.prepare('SELECT mtime_ms FROM notes WHERE id = ?').get(id);
    if (known && Number(known.mtime_ms) === Number(stat.mtimeMs)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    const content = normalizeObsidianMarkdown(extractFrontmatter(raw), aliasMap);
    const subject = filePath.split(path.sep).find((part) => ['数学', '英语', '地理', '历史', '政治'].includes(part)) || '未分类';
    const title = path.basename(filePath, '.md');
    const dateMatch = title.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : null;
    const contentHtml = marked.parse(content);
    upsert.run({
      id,
      path: filePath,
      subject,
      title,
      date,
      mtime_ms: Math.round(stat.mtimeMs),
      updated_at: new Date(stat.mtimeMs).toISOString(),
      summary: summarizeMarkdown(content),
      content_md: content,
      content_html: contentHtml,
    });
  }

  const current = db.prepare('SELECT id FROM notes').all().map((row) => row.id);
  const removeViews = db.prepare('DELETE FROM note_views WHERE note_id = ?');
  const remove = db.prepare('DELETE FROM notes WHERE id = ?');
  for (const id of current) {
    if (!existing.has(id)) {
      removeViews.run(id);
      remove.run(id);
    }
  }

  setMeta('last_sync_at', nowIso());
  setMeta('note_count', String(files.length));
  return { count: files.length, at: getMeta('last_sync_at') };
}

ensureAdminSeed();
syncNotes();
setInterval(() => {
  try {
    syncNotes();
  } catch (error) {
    console.error('sync failed', error);
  }
}, 120000);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, expiresAt };
}

function authRequired(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const row = db.prepare(`
    SELECT s.token, s.user_id, s.expires_at, u.name, u.is_admin, u.disabled
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row || row.disabled || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(nowIso(), token);
  req.user = { id: row.user_id, name: row.name, isAdmin: !!row.is_admin };
  next();
}

function adminRequired(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'FORBIDDEN' });
  next();
}

app.post('/api/login', (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ error: 'EMPTY_CODE' });
  const users = db.prepare('SELECT id, name, password_hash, is_admin, disabled FROM users WHERE disabled = 0').all();
  const matched = users.find((u) => verifyPassword(code, u.password_hash));
  if (!matched) return res.status(401).json({ error: 'INVALID_CODE' });
  const { token, expiresAt } = createSession(matched.id);
  db.prepare('INSERT INTO auth_log (user_id) VALUES (?)').run(matched.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    expires: new Date(expiresAt),
  });
  res.json({ user: { id: matched.id, name: matched.name, isAdmin: !!matched.is_admin } });
});

app.post('/api/logout', authRequired, (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.json({ user: null });
  const row = db.prepare(`
    SELECT s.token, s.user_id, s.expires_at, u.name, u.is_admin, u.disabled
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row || row.disabled || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    return res.json({ user: null });
  }
  res.json({ user: { id: row.user_id, name: row.name, isAdmin: !!row.is_admin } });
});

app.get('/api/notes', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim();
  const subject = String(req.query.subject || '').trim();
  let sql = 'SELECT id, subject, title, date, updated_at, summary, path FROM notes WHERE 1=1';
  const params = [];
  if (subject) {
    sql += ' AND subject = ?';
    params.push(subject);
  }
  if (q) {
    sql += ' AND (title LIKE ? OR summary LIKE ? OR content_md LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY date DESC, updated_at DESC';
  const notes = db.prepare(sql).all(...params).map((note) => ({
    ...note,
    relativePath: path.relative(VAULT_ROOT, note.path),
  }));
  const subjects = db.prepare('SELECT subject, COUNT(*) AS count FROM notes GROUP BY subject ORDER BY subject').all();
  res.json({ notes, subjects, lastSyncAt: getMeta('last_sync_at') });
});

app.get('/api/notes/:id', authRequired, (req, res) => {
  const note = db.prepare('SELECT id, subject, title, date, updated_at, content_md, content_html, path FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ note: { ...note, relativePath: path.relative(VAULT_ROOT, note.path) } });
});

app.post('/api/activity', authRequired, (req, res) => {
  const seconds = Math.max(0, Math.min(300, Number(req.body?.seconds || 0)));
  const noteId = req.body?.noteId ? String(req.body.noteId) : null;
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO daily_usage (user_id, day, seconds) VALUES (?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`).run(req.user.id, day, seconds);
  db.prepare('INSERT INTO note_views (user_id, note_id, seconds) VALUES (?, ?, ?)').run(req.user.id, noteId, seconds);
  res.json({ ok: true });
});

app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.is_admin AS isAdmin, u.disabled, u.created_at AS createdAt,
      COALESCE((SELECT COUNT(*) FROM auth_log a WHERE a.user_id = u.id), 0) AS loginCount,
      COALESCE((SELECT SUM(seconds) FROM daily_usage d WHERE d.user_id = u.id), 0) AS totalViewSeconds
    FROM users u
    ORDER BY u.created_at ASC
  `).all();
  res.json({ users });
});

app.post('/api/admin/users', authRequired, adminRequired, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const code = String(req.body?.code || '').trim();
  const isAdmin = !!req.body?.isAdmin;
  if (!name || !code) return res.status(400).json({ error: 'NAME_AND_CODE_REQUIRED' });
  try {
    db.prepare('INSERT INTO users (name, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(code), isAdmin ? 1 : 0);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: 'CREATE_USER_FAILED', detail: String(error.message || error) });
  }
});

app.put('/api/admin/users/:id', authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  const name = req.body?.name ? String(req.body.name).trim() : existing.name;
  const disabled = typeof req.body?.disabled === 'boolean' ? (req.body.disabled ? 1 : 0) : existing.disabled;
  const isAdmin = typeof req.body?.isAdmin === 'boolean' ? (req.body.isAdmin ? 1 : 0) : existing.is_admin;
  const nextHash = req.body?.code ? hashPassword(String(req.body.code).trim()) : existing.password_hash;
  db.prepare('UPDATE users SET name = ?, password_hash = ?, is_admin = ?, disabled = ? WHERE id = ?').run(name, nextHash, isAdmin, disabled, id);
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  const tx = db.transaction((userId) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM auth_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM daily_usage WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM note_views WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx(id);
  res.json({ ok: true });
});

app.get('/api/admin/stats', authRequired, adminRequired, (req, res) => {
  const users = db.prepare('SELECT id, name, is_admin AS isAdmin FROM users WHERE disabled = 0 ORDER BY name').all();
  const daily = db.prepare(`
    SELECT u.name, d.day, d.seconds
    FROM daily_usage d JOIN users u ON u.id = d.user_id
    ORDER BY d.day DESC, u.name ASC
    LIMIT 500
  `).all();
  const topNotes = db.prepare(`
    SELECT n.title, n.subject, SUM(v.seconds) AS seconds, COUNT(*) AS hits
    FROM note_views v JOIN notes n ON n.id = v.note_id
    GROUP BY v.note_id
    ORDER BY seconds DESC, hits DESC
    LIMIT 20
  `).all();
  const status = {
    noteCount: Number(getMeta('note_count') || 0),
    lastSyncAt: getMeta('last_sync_at'),
    bootstrapFile: path.join(DATA_DIR, 'bootstrap-admin.json'),
  };
  res.json({ users, daily, topNotes, status });
});

app.post('/api/admin/sync', authRequired, adminRequired, (req, res) => {
  const result = syncNotes();
  res.json({ ok: true, ...result });
});

app.get('/api/admin/bootstrap', authRequired, adminRequired, (req, res) => {
  const bootstrapPath = path.join(DATA_DIR, 'bootstrap-admin.json');
  if (!fs.existsSync(bootstrapPath)) return res.json({ bootstrap: null });
  const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, 'utf8'));
  res.json({ bootstrap });
});

app.use(express.static(DIST_DIR));
app.use((req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(503).send('Frontend not built yet. Run npm run build.');
  }
  res.sendFile(indexPath);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Classnotes Share listening on http://0.0.0.0:${PORT}`);
  console.log(`Admin bootstrap file: ${path.join(DATA_DIR, 'bootstrap-admin.json')}`);
});
