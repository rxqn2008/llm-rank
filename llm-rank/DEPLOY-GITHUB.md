# 部署到 GitHub 操作手册

> 站点是**零依赖静态文件**，部署到 GitHub 有两条路线：
> - **路线 A：GitHub Pages（推荐）** —— 免费托管 + 自动 HTTPS + 每次推送自动发布，本手册主推
> - **路线 B：GitHub 仓库 + 外部托管** —— 推送到 GitHub 后，用 Vercel / Netlify / Cloudflare Pages 拉取部署
>
> 两种路线都需要先有一个 **GitHub 仓库** 和一个 **授权凭据**。

---

## 第一步：准备 GitHub 凭据

### 方式 1：Personal Access Token（最通用）

1. 打开 <https://github.com/settings/tokens> → **Generate new token (classic)**
2. 勾选 scope：
   - `repo`（推送代码，必选）
   - `workflow`（如需推送/修改 `.github/workflows/*`，必选）
3. 生成后**立即复制** token（只显示一次），形如 `ghp_xxxxxxxx`

### 方式 2：gh CLI 登录

```bash
gh auth login        # 浏览器授权，或粘贴 token
gh auth status       # 确认登录成功
```

### 方式 3：SSH Key

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub     # 粘贴到 https://github.com/settings/keys
```

---

## 第二步：创建 GitHub 仓库

在 GitHub 页面点 **New repository**，或使用 CLI：

```bash
# 公开仓库（Pages 可直接访问，无需付费）
gh repo create <你的用户名>/llm-rank --public

# 私有仓库（Pages 私有站点发布需要 GitHub Pro/Team）
gh repo create <你的用户名>/llm-rank --private
```

> ⚠️ 仓库名用 `llm-rank` 或任意名称均可；若仓库根目录**不是**站点根目录，Pages 部署时需保证工作流 `path` 指向 `llm-rank`（本仓库工作流已配置好）。

---

## 第三步：把代码推送到 GitHub

在本仓库根目录执行（把 `<你的用户名>` 换成实际值）：

```bash
# 1) 添加 GitHub 远端
git remote add github https://github.com/<你的用户名>/llm-rank.git

# 2) 推送主分支（首次推送）
git push github main

# 3) 同时推送站点分支（若站点在独立分支上）
git push github <当前分支名>:main
```

若使用 Token 认证，推送时按提示输入：

```bash
# 用户名填 GitHub 用户名，密码位置填 token
git push https://<你的用户名>@github.com/<你的用户名>/llm-rank.git main
```

也可以把 token 授权给 NPC 运行环境（推荐用环境变量，避免写入仓库）：

```bash
export GITHUB_TOKEN=ghp_xxxxxxxx
git push https://x-access-token:${GITHUB_TOKEN}@github.com/<你的用户名>/llm-rank.git main
```

> 💡 **本仓库（CNB）的 Git 只配置了 CNB 凭据**，因此 NPC 无法直接替你在 GitHub 推送；补上上面任一凭据后即可继续。

---

## 第四步：启用 GitHub Pages

1. 进入仓库 → **Settings** → **Pages**
2. **Build and deployment → Source** 选择 **GitHub Actions**（不要选 Deploy from a branch，本站点直接发布 `llm-rank/` 目录）
3. 回到 **Actions** 页面，运行 **部署大模型热度排行站点到 GitHub Pages**（或直接推送一次 `llm-rank/**` 变更触发）
4. 部署完成后访问：`https://<你的用户名>.github.io/llm-rank/`

首次部署若提示环境未授权，请在 **Settings → Environments → github-pages** 中允许 `main` 分支部署。

---

## 第五步：每日自动更新数据

工作流 `llm-rank/.github/workflows/update-data.yml` 已配置：

- 每天 **00:17 UTC（北京时间 08:17）** 自动拉取数据并提交
- 支持手动触发（Actions → 每日更新大模型热度数据 → Run workflow）

需要仓库写入权限，工作流内已声明 `permissions: contents: write`，无需额外配置。

如需自定义数据源，在 **Settings → Secrets and variables → Actions** 中新增：

| Secret | 说明 |
| --- | --- |
| `LLM_RANK_SOURCE` | 自定义 JSON 数据源地址，返回 `{ "models": [...] }` 或数组 |

未配置时脚本自动回退到 OpenRouter 公开模型榜 → 离线演算，站点不会空白。

---

## 与 CNB 双线并行的建议

本站点当前已在 CNB 侧配置了每日更新流水线（根 `.cnb.yml` 的 `crontab: 20 8 * * *`）。
如果同时启用 GitHub Actions 定时更新，两边会各写一份 `data/models.json`，建议二选一：

- **方案 1（推荐）**：CNB 为主库，GitHub 作只读镜像/发布端，禁用 GitHub 侧的 `schedule`；
- **方案 2**：GitHub 为主库，删除 CNB 侧的 `crontab` 节点。

否则两边定时任务可能产生推送冲突（工作流已内置 `git pull --rebase --autostash` 缓解，但仍建议只保留一条链路）。

---

## 常见问题

**Q：Pages 部署成功但页面 404 / 白屏？**
A：确认 Pages Source 选的是 **GitHub Actions**；确认部署产物路径为 `llm-rank`（含 `index.html`）；`assets/js/app.js` 通过 `fetch('data/models.json')` 读数据，必须走 Pages/HTTP 访问，不能本地双击打开。

**Q：私有仓库能用 Pages 吗？**
A：私有仓库的**私有** Pages 站点需要 GitHub Pro/Team；免费账号下私有仓库的 Pages 站点也会公开可访问。

**Q：推送被拒绝（non-fast-forward）？**
A：GitHub 仓库上已有提交，先执行 `git pull --rebase github main` 再推送。

**Q：Actions 报 `Resource not accessible by integration`？**
A：仓库 **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**。
