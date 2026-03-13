# note-share

一个面向 Obsidian 课堂笔记的轻量分享站：

- 只同步指定目录下的 Markdown 课堂笔记
- 支持密码登录（多用户 / 多访问码）
- 支持管理员后台查看登录次数、每日查看时长、热门笔记
- 支持 Markdown、表格、代码块、KaTeX 数学公式
- 移动端可读，带接近 Obsidian 的文件树、面包屑、内部双链跳转
- 支持 Docker / Docker Compose 部署


---

## 目录结构约定

应用会扫描 `VAULT_ROOT` 下包含 `课堂笔记/` 的 `.md` 文件。

一个典型结构例如：

```text
学习/
└── B 学科/
    ├── 数学/
    │   └── 课堂笔记/
    │       └── 2026-03-13 数学 课堂 ... .md
    ├── 英语/
    │   └── 课堂笔记/
    │       └── 2026-03-13 英语 课堂 ... .md
    └── 历史/
        └── 课堂笔记/
            └── 2026-03-12 历史 课堂 ... .md
```

---

## 快速开始（Docker Compose）

### 1. 克隆仓库

```bash
git clone https://github.com/zhuchenyu2008/note-share.git
cd note-share
```

### 2. 指定你的 Obsidian 笔记目录

`compose.yaml` 里默认写的是：

```yaml
- ${VAULT_HOST_PATH:-./example-vault}:/vault:ro
```

你可以二选一：

#### 方案 A：直接用环境变量

```bash
export VAULT_HOST_PATH="/your/obsidian/学习"
```

然后启动：

```bash
docker compose up -d --build
```

#### 方案 B：直接改 `compose.yaml`

把上面的宿主机路径替换成你自己的，例如：

```yaml
- /your/obsidian/学习:/vault:ro
```

---

## 启动后访问

默认端口：`3160`

```text
http://127.0.0.1:3160
```

首次启动会在 `data/bootstrap-admin.json` 里生成初始管理员访问码。
登录后建议立刻：

- 新建你自己的管理员账号 / 访问码
- 删除或替换初始访问码
- 再给其他查看者创建独立访问码

---

## 常用命令

### 启动 / 重建

```bash
docker compose up -d --build
```

### 查看日志

```bash
docker compose logs -f
```

### 停止

```bash
docker compose down
```

### 更新后重启

```bash
git pull
docker compose up -d --build
```

---

## 数据说明

运行时数据默认保存在：

```text
./data/
```

这里会包含：

- SQLite 数据库
- 初始化管理员访问码文件
- 登录 / 访问统计

**不要把 `data/` 提交到公开仓库。**
仓库里的 `.gitignore` 已默认忽略该目录。


---

## 技术栈

- React + TypeScript + Vite
- Express
- SQLite (`better-sqlite3`)
- KaTeX
- Docker / Docker Compose


