# 部署与访问指南

站点是**零依赖静态文件**（原生 HTML/CSS/JS + 一个 JSON 数据文件），因此部署方式很轻。

本文档说明两条路线：

- **路线 A：在 CNB 上直接访问（推荐，已验证可用）** —— 用「云原生开发 · 仅预览模式」起服务，浏览器直接打开站点
- **路线 B：部署到 GitHub Pages** —— 需要 GitHub 凭据（建仓 + 首次推送须本人授权），详见 [DEPLOY-GITHUB.md](./DEPLOY-GITHUB.md)

---

## 路线 A：在 CNB 上直接访问

### 先说结论

CNB 是**云原生构建 / 云原生开发**平台，**不提供静态站点托管（对标 GitHub Pages）的能力**，
也没有「发布静态站点到公网域名」的原生功能。仓库里也没有 `pages` 类的内置任务。

但 CNB 有一个能力正好满足「在浏览器里点开就能看」的需求：
**云原生开发 · 仅预览模式（beta）** —— 点一下按钮就自动起环境 + 起服务 + 打开预览页面。

### 使用方式（1 次点击）

1. 在仓库分支页面点击右上角「**云原生开发**」按钮；
2. 平台按 `.cnb.yml` 里的 `$ → vscode` 流水线创建环境，执行
   `node llm-rank/scripts/serve.mjs`（监听 `8686` 端口）；
3. 环境就绪后**自动打开预览页面**，即站点首页。

配置（已在根 `.cnb.yml` 中）：

```yaml title=".cnb.yml"
$:
  vscode:
    - docker:
        image: node:20
      services:
        - docker
        - name: vscode
          options:
            onlyPreview: true                            # 仅预览模式：直接打开预览页而非 WebIDE
            launch: node llm-rank/scripts/serve.mjs      # 业务服务必须监听 8686 端口
```

`llm-rank/scripts/serve.mjs` 是一个零依赖的静态服务器，
默认监听 `0.0.0.0:8686`（必须 `0.0.0.0`，否则容器外访问不到）。

### 需要留意的地方

> 说明：CNB 侧**不再配置定时更新**（根 `.cnb.yml` 的 `crontab` 已移除），
> 预览页展示的是仓库里的数据快照，由 GitHub Actions 每天更新后提交到 `main`。

| 事项 | 说明 |
| --- | --- |
| 地址性质 | 预览地址是**临时开发环境地址**，环境回收后失效，不是长期稳定的公网域名 |
| 保活时间 | 关闭页面后默认 10 分钟无心跳即回收；开发环境最长保持 18 小时，且凌晨 4–6 点会被强制回收 |
| 计费 | 走**云原生开发**用量（免费额度 1600 核时/月），非「云原生构建」用量 |
| 访问控制 | 预览页面需要仓库访问权限，链接不能当作公开站点对外分享 |

> 也就是说：**CNB 适合「点开就看 / 内部验收」，不适合「对外发布一个长期可访问的网址」。**
> 要长期可访问的公开地址，走路线 B。

### 本地预览（同样用这个脚本）

```bash
node llm-rank/scripts/serve.mjs          # http://127.0.0.1:8686
PORT=8080 node llm-rank/scripts/serve.mjs  # 换端口
```

也可以用任意静态服务器，例如 `cd llm-rank && python3 -m http.server 8080`。

> ⚠️ 不要直接双击打开 `index.html`：页面用 `fetch` 读取 `data/models.json`，
> 浏览器同源策略会拦截 `file://` 请求，必须通过 HTTP 访问。

---

## 路线 B：部署到 GitHub Pages

完整步骤见 [DEPLOY-GITHUB.md](./DEPLOY-GITHUB.md)，简要流程：

1. 准备 GitHub 凭据（Personal Access Token 勾 `repo`+`workflow`，或 `gh auth login`）
2. `gh repo create <用户名>/llm-rank --public`
3. `git push` 到该仓库
4. GitHub 仓库 → **Settings → Pages → Source 选 GitHub Actions**
5. 访问 `https://<用户名>.github.io/llm-rank/`

推送 `llm-rank/**` 变更会自动触发 `.github/workflows/deploy-pages.yml` 重新发布。

> ⚠️ **NPC / 自动化环境没有 GitHub 凭据**，无法代替你建仓与首次推送，
> 这一步需要你本人补一次授权。

---

## 两条路线对比

| 维度 | CNB 仅预览模式 | GitHub Pages |
| --- | --- | --- |
| 一次性操作成本 | 点一下按钮 | 需 GitHub 凭据 + 建仓 + 推送 |
| 地址稳定性 | 临时环境地址，回收即失效 | 长期稳定 `https://<用户>.github.io/llm-rank/` |
| 适用场景 | 内部验收、随手点开看 | 对外发布、分享给他人 |
| 需要凭据 | 不需要（仓库权限即可） | 需要 GitHub Token / SSH Key |
| 自动更新 | 不再承担数据更新（`crontab` 已移除） | **唯一更新链路**：每天 00:17 UTC 更新数据并自动重新发布 |

> 当前分工：**GitHub 负责数据更新 + Pages 发布，CNB 只做内部预览验收**。
> 两条路线若同时开定时更新会写同一份 `data/models.json`，因此 CNB 侧 `crontab` 已移除，
> 只保留一条更新链路（详见 [DEPLOY-GITHUB.md](./DEPLOY-GITHUB.md)）。
