#!/usr/bin/env node
/**
 * 大模型热度数据每日更新脚本
 *
 * 数据来源优先级：
 *   1. 环境变量 LLM_RANK_SOURCE   —— 自定义 JSON API 地址（返回 {models:[...]})
 *   2. OpenRouter 公开模型榜      —— https://openrouter.ai/api/v1/models
 *   3. 内置种子数据 + 确定性演算  —— 离线/网络异常时兜底，保证站点永不空白
 *
 * 用法：
 *   node scripts/update-data.mjs            # 常规更新
 *   node scripts/update-data.mjs --offline  # 强制离线演算（用于本地/CI 无网络）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../data/models.json');
const HISTORY_DAYS = 30;
const OFFLINE = process.argv.includes('--offline') || process.env.LLM_RANK_OFFLINE === '1';

const toId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = () => new Date().toISOString().slice(0, 10);
const round = (n, d = 2) => +Number(n).toFixed(d);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** 读取现有数据，作为兜底与增量基础 */
function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { snapshot: today(), models: [], history: [] };
  }
}

/** 把外部记录并入本地模型，缺失字段用估值补齐 */
function normalize(record, index, total) {
  const name = record.name || record.id;
  const usage = clamp(record.usage ?? 100 - index * 2, 0, 100);
  return {
    id: toId(record.id || name),
    name,
    vendor: record.vendor || 'Unknown',
    usage: round(usage, 1),
    score: round(record.score ?? clamp(60 + usage * 0.35, 0, 100), 1),
    winRate: round(record.winRate ?? clamp(usage * 0.75, 0, 100), 1),
    calls: round(record.calls ?? clamp(usage / 10, 0.1, 99), 1),
    context: record.context ?? 128,
    price: record.price ?? 0.5,
    scenarios: record.scenarios?.length ? record.scenarios : inferScenarios(record),
    summary: record.summary || '',
    homepage: record.homepage || '',
    rank: index + 1,
    share: round((usage / total) * 100, 2),
  };
}

/**
 * 场景自动推断：外部数据源通常不提供适用场景，
 * 依据厂商、模型名与价格/上下文特征补齐，保证场景矩阵不空白。
 */
const SCENARIO_RULES = [
  { tag: '通用对话', test: () => true },
  { tag: '代码生成', test: (m) => /code|coder|devstral|qwen|deepseek|gpt|claude|llama|glm|grok|gemini|mistral/i.test(m.name) },
  { tag: '复杂推理', test: (m) => /o[134]|r1|reason|thinking|qwq|gpt|claude|gemini|grok/i.test(m.name) && m.score >= 60 },
  { tag: '超长文档', test: (m) => m.context >= 200 },
  { tag: '高并发低成本', test: (m) => m.price <= 1 },
  { tag: '多模态理解', test: (m) => /vision|vl|image|gemini|gpt|claude/i.test(m.name) },
  { tag: '多语言翻译', test: (m) => /qwen|llama|mistral|gemini|command|glm/i.test(m.name) },
  { tag: '开源微调', test: (m) => /llama|mistral|qwen|deepseek|glm|yi|command/i.test(m.name) },
  { tag: '企业知识库', test: (m) => m.price <= 1.5 },
];

function inferScenarios(m) {
  const tags = SCENARIO_RULES.filter((r) => {
    try {
      return r.test(m);
    } catch {
      return false;
    }
  }).map((r) => r.tag);
  // 兜底：至少保证有 3 个场景，避免孤立标签
  const fallback = ['通用对话', '复杂推理', '企业知识库', '高并发低成本'];
  for (const f of fallback) {
    if (tags.length >= 3) break;
    if (!tags.includes(f)) tags.push(f);
  }
  return tags.slice(0, 6);
}

/** 数据源 1：自定义 API */
async function fetchCustom(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`custom source ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : json.models;
  if (!Array.isArray(list) || !list.length) throw new Error('custom source empty');
  return list.map((r, i) => ({
    ...r,
    vendor: r.vendor || r.author || 'Unknown',
    usage: r.usage ?? r.heat,
  }));
}

/** 数据源 2：OpenRouter 公开模型列表，按 token 定价与上下文估算热度 */
async function fetchOpenRouter() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const json = await res.json();
  const list = (json.data || []).filter((m) => m.id && m.pricing);
  if (!list.length) throw new Error('openrouter empty');

  // 以「上下文窗口 / 价格」作为热度代理指标并归一化到 40~100
  const scored = list.map((m) => {
    const ctx = m.context_length || 8192;
    const price = Number(m.pricing.prompt || 0) * 1e6;
    const ctxScore = Math.log10(ctx) / Math.log10(2_000_000);
    const priceScore = price > 0 ? clamp(1 - Math.log10(price + 1) / 2.2, 0, 1) : 0.6;
    return {
      name: m.name || m.id,
      vendor: (m.id.split('/')[0] || 'Unknown').replace(/^~/, ''),
      usage: clamp((ctxScore * 0.45 + priceScore * 0.55) * 100, 40, 100),
      score: clamp((ctxScore * 0.5 + priceScore * 0.5) * 100, 40, 100),
      winRate: clamp(priceScore * 100, 30, 100),
      calls: clamp(Math.log10(ctx), 1, 9),
      context: Math.round(ctx / 1024),
      price: round(price, 2),
      homepage: m.id.startsWith('~') ? '' : `https://openrouter.ai/${m.id}`,
    };
  });
  scored.sort((a, b) => b.usage - a.usage);
  return scored.slice(0, 30);
}

/**
 * 数据源 3：基于现有数据做确定性日演算（离线可用、结果可复现）
 * 在昨日热度上叠加小幅确定性波动，保证日环比变化在 ±3% 以内的真实量级。
 */
function evolveOffline(existing) {
  const seed = Number(today().replace(/-/g, '')) % 997;
  const weekend = [0, 6].includes(new Date().getUTCDay()) ? -1.2 : 0;
  const n = Math.max(1, existing.models.length);

  // 先按当前热度排序，再自高到低生成新值：
  // 每个模型的新值被约束在「上一名新值 - 最小间隔」之下，保证名次不会因波动互换
  const ordered = existing.models
    .map((m, i) => ({ m, i, usage: m.usage || 50 }))
    .sort((a, b) => b.usage - a.usage);

  const MIN_GAP = 0.35;
  const evolved = new Map();
  let upperBound = 101;
  for (let k = 0; k < ordered.length; k++) {
    const { m, i } = ordered[k];
    const rankWeight = 1 - k / n; // 越靠前波动越小
    const wave =
      (Math.sin(seed * 0.37 + i * 1.31) * 0.9 + Math.cos(seed * 0.11 + i * 0.7) * 0.6) *
      (0.7 + rankWeight * 0.6);
    const next = clamp(m.usage + wave + weekend, 20, 100);
    const bounded = Math.min(next, upperBound - MIN_GAP);
    evolved.set(m.id, +bounded.toFixed(2));
    upperBound = bounded;
  }
  return existing.models.map((m) => ({ ...m, usage: evolved.get(m.id) }));
}

async function main() {
  const existing = readExisting();
  let records = null;
  let source = 'seed-evolve';
  let sourceNote = '离线演算数据（未连通外部数据源），用于保证站点每日仍有更新';
  let raw = existing.models;

  if (!OFFLINE) {
    const custom = process.env.LLM_RANK_SOURCE;
    try {
      records = custom ? await fetchCustom(custom) : await fetchOpenRouter();
      source = custom ? 'custom-api' : 'openrouter';
      sourceNote = custom ? `来自自定义数据源 ${custom}` : '基于 OpenRouter 公开模型列表估算';
    } catch (err) {
      console.warn(`[warn] 外部数据源不可用：${err.message}，回退到离线演算`);
    }
  }

  if (records) {
    // 外部数据只替换同名模型的关键指标，保留本地人工维护的场景与简介
    const localMap = new Map(existing.models.map((m) => [toId(m.name), m]));
    raw = records.map((r) => {
      const local = localMap.get(toId(r.name || r.id));
      return local ? { ...local, ...r, id: local.id, scenarios: r.scenarios?.length ? r.scenarios : local.scenarios } : r;
    });
  } else {
    raw = evolveOffline(existing);
  }

  const total = raw.reduce((s, m) => s + (m.usage || 0), 0) || 1;
  const models = raw
    .map((m, i) => normalize(m, i, total))
    .sort((a, b) => b.usage - a.usage)
    .map((m, i) => ({ ...m, rank: i + 1, share: round((m.usage / total) * 100, 2) }));

  const day = today();
  const usageRows = models.map((m) => ({ id: m.id, heat: m.usage }));
  const history = [...(existing.history || []).filter((h) => h.date !== day), { date: day, usage: usageRows }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_DAYS);

  const out = {
    snapshot: day,
    updatedAt: new Date().toISOString(),
    source,
    sourceNote,
    modelCount: models.length,
    models,
    history,
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[ok] ${day} 已更新 ${models.length} 个模型，数据源：${source}，历史 ${history.length} 天`);
}

main().catch((err) => {
  console.error('[fail]', err);
  process.exit(1);
});
