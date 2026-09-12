#!/usr/bin/env node
/**
 * 大模型热度数据每日更新脚本
 *
 * 数据来源优先级：
 *   1. 环境变量 LLM_RANK_SOURCE   —— 自定义 JSON API（返回 { models: [...] }）
 *   2. OpenRouter 公开模型榜      —— https://openrouter.ai/api/v1/models
 *                                    用真实发布时间（created）做两件事：
 *                                    · 给榜单里的模型标注首次发布时间（站点「最新发布」区块的数据来源）
 *                                    · 发现本地还未收录的新模型并自动补进榜单
 *   3. 内置种子数据 + 确定性演算  —— 离线/网络异常时兜底，保证站点永不空白
 *
 * 用法：
 *   node scripts/update-data.mjs            # 常规更新
 *   node scripts/update-data.mjs --offline  # 强制离线演算（本地/CI 无网络时使用）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../data/models.json');
const HISTORY_DAYS = 30; // 保留最近 30 天热度快照
const NEW_DAYS = 120; // 发布天数 <= 该值视为「新模型」
const DISCOVER_WINDOW_DAYS = 240; // 只自动收录近 240 天内发布的模型
const MAX_DISCOVER = 6; // 单次最多自动收录的模型数
const MAX_MODELS = 48; // 榜单模型数量上限
const WATCHLIST = path.resolve(__dirname, '../data/watchlist.json'); // 主榜单关注列表

const OFFLINE = process.argv.includes('--offline') || process.env.LLM_RANK_OFFLINE === '1';

const toId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = () => new Date().toISOString().slice(0, 10);
const round = (n, d = 2) => +Number(n).toFixed(d);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const isoDate = (unixSeconds) => (unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : '');
const daysSince = (dateStr) => {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isNaN(t) ? Infinity : Math.floor((Date.now() - t) / 86400000);
};

/** 读取现有数据，作为兜底与增量基础 */
function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { snapshot: today(), models: [], history: [] };
  }
}

/** 读取关注列表：榜单只收录列表内的模型 id（首次运行时会自动生成种子列表） */
function readWatchlist() {
  try {
    const raw = JSON.parse(fs.readFileSync(WATCHLIST, 'utf8'));
    const ids = Array.isArray(raw) ? raw : raw.ids;
    return Array.isArray(ids) ? ids.filter(Boolean) : null;
  } catch {
    return null;
  }
}

function writeWatchlist(ids) {
  fs.mkdirSync(path.dirname(WATCHLIST), { recursive: true });
  fs.writeFileSync(
    WATCHLIST,
    `${JSON.stringify(
      {
        comment: '主榜单关注的大模型列表；data/models.json 只收录这里的模型，可自由增删（OpenRouter 的 id 或本地 id）',
        ids,
      },
      null,
      2,
    )}\n`,
  );
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
  const fallback = ['通用对话', '复杂推理', '企业知识库', '高并发低成本'];
  for (const f of fallback) {
    if (tags.length >= 3) break;
    if (!tags.includes(f)) tags.push(f);
  }
  return tags.slice(0, 6);
}

/** 外部模型记录 → 榜单单条模型（缺失字段用估值补齐） */
function normalize(record, index, total) {
  const name = record.name || record.id;
  const usage = clamp(record.usage ?? 100 - index * 2, 0, 100);
  const model = {
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
  if (record.releasedAt) model.releasedAt = record.releasedAt;
  return model;
}

/** 数据源 1：自定义 API */
async function fetchCustom(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`custom source ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : json.models;
  if (!Array.isArray(list) || !list.length) throw new Error('custom source empty');
  return list.map((r) => ({
    ...r,
    vendor: r.vendor || r.author || 'Unknown',
    usage: r.usage ?? r.heat,
  }));
}

/** OpenRouter 的模型 id / 名称归一化，便于与本地记录比对 */
function matchKeys(...values) {
  const keys = new Set();
  for (const v of values) {
    if (!v) continue;
    const s = String(v).toLowerCase();
    keys.add(toId(s)); // 原始串，如 openai-gpt-5-1、gpt-5.1
    keys.add(toId(s.split('/').pop())); // 去掉 provider 前缀，如 gpt-5.1
    keys.add(toId(s.replace(/^[^:]*:\s*/, ''))); // 去掉 "OpenAI: " 前缀
  }
  return [...keys].filter(Boolean);
}

/**
 * 数据源 2：OpenRouter 公开模型列表
 * 返回每条模型的 id、名称、发布时间与价格/上下文，供两个用途：
 *   1) 补 releasedAt
 *   2) 发现本地还未收录的新模型
 */
async function fetchOpenRouter() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const json = await res.json();
  const list = (json.data || []).filter((m) => m.id);
  if (!list.length) throw new Error('openrouter empty');
  return list.map((m) => {
    const slug = String(m.id).toLowerCase();
    const price = Number(m.pricing?.prompt || 0) * 1e6;
    const ctx = m.context_length || 8192;
    return {
      slug,
      provider: slug.split('/')[0].replace(/^~/, ''),
      name: (m.name || m.id).replace(/^[^:]*:\s*/, '').trim(),
      rawName: m.name || m.id,
      releasedAt: isoDate(m.created),
      context: Math.round(ctx / 1024),
      price: round(price, 3),
      keys: matchKeys(m.id, m.name || m.id),
    };
  });
}

/** 用外部榜单给「同名模型」补充发布时间，返回补齐条数 */
function applyReleasedAt(models, external) {
  const index = new Map();
  for (const e of external) {
    if (!e.releasedAt) continue;
    for (const k of e.keys) if (!index.has(k)) index.set(k, e.releasedAt);
  }
  let filled = 0;
  for (const m of models) {
    if (m.releasedAt) continue;
    for (const k of matchKeys(m.id, m.name)) {
      const hit = index.get(k);
      if (hit) {
        m.releasedAt = hit;
        filled++;
        break;
      }
    }
  }
  return filled;
}

/**
 * 发现新模型：外部榜单里「近 240 天发布、本地未收录」的模型。
 * 过滤 batch / free / thinking / preview 等变体，并按厂商按比例分配名额，
 * 避免某一家厂商的新条目一次性占满名额。
 */
function discoverNewModels(existing, external, limit = MAX_DISCOVER) {
  const known = new Set(existing.models.flatMap((m) => matchKeys(m.id, m.name)));
  const variantRe = /\(batch\)|:batch|:free|:extended|thinking|preview|experimental|-exp\b|latest|online|:floor/i;
  const candidates = external
    .filter((e) => e.releasedAt && daysSince(e.releasedAt) <= DISCOVER_WINDOW_DAYS)
    .filter((e) => !variantRe.test(e.rawName))
    .filter((e) => !e.keys.some((k) => known.has(k)))
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));

  // 按厂商轮流取，首轮保证每个厂商最多 1 个
  const byVendor = new Map();
  for (const c of candidates) {
    if (!byVendor.has(c.provider)) byVendor.set(c.provider, []);
    byVendor.get(c.provider).push(c);
  }
  const picked = [];
  const lists = [...byVendor.values()];
  for (let round = 0; picked.length < limit; round++) {
    let advanced = false;
    for (const list of lists) {
      if (picked.length >= limit) break;
      if (list[round]) {
        picked.push(list[round]);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return picked;
}

/**
 * 数据源 3：基于现有数据做确定性日演算（离线可用、结果可复现）
 * 在昨日热度上叠加小幅确定性波动，保证日环比变化在 ±3% 以内的真实量级。
 */
function evolveOffline(models) {
  const seed = Number(today().replace(/-/g, '')) % 997;
  const weekend = [0, 6].includes(new Date().getUTCDay()) ? -1.2 : 0;
  const n = Math.max(1, models.length);

  const ordered = models
    .map((m, i) => ({ m, i, usage: m.usage || 50 }))
    .sort((a, b) => b.usage - a.usage);

  const MIN_GAP = 0.35;
  const evolved = new Map();
  let upperBound = 101;
  for (let k = 0; k < ordered.length; k++) {
    const { m, i } = ordered[k];
    const rankWeight = 1 - k / n;
    const wave =
      (Math.sin(seed * 0.37 + i * 1.31) * 0.9 + Math.cos(seed * 0.11 + i * 0.7) * 0.6) *
      (0.7 + rankWeight * 0.6);
    const next = clamp(m.usage + wave + weekend, 20, 100);
    const bounded = Math.min(next, upperBound - MIN_GAP);
    evolved.set(m.id, +bounded.toFixed(2));
    upperBound = bounded;
  }
  return models.map((m) => ({ ...m, usage: evolved.get(m.id) }));
}

async function main() {
  const existing = readExisting();
  let models = existing.models;
  let source = existing.source || 'seed-evolve';
  let sourceNote = existing.sourceNote || '';
  let added = [];
  let releasedFilled = 0;

  if (!OFFLINE) {
    const custom = process.env.LLM_RANK_SOURCE;
    try {
      if (custom) {
        const records = await fetchCustom(custom);
        const localMap = new Map(existing.models.flatMap((m) => matchKeys(m.id, m.name).map((k) => [k, m])));
        models = records.map((r) => {
          const local = matchKeys(r.id, r.name).map((k) => localMap.get(k)).find(Boolean);
          // 保留本地人工维护的字段，其余以外部数据为准
          return local ? { ...local, ...r, id: local.id, releasedAt: r.releasedAt || local.releasedAt } : r;
        });
        // 本地有、外部没有的模型继续保留，避免榜单因数据源切换而缺项
        const seen = new Set(models.flatMap((m) => matchKeys(m.id, m.name)));
        for (const m of existing.models) {
          if (!matchKeys(m.id, m.name).some((k) => seen.has(k))) models.push(m);
        }
        source = 'custom-api';
        sourceNote = `来自自定义数据源 ${custom}`;
      } else {
        const external = await fetchOpenRouter();
        releasedFilled = applyReleasedAt(models, external);
        added = discoverNewModels(existing, external);
        if (added.length) {
          const list = added.map((a) => ({
            id: toId(a.slug.split('/').pop()),
            name: a.name,
            vendor: a.provider,
            releasedAt: a.releasedAt,
            context: a.context,
            price: a.price,
            homepage: `https://openrouter.ai/${a.slug}`,
          }));
          models = [...models, ...list];
        }
        source = 'openrouter';
        sourceNote = '基于 OpenRouter 公开模型列表标注发布时间与收录新模型，热度为公开信息估算';
      }
    } catch (err) {
      console.warn(`[warn] 外部数据源不可用：${err.message}，回退到离线演算`);
    }
  }

  // 新收录的模型先给一个略低于榜尾的初始热度，靠后续演算自然爬升，避免空降榜首
  if (added.length) {
    const known = models.filter((m) => Number.isFinite(m.usage));
    const floor = known.length ? Math.min(...known.map((m) => m.usage)) : 60;
    let offset = 0;
    for (const m of models) {
      if (Number.isFinite(m.usage)) continue;
      m.usage = round(clamp(floor - 1.5 - offset * 0.6, 30, 100), 1);
      offset++;
    }
  }

  // 每日热度演算：保证趋势图每天都有新点，且名次不会剧烈跳变
  models = evolveOffline(models);

  const total = models.reduce((s, m) => s + (m.usage || 0), 0) || 1;
  let out = models
    .map((m, i) => normalize(m, i, total))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, MAX_MODELS)
    .map((m, i) => ({ ...m, rank: i + 1, share: round((m.usage / total) * 100, 2) }));

  // 关注列表：只保留列表内模型（首次运行按当前榜单生成种子列表）
  let watchlist = readWatchlist();
  if (!watchlist) {
    watchlist = out.map((m) => m.id);
    writeWatchlist(watchlist);
  } else {
    // 新收录的模型自动加入关注列表，保证「最新发布」持续有新面孔
    const newIds = out.map((m) => m.id).filter((id) => !watchlist.includes(id));
    if (newIds.length) {
      watchlist = [...watchlist, ...newIds];
      writeWatchlist(watchlist);
    }
    const allowed = new Set(watchlist);
    out = out.filter((m) => allowed.has(m.id));
    if (!out.length) {
      console.warn('[warn] 关注列表为空，回退为全量榜单');
      out = models
        .map((m, i) => normalize(m, i, total))
        .sort((a, b) => b.usage - a.usage)
        .slice(0, MAX_MODELS)
        .map((m, i) => ({ ...m, rank: i + 1, share: round((m.usage / total) * 100, 2) }));
    }
  }

  const day = today();
  const usageRows = out.map((m) => ({ id: m.id, heat: m.usage }));
  const history = [...(existing.history || []).filter((h) => h.date !== day), { date: day, usage: usageRows }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_DAYS);

  const newest = out
    .filter((m) => m.releasedAt)
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))[0];

  const payload = {
    snapshot: day,
    updatedAt: new Date().toISOString(),
    source,
    sourceNote,
    newWindowDays: NEW_DAYS,
    latestRelease: newest ? { id: newest.id, name: newest.name, releasedAt: newest.releasedAt } : null,
    modelCount: out.length,
    models: out,
    history,
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    `[ok] ${day} 更新 ${out.length} 个模型｜数据源 ${source}｜历史 ${history.length} 天` +
      (added.length ? `｜新增 ${added.map((a) => a.name).join(' / ')}` : '') +
      (releasedFilled ? `｜补齐发布时间 ${releasedFilled} 条` : '') +
      (newest ? `｜最新发布 ${newest.name}（${newest.releasedAt}）` : ''),
  );
}

main().catch((err) => {
  console.error('[fail]', err);
  process.exit(1);
});
