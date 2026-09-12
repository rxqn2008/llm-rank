# 🔥 大模型热度排行 · LLM Heat Ranking

一个零依赖、开箱即用的静态站点，展示主流大模型的**使用热度**、**综合评分**、**对战胜率**与**适用场景**，支持**数据每日自动更新**。

## 功能特性

- **热度排行**：热度指数、日均调用量、涨跌幅一览，支持按热度 / 评分 / 胜率 / 调用量 / 涨幅 / 性价比排序
- **热度趋势图**：近 7 / 14 / 30 天热度曲线，纯 SVG 手绘，点击图例可显隐曲线
- **适用场景矩阵**：按场景归类模型，每个场景推荐评分 Top 3
- **搜索与筛选**：支持按模型名、厂商、场景关键词检索，支持场景下拉筛选
- **数据明细表**：评分、胜率、上下文长度、参考价格、适用场景、一句话点评
- **每日自动更新**：定时流水线每天刷新数据快照，保留最近 30 天历史
- **响应式设计**：桌面端、平板、手机端自适应，支持 `prefers-reduced-motion`

## 技术栈

- **纯静态**：HTML + CSS + 原生 JavaScript，**零第三方依赖**，无需构建
- **数据格式**：单一 JSON 文件 `data/models.json`
- **图表**：原生 SVG 绘制，不引入图表库

## 目录结构

```
llm-rank/
├── index.html                    # 页面入口
├── assets/
│   ├── css/style.css             # 样式（暗色主题 + 响应式）
│   └── js/app.js                 # 渲染逻辑：排行 / 趋势图 / 场景 / 明细
├── data/models.json              # 数据快照（含 30 天历史）
├── scripts/update-data.mjs       # 数据更新脚本（Node 18+，无依赖）
├── DEPLOY-GITHUB.md              # 部署到 GitHub 的完整操作手册
├── .cnb.daily-update.yml         # CNB 每日更新流水线（可合并进根 .cnb.yml）
└── .github/workflows/
    ├── deploy-pages.yml          # 部署到 GitHub Pages
    └── update-data.yml           # GitHub Actions 每日更新
```

## 本地预览

因为使用了 `fetch` 读取 JSON，需通过 HTTP 服务访问（直接双击 `index.html` 会被浏览器同源策略拦截）：

```bash
cd llm-rank
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080
```

或使用 Node：

```bash
npx serve llm-rank
```

## 数据更新

### 手动更新

```bash
node llm-rank/scripts/update-data.mjs            # 联网拉取最新数据
node llm-rank/scripts/update-data.mjs --offline  # 强制离线演算（本地调试用）
```

### 数据来源优先级

脚本按以下顺序获取数据，任一环节失败自动降级，**保证站点永远不会空白**：

1. **自定义数据源**：设置环境变量 `LLM_RANK_SOURCE=https://your-api/models`，返回 `{ "models": [...] }` 或数组
2. **OpenRouter 公开模型榜**：`https://openrouter.ai/api/v1/models`，按上下文窗口与价格估算热度
3. **离线演算**：基于现有快照做确定性日演算，名次保持稳定，涨跌幅控制在真实量级

> 说明：外部数据源只覆盖**热度、评分、调用量**等指标；`scenarios`（适用场景）与 `summary`（点评）属于人工维护字段，不会被外部数据覆盖，如需调整请直接编辑 `data/models.json`。

### 定时自动更新

**方式一：CNB 流水线（推荐）**

把 `llm-rank/.cnb.daily-update.yml` 中的 `main` 节点合并到仓库根目录 `.cnb.yml`，即可每天 08:20（北京时间）自动更新并提交数据：

```yaml
main:
  "crontab: 20 8 * * *":
    - stages:
        - name: 更新大模型热度数据
          image: node:20
          script: |
            node llm-rank/scripts/update-data.mjs
        - name: 提交数据变更
          image: cnbcool/git:latest
          script: |
            git config user.name "cnb-npc[bot]"
            git config user.email "cnb-npc@noreply.cnb.cool"
            git add llm-rank/data/models.json
            git diff --staged --quiet || git commit -m "chore: 更新大模型热度数据 $(date -u +%F)"
            git push origin HEAD:main
```

**方式二：GitHub Actions**

`.github/workflows/update-data.yml` 已配置每天 00:17 UTC 自动运行，也可在 Actions 页面手动触发。

## 部署到 GitHub

完整操作步骤见 [DEPLOY-GITHUB.md](./DEPLOY-GITHUB.md)，简要流程：

1. **准备凭据**：GitHub Personal Access Token（勾选 `repo`、`workflow`）或 `gh auth login`
2. **创建仓库**：`gh repo create <用户名>/llm-rank --public`
3. **推送代码**：`git remote add github https://github.com/<用户名>/llm-rank.git && git push github main`
4. **启用 Pages**：Settings → Pages → Source 选择 **GitHub Actions**，等待部署完成
5. **访问站点**：`https://<用户名>.github.io/llm-rank/`

推送 `llm-rank/**` 变更会自动触发 `deploy-pages.yml` 重新发布；`update-data.yml` 每天 00:17 UTC 自动刷新数据。

> ⚠️ 若 GitHub 与 CNB 同时开启定时更新，建议只保留一条更新链路，避免两地写入同一数据文件造成推送冲突。

## 数据字段说明

| 字段 | 含义 |
| --- | --- |
| `usage` | 热度指数，0–100，综合使用量与关注度归一化 |
| `score` | 综合评分，0–100，能力维度加权 |
| `winRate` | 对战胜率，%，同场景双盲对比胜出比例 |
| `calls` | 日均调用量，单位亿次/天 |
| `context` | 上下文窗口，单位 K token |
| `price` | 每百万输入 token 的美元价格 |
| `scenarios` | 适用场景标签数组 |
| `summary` | 一句话点评 |
| `history` | 最近 30 天热度快照，用于趋势图与涨跌幅计算 |

## 免责声明

本站为演示性质的热度聚合站点，指标基于公开信息估算，不代表官方数据，不构成采购或选型建议。

## 维护提示

- 新增模型：在 `data/models.json` 的 `models` 数组中追加一条记录即可，字段缺失会由更新脚本自动估值补齐
- 调整场景标签：建议在 `scripts/update-data.mjs` 或数据文件中统一维护，避免每个模型使用独立标签导致场景矩阵失去意义
