import { useEffect, useMemo, useState } from 'react';

const TREE_STATE_KEY = 'classnotes_tree_expanded_v1';
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  Lock,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

type User = { id: number; name: string; isAdmin: boolean };
type NoteListItem = {
  id: string;
  subject: string;
  title: string;
  date: string | null;
  updated_at: string;
  summary: string;
  path: string;
  relativePath: string;
};
type SubjectItem = { subject: string; count: number };
type NoteDetail = {
  id: string;
  subject: string;
  title: string;
  date: string | null;
  updated_at: string;
  content_md: string;
  content_html: string;
  path: string;
  relativePath: string;
};
type AdminUser = {
  id: number;
  name: string;
  isAdmin: boolean;
  disabled: number;
  createdAt: string;
  loginCount: number;
  totalViewSeconds: number;
};
type DailyStat = { name: string; day: string; seconds: number };
type TopNote = { title: string; subject: string; seconds: number; hits: number };
type AdminStats = {
  users: Array<{ id: number; name: string; isAdmin: boolean }>;
  daily: DailyStat[];
  topNotes: TopNote[];
  status: { noteCount: number; lastSyncAt: string | null; bootstrapFile: string };
};
type TreeNode = {
  key: string;
  name: string;
  type: 'folder' | 'note';
  noteId?: string;
  children?: TreeNode[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatDate(date: string | null | undefined) {
  if (!date) return '未标注日期';
  return date;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatSeconds(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  if (m > 0) return `${m}分钟`;
  return `${seconds}秒`;
}

function buildTree(notes: NoteListItem[]): TreeNode[] {
  const root = new Map<string, TreeNode>();

  const insert = (container: Map<string, TreeNode>, parts: string[], note: NoteListItem, prefix = '') => {
    const [head, ...rest] = parts;
    if (!head) return;
    const key = prefix ? `${prefix}/${head}` : head;
    const isLeaf = rest.length === 0;
    if (!container.has(key)) {
      container.set(key, {
        key,
        name: head,
        type: isLeaf ? 'note' : 'folder',
        noteId: isLeaf ? note.id : undefined,
        children: isLeaf ? undefined : [],
      });
    }
    const node = container.get(key)!;
    if (isLeaf) {
      node.type = 'note';
      node.noteId = note.id;
      return;
    }
    if (!node.children) node.children = [];
    const childMap = new Map(node.children.map((child) => [child.key, child]));
    insert(childMap, rest, note, key);
    node.children = Array.from(childMap.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  };

  for (const note of notes) {
    const parts = note.relativePath.split('/').filter(Boolean);
    insert(root, parts, note);
  }

  return Array.from(root.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

function TreeItem({
  node,
  selectedId,
  expanded,
  toggleFolder,
  onSelect,
}: {
  node: TreeNode;
  selectedId: string;
  expanded: Record<string, boolean>;
  toggleFolder: (key: string) => void;
  onSelect: (id: string) => void;
}) {
  if (node.type === 'note') {
    return (
      <button className={`tree-item tree-note ${selectedId === node.noteId ? 'active' : ''}`} onClick={() => onSelect(node.noteId || '')}>
        <FileText size={15} />
        <span>{node.name.replace(/\.md$/i, '')}</span>
      </button>
    );
  }

  const isOpen = expanded[node.key] ?? true;
  return (
    <div className="tree-group">
      <button className="tree-item tree-folder" onClick={() => toggleFolder(node.key)}>
        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        {isOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
        <span>{node.name}</span>
      </button>
      {isOpen && node.children?.length ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeItem
              key={child.key}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              toggleFolder={toggleFolder}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api<{ user: User }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      onLogin(data.user);
    } catch {
      setError('访问码不正确。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="hero-badge">CLASS NOTES / SHARE</div>
        <h1>课堂笔记共享站</h1>
        <p>只同步课堂笔记。支持 Markdown、数学公式、表格与代码块，移动端也能正常阅读。</p>
        <form onSubmit={submit} className="login-form">
          <label>访问码</label>
          <div className="input-shell">
            <Lock size={16} />
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入访问码" type="password" />
          </div>
          {error ? <div className="error-tip">{error}</div> : null}
          <button type="submit" className="primary-btn large" disabled={loading || !code.trim()}>
            {loading ? '正在进入...' : '进入笔记库'}
          </button>
        </form>
      </div>
    </div>
  );
}

function NotesPage({ user }: { user: User }) {
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [selected, setSelected] = useState<NoteDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [current, setCurrent] = useState<'notes' | 'admin'>('notes');
  const [showSidebar, setShowSidebar] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(TREE_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const loadNotes = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (subject) params.set('subject', subject);
      if (search.trim()) params.set('q', search.trim());
      const data = await api<{ notes: NoteListItem[]; subjects: SubjectItem[]; lastSyncAt: string | null }>(`/api/notes?${params.toString()}`);
      setNotes(data.notes);
      setSubjects(data.subjects);
      setLastSyncAt(data.lastSyncAt);
      const nextId = selectedId && data.notes.some((note) => note.id === selectedId) ? selectedId : data.notes[0]?.id || '';
      setSelectedId(nextId);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    if (!id) {
      setSelected(null);
      return;
    }
    setDetailLoading(true);
    try {
      const data = await api<{ note: NoteDetail }>(`/api/notes/${id}`);
      setSelected(data.note);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadNotes().catch(console.error);
  }, [search, subject]);

  useEffect(() => {
    loadDetail(selectedId).catch(console.error);
  }, [selectedId]);

  useEffect(() => {
    localStorage.setItem(TREE_STATE_KEY, JSON.stringify(expanded));
  }, [expanded]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api('/api/activity', {
        method: 'POST',
        body: JSON.stringify({ seconds: 30, noteId: selectedId || null }),
      }).catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    document.body.style.overflow = showSidebar ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [showSidebar]);

  const logout = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined);
    window.location.reload();
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (user.isAdmin) {
        await api('/api/admin/sync', { method: 'POST' });
      }
      await loadNotes();
      if (selectedId) await loadDetail(selectedId);
    } finally {
      setRefreshing(false);
    }
  };

  const tree = useMemo(() => buildTree(notes), [notes]);
  const breadcrumbs = useMemo(() => (selected?.relativePath ? selected.relativePath.replace(/\.md$/i, '').split('/') : []), [selected?.relativePath]);

  const filteredCountText = loading ? '加载中...' : `${notes.length} 篇课堂笔记`;

  const toggleFolder = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const selectNote = (id: string) => {
    setSelectedId(id);
    setShowSidebar(false);
  };

  const handleArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a[data-note-id]') as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    const noteId = anchor.dataset.noteId;
    if (noteId) selectNote(noteId);
  };

  if (current === 'admin' && user.isAdmin) {
    return <AdminPage user={user} onBack={() => setCurrent('notes')} onLogout={logout} />;
  }

  return (
    <div className="page-shell">
      <header className="mobile-topbar">
        <button className="icon-btn" onClick={() => setShowSidebar(true)}>
          <Menu size={18} />
        </button>
        <div>
          <div className="mobile-title">课堂笔记共享站</div>
          <div className="mobile-sub">{user.name}</div>
        </div>
        <button className="icon-btn" onClick={refresh}>
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>
      </header>

      <div className="workspace-shell">
        <aside className={`sidebar-panel ${showSidebar ? 'show' : ''}`}>
          <div className="sidebar-header">
            <div>
              <div className="hero-badge soft">OBSIDIAN-LIKE TREE</div>
              <h2>课堂笔记共享站</h2>
            </div>
            <button className="icon-btn sidebar-close" onClick={() => setShowSidebar(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="tree-panel card-like top-priority-tree">
            {tree.map((node) => (
              <TreeItem key={node.key} node={node} selectedId={selectedId} expanded={expanded} toggleFolder={toggleFolder} onSelect={selectNote} />
            ))}
            {!loading && tree.length === 0 ? <div className="empty-state">没有符合条件的笔记。</div> : null}
          </div>

          <div className="sidebar-bottom-tools">
            <div className="search-shell light compact-search">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索课堂笔记" />
            </div>

            <div className="subject-strip">
              <button className={`subject-tag ${subject === '' ? 'active' : ''}`} onClick={() => setSubject('')}>全部</button>
              {subjects.map((item) => (
                <button key={item.subject} className={`subject-tag ${subject === item.subject ? 'active' : ''}`} onClick={() => setSubject(item.subject)}>
                  {item.subject}
                </button>
              ))}
            </div>

            <div className="sidebar-actions compact-actions">
              <button className="chip-btn active">
                <BookOpen size={15} /> 课堂笔记
              </button>
              {user.isAdmin ? (
                <button className="chip-btn" onClick={() => setCurrent('admin')}>
                  <BarChart3 size={15} /> 管理后台
                </button>
              ) : null}
            </div>

            <div className="user-summary card-like compact-user-summary">
              <div>
                <div className="user-summary-name">{user.name}</div>
                <div className="muted">{user.isAdmin ? '管理员账号' : '共享访问账号'}</div>
              </div>
              {user.isAdmin ? <Shield size={18} /> : <GraduationCap size={18} />}
            </div>

            <div className="sidebar-meta compact-meta">
              <div>
                <strong>{filteredCountText}</strong>
                <span>上次同步：{formatDateTime(lastSyncAt)}</span>
              </div>
              <div className="sidebar-mini-actions">
                <button className="icon-btn" onClick={refresh} title="刷新"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
                <button className="icon-btn" onClick={logout} title="退出"><LogOut size={16} /></button>
              </div>
            </div>
          </div>
        </aside>

        {showSidebar ? <button className="sidebar-mask" onClick={() => setShowSidebar(false)} /> : null}

        <main className="content-panel">
          <section className="article-card">
            {detailLoading ? (
              <div className="empty-state large">正在载入笔记...</div>
            ) : selected ? (
              <>
                <div className="article-head">
                  <div className="article-breadcrumbs">
                    {breadcrumbs.map((part, index) => (
                      <span key={`${part}-${index}`} className="breadcrumb-item">
                        {index > 0 ? <ChevronRight size={13} /> : null}
                        <span>{part}</span>
                      </span>
                    ))}
                  </div>
                  <div className="article-head-top">
                    <span className="subject-badge">{selected.subject}</span>
                    <span className="date-badge">{formatDate(selected.date)}</span>
                    <span className="muted inline"><Clock3 size={14} /> 更新于 {formatDateTime(selected.updated_at)}</span>
                  </div>
                  <h1>{selected.title}</h1>
                  <div className="article-path"><Folder size={14} /> {selected.relativePath}</div>
                </div>
                <article className="markdown-body light" onClick={handleArticleClick} dangerouslySetInnerHTML={{ __html: selected.content_html }} />
              </>
            ) : (
              <div className="empty-state large">从左侧文件树选择一篇课堂笔记开始阅读。</div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function AdminPage({ user, onBack, onLogout }: { user: User; onBack: () => void; onLogout: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    const [u, s] = await Promise.all([
      api<{ users: AdminUser[] }>('/api/admin/users'),
      api<AdminStats>('/api/admin/stats'),
    ]);
    setUsers(u.users);
    setStats(s);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ name, code, isAdmin }),
      });
      setName('');
      setCode('');
      setIsAdmin(false);
      setSaved(true);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleDisabled = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      await api(`/api/admin/users/${target.id}`, {
        method: 'PUT',
        body: JSON.stringify({ disabled: !target.disabled }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const deleteUser = async (target: AdminUser) => {
    if (!window.confirm(`确定删除用户「${target.name}」吗？这会同时删除他的登录与查看统计。`)) return;
    setBusyId(target.id);
    try {
      await api(`/api/admin/users/${target.id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div>
          <div className="hero-badge soft">ADMIN CONSOLE</div>
          <h1>访问控制与统计</h1>
          <p>可以新增、停用、删除用户，并查看登录次数和每日浏览时长。</p>
        </div>
        <div className="topbar-button-row">
          <button className="secondary-btn" onClick={load}><RefreshCw size={16} /> 刷新</button>
          <button className="secondary-btn" onClick={onBack}><BookOpen size={16} /> 返回笔记</button>
          <button className="secondary-btn" onClick={onLogout}><LogOut size={16} /> 退出</button>
        </div>
      </header>

      <div className="admin-grid wide-gap">
        <section className="soft-card">
          <div className="section-head">
            <div>
              <div className="hero-badge soft">NEW USER</div>
              <h3>新增访问用户</h3>
            </div>
          </div>
          <form className="admin-form" onSubmit={createUser}>
            <input placeholder="用户名称，例如：李华" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="访问码" value={code} onChange={(e) => setCode(e.target.value)} />
            <label className="checkbox-row">
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
              <span>设为管理员</span>
            </label>
            <button className="primary-btn" disabled={saving || !name.trim() || !code.trim()}>
              <UserPlus size={16} /> {saving ? '创建中...' : '新增用户'}
            </button>
            {saved ? <div className="success-tip"><Check size={14} /> 已创建</div> : null}
          </form>
        </section>

        <section className="soft-card">
          <div className="section-head">
            <div>
              <div className="hero-badge soft">SYSTEM STATUS</div>
              <h3>站点状态</h3>
            </div>
          </div>
          <div className="stats-grid">
            <div className="stat-card"><span>当前管理员</span><strong>{user.name}</strong></div>
            <div className="stat-card"><span>课堂笔记数</span><strong>{stats?.status.noteCount ?? '—'}</strong></div>
            <div className="stat-card"><span>最近同步</span><strong>{formatDateTime(stats?.status.lastSyncAt)}</strong></div>
            <div className="stat-card"><span>初始化凭据文件</span><strong className="mono small">{stats?.status.bootstrapFile ?? '—'}</strong></div>
          </div>
        </section>
      </div>

      <section className="soft-card">
        <div className="section-head">
          <div>
            <div className="hero-badge soft">USER MANAGEMENT</div>
            <h3>用户列表</h3>
          </div>
        </div>
        <div className="user-list">
          {users.map((item) => (
            <div className="user-row" key={item.id}>
              <div>
                <div className="user-row-name">{item.name}</div>
                <div className="muted">{item.isAdmin ? '管理员' : '普通用户'} · 创建于 {formatDateTime(item.createdAt)} · {item.disabled ? '已停用' : '启用中'}</div>
              </div>
              <div className="user-row-metrics">
                <span><Users size={14} /> 登录 {item.loginCount} 次</span>
                <span><Eye size={14} /> 查看 {formatSeconds(item.totalViewSeconds)}</span>
              </div>
              <div className="user-row-actions">
                {item.id !== user.id ? (
                  <>
                    <button className="secondary-btn danger-lite" onClick={() => toggleDisabled(item)} disabled={busyId === item.id}>
                      <UserMinus size={15} /> {item.disabled ? '启用' : '停用'}
                    </button>
                    <button className="secondary-btn danger" onClick={() => deleteUser(item)} disabled={busyId === item.id}>
                      <Trash2 size={15} /> 删除
                    </button>
                  </>
                ) : (
                  <span className="self-pill">当前账号</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="admin-grid wide-gap">
        <section className="soft-card">
          <div className="section-head">
            <div>
              <div className="hero-badge soft">DAILY VIEW TIME</div>
              <h3>按天查看时长</h3>
            </div>
          </div>
          <div className="list-stack compact">
            {stats?.daily?.length ? stats.daily.map((row, index) => (
              <div className="metric-row" key={`${row.name}-${row.day}-${index}`}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.day}</span>
                </div>
                <b>{formatSeconds(row.seconds)}</b>
              </div>
            )) : <div className="empty-state">还没有统计数据。</div>}
          </div>
        </section>

        <section className="soft-card">
          <div className="section-head">
            <div>
              <div className="hero-badge soft">HOT NOTES</div>
              <h3>热门笔记</h3>
            </div>
          </div>
          <div className="list-stack compact">
            {stats?.topNotes?.length ? stats.topNotes.map((note, index) => (
              <div className="metric-row" key={`${note.title}-${index}`}>
                <div>
                  <strong>{note.title}</strong>
                  <span>{note.subject} · {note.hits} 次</span>
                </div>
                <b>{formatSeconds(note.seconds)}</b>
              </div>
            )) : <div className="empty-state">还没有热门笔记数据。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User | null }>('/api/me')
      .then((data) => setUser(data.user))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-screen">正在连接课堂笔记库...</div>;
  if (!user) return <LoginPage onLogin={setUser} />;
  return <NotesPage user={user} />;
}
