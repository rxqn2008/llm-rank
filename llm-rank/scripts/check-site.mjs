#!/usr/bin/env node
/**
 * 站点自检（零依赖、无需浏览器）
 *
 * 校验内容：
 *   1) 站点四大件齐全：index.html / 样式 / 脚本 / 数据文件
 *   2) 数据文件结构完整：models / history / snapshot / latestRelease
 *   3) 每条模型字段类型合法，releasedAt 格式为 YYYY-MM-DD（可为空）
 *   4) 前端渲染所依赖的 DOM 挂载点都在 index.html 里
 *
 * 用法：
 *   node llm-rank/scripts/check-site.mjs
 * 退出码非 0 表示自检失败，可直接用于 CI（GitHub Actions / CNB 流水线）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);

const REQUIRED_FILES = [
  'index.html',
  'assets/css/style.css',
  'assets/js/app.js',
  'data/models.json',
];
for (const f of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(ROOT, f))) fail(`缺少文件：llm-rank/${f}`);
}

// 数据文件
let data = null;
try {
  data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/models.json'), 'utf8'));
} catch (e) {
  fail(`data/models.json 解析失败：${e.message}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_FIELDS = ['usage', 'score', 'winRate', 'calls', 'context', 'price', 'rank', 'share'];

if (data) {
  if (!Array.isArray(data.models) || !data.models.length) fail('models 为空或不是数组');
  if (!Array.isArray(data.history) || !data.history.length) fail('history 为空或不是数组');
  if (!DATE_RE.test(String(data.snapshot))) fail(`snapshot 日期格式异常：${data.snapshot}`);
  if (!data.source || !data.sourceNote) fail('缺少 source / sourceNote');
  if (data.modelCount !== data.models.length) {
    fail(`modelCount(${data.modelCount}) 与 models 实际条数(${data.models.length}) 不一致`);
  }

  const ids = new Set();
  for (const m of data.models || []) {
    for (const f of ['id', 'name', 'vendor']) {
      if (!m[f]) fail(`模型缺少字段 ${f}：${JSON.stringify(m.id || m.name || m)}`);
    }
    for (const f of NUMERIC_FIELDS) {
      if (typeof m[f] !== 'number' || Number.isNaN(m[f])) {
        fail(`模型 ${m.id} 的 ${f} 不是有效数字：${JSON.stringify(m[f])}`);
      }
    }
    if (!Array.isArray(m.scenarios) || !m.scenarios.length) fail(`模型 ${m.id} 缺少适用场景`);
    if (m.releasedAt !== undefined && m.releasedAt !== '' && !DATE_RE.test(m.releasedAt)) {
      fail(`模型 ${m.id} 的 releasedAt 格式应为 YYYY-MM-DD：${m.releasedAt}`);
    }
    if (ids.has(m.id)) fail(`模型 id 重复：${m.id}`);
    ids.add(m.id);
  }

  // 排名应与热度倒序一致
  const sorted = [...(data.models || [])].sort((a, b) => b.usage - a.usage).map((m) => m.id);
  const actual = (data.models || []).map((m) => m.id);
  if (sorted.join() !== actual.join()) fail('models 未按 usage 倒序排列（rank 会与实际排名不符）');

  // 最新发布日期应与数据一致
  const newest = (data.models || []).filter((m) => m.releasedAt).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))[0];
  const declared = data.latestRelease?.releasedAt;
  if (newest && declared !== newest.releasedAt) {
    fail(`latestRelease.releasedAt(${declared}) 与数据中最新的 releasedAt(${newest.releasedAt}) 不一致`);
  }

  // 历史快照的最后一天应等于 snapshot
  const lastHistory = (data.history || []).at(-1);
  if (lastHistory && lastHistory.date !== data.snapshot) {
    fail(`history 最后一天(${lastHistory.date}) 与 snapshot(${data.snapshot}) 不一致`);
  }
}

// 前端挂载点
if (fs.existsSync(path.join(ROOT, 'index.html'))) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const HOOKS = ['stats', 'chart', 'rank-list', 'rank-head', 'scene-grid', 'latest-grid', 'detail-body', 'scene-filter', 'sort', 'search', 'trend-seg', 'snapshot'];
  for (const id of HOOKS) {
    if (!html.includes(`id="${id}"`)) fail(`index.html 缺少挂载点 #${id}`);
  }
  for (const asset of ['assets/css/style.css', 'assets/js/app.js']) {
    if (!html.includes(asset)) fail(`index.html 未引用 ${asset}`);
  }
}

// 前端脚本完整性
if (fs.existsSync(path.join(ROOT, 'assets/js/app.js'))) {
  const js = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
  for (const fn of ['renderStats', 'renderChart', 'renderRank', 'renderScenes', 'renderTable', 'renderLatest']) {
    if (!js.includes(`function ${fn}`)) fail(`app.js 缺少渲染函数 ${fn}`);
  }
}

if (errors.length) {
  console.error(`❌ 站点自检失败（${errors.length} 项）：`);
  errors.forEach((e) => console.error('  -', e));
  process.exit(1);
}
console.log(
  `✅ 站点自检通过｜模型 ${data.models.length} 个（含发布时间 ${data.models.filter((m) => m.releasedAt).length} 个）` +
    `｜历史 ${data.history.length} 天｜快照 ${data.snapshot}`,
);
