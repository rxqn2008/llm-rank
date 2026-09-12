/* 大模型热度排行 - 前端渲染逻辑（零依赖） */
(() => {
  'use strict';

  const DATA_URL = 'data/models.json';
  const BRAND_COLORS = ['#5b8cff', '#7d5bff', '#3ddc97', '#ffcb5c', '#ff6b81', '#55d6ff', '#b58cff', '#ff9f43'];
  const state = { data: null, trendDays: 7, keyword: '', scene: 'all', sort: 'usage', chartHidden: new Set() };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 1) => Number(n).toFixed(d);
  const NEW_WINDOW_DAYS = 120;
  const daysSince = (dateStr) => {
    if (!dateStr) return Infinity;
    const t = Date.parse(`${dateStr}T00:00:00Z`);
    return Number.isNaN(t) ? Infinity : Math.floor((Date.now() - t) / 86400000);
  };
  const isNew = (m) => daysSince(m.releasedAt) <= NEW_WINDOW_DAYS;
  const relTime = (dateStr) => {
    const days = daysSince(dateStr);
    if (!Number.isFinite(days)) return '';
    if (days <= 0) return '今天发布';
    if (days === 1) return '昨天发布';
    if (days < 30) return `${days} 天前发布`;
    if (days < 365) return `${Math.floor(days / 30)} 个月前发布`;
    return `${Math.floor(days / 365)} 年前发布`;
  };
  const num = (n) => Number(n).toLocaleString('zh-CN');
  const newestOf = (models) =>
    [...models]
      .filter((m) => m.releasedAt)
      .sort((a, b) => String(b.releasedAt).localeCompare(String(a.releasedAt)))[0];

  /* ---------------- 工具：历史数据 ---------------- */
  const historyMap = () => {
    const map = new Map();
    for (const snap of state.data.history || []) {
      for (const row of snap.usage || []) {
        if (!map.has(row.id)) map.set(row.id, []);
        map.get(row.id).push({ date: snap.date, heat: row.heat });
      }
    }
    return map;
  };

  const deltaOf = (id) => {
    const series = historyMap().get(id) || [];
    if (series.length < 2) return 0;
    const last = series[series.length - 1].heat;
    const prev = series[Math.max(0, series.length - 1 - state.trendDays)].heat;
    return prev ? ((last - prev) / prev) * 100 : 0;
  };

  /* ---------------- 概览指标 ---------------- */
  function renderStats() {
    const models = state.data.models;
    const newest = newestOf(models);
    const avgScore = models.reduce((s, m) => s + m.score, 0) / (models.length || 1);
    const avgWin = models.reduce((s, m) => s + m.winRate, 0) / (models.length || 1);
    const topGainer = [...models].sort((a, b) => deltaOf(b.id) - deltaOf(a.id))[0];
    const gain = topGainer ? deltaOf(topGainer.id) : 0;

    const cards = [
      { k: '收录模型', v: num(models.length), u: '个', s: `覆盖 ${new Set(models.map((m) => m.vendor)).size} 家厂商` },
      { k: '平均综合评分', v: fmt(avgScore, 1), u: '/100', s: `平均胜率 ${fmt(avgWin, 1)}%` },
      { k: '榜首模型', v: models[0]?.name?.split(' ')[0] || '—', u: '', s: `热度指数 ${fmt(models[0]?.usage ?? 0, 1)}` },
      { k: `近 ${state.trendDays} 天涨幅王`, v: topGainer ? topGainer.name.split(' ')[0] : '—', u: '', s: gain >= 0 ? `+${fmt(gain, 1)}%` : `${fmt(gain, 1)}%` },
      { k: '最新发布', v: newest ? newest.name.split(' ')[0] : '—', u: '', s: newest ? `${newest.releasedAt}｜${relTime(newest.releasedAt)}` : '暂无发布时间数据' },
    ];

    $('#stats').innerHTML = cards
      .map(
        (c) => `<div class="stat">
          <div class="k">${esc(c.k)}</div>
          <div class="v">${esc(c.v)}${c.u ? `<small>${esc(c.u)}</small>` : ''}</div>
          <div class="s">${esc(c.s)}</div>
        </div>`,
      )
      .join('');
  }

  /* ---------------- 热度趋势图（自绘 SVG） ---------------- */
  function renderChart() {
    const history = (state.data.history || []).slice(-state.trendDays * 2);
    const wrap = $('#chart');
    if (history.length < 2) {
      wrap.innerHTML = '<div class="empty-tip">历史数据不足，明日更新后将展示趋势曲线</div>';
      return;
    }

    // 取当前榜单 Top 6 模型绘制
    const top = state.data.models.slice(0, 6);
    const W = 1000;
    const H = 320;
    const PAD = { l: 46, r: 18, t: 18, b: 30 };
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;

    const values = [];
    for (const s of history) for (const row of s.usage || []) {
      if (top.some((m) => m.id === row.id)) values.push(row.heat);
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    const padY = Math.max((max - min) * 0.15, 2);
    min = Math.floor(min - padY);
    max = Math.ceil(max + padY);

    const x = (i) => PAD.l + (history.length === 1 ? iw / 2 : (i / (history.length - 1)) * iw);
    const y = (v) => PAD.t + ih - ((v - min) / (max - min || 1)) * ih;

    const grid = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = min + ((max - min) / steps) * i;
      const gy = y(v);
      grid.push(`<line class="grid-line" x1="${PAD.l}" y1="${gy.toFixed(1)}" x2="${W - PAD.r}" y2="${gy.toFixed(1)}" />`);
      grid.push(`<text class="axis-text" x="${PAD.l - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end">${fmt(v, 0)}</text>`);
    }
    const xLabels = history.map((s, i) => {
      const show = i === 0 || i === history.length - 1 || i % Math.ceil(history.length / 6) === 0;
      return show ? `<text class="axis-text" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(s.date.slice(5))}</text>` : '';
    });

    const lines = top.map((m, idx) => {
      const color = BRAND_COLORS[idx % BRAND_COLORS.length];
      const pts = history
        .map((s, i) => {
          const row = (s.usage || []).find((r) => r.id === m.id);
          return row ? { x: x(i), y: y(row.heat) } : null;
        })
        .filter(Boolean);
      if (!pts.length) return '';
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const hidden = state.chartHidden.has(m.id) ? 'opacity:.12' : '';
      return `<g style="${hidden}">
        <path class="line-path" stroke="${color}" d="${d}" />
        ${pts.map((p) => `<circle class="line-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" fill="${color}" />`).join('')}
      </g>`;
    });

    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="模型热度趋势">
      ${grid.join('')}${xLabels.join('')}${lines.join('')}
    </svg>
    <div class="legend">${top
      .map((m, idx) => {
        const color = BRAND_COLORS[idx % BRAND_COLORS.length];
        return `<button class="legend-item ${state.chartHidden.has(m.id) ? 'muted' : ''}" data-toggle="${esc(m.id)}">
          <span class="swatch" style="background:${color}"></span>${esc(m.name)}
        </button>`;
      })
      .join('')}</div>`;

    wrap.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggle;
        state.chartHidden.has(id) ? state.chartHidden.delete(id) : state.chartHidden.add(id);
        renderChart();
      });
    });
  }

  /* ---------------- 最新发布 ---------------- */
  function renderLatest() {
    const list = [...state.data.models]
      .filter((m) => m.releasedAt)
      .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))
      .slice(0, 8);

    if (!list.length) {
      $('#latest-grid').innerHTML =
        '<div class="empty-tip">暂无发布时间数据，联网更新后会自动展示（部分外部数据源不提供发布时间）</div>';
      return;
    }

    $('#latest-grid').innerHTML = list
      .map(
        (m, i) => `<div class="latest-card${i === 0 ? ' fresh' : ''}">
          <div class="latest-top">
            <span class="latest-date">${esc(m.releasedAt)}</span>
            ${isNew(m) ? '<span class="tag-new">NEW</span>' : ''}
          </div>
          <div class="latest-name">${esc(m.name)}</div>
          <div class="latest-vendor">${esc(m.vendor)} · 榜单第 ${m.rank} 名</div>
          <div class="latest-rel">${esc(relTime(m.releasedAt))}</div>
          <div class="latest-meta">
            <span class="score-pill ${scoreClass(m.score)}">评分 ${fmt(m.score, 1)}</span>
            <span class="tag-scene">${num(m.context)}K 上下文</span>
            <span class="tag-scene">$${fmt(m.price, 2)}/M</span>
          </div>
        </div>`,
      )
      .join('');
  }

  /* ---------------- 排行列表 ---------------- */
  function scoreClass(v) {
    return v >= 85 ? '' : v >= 70 ? 'mid' : 'low';
  }

  function filtered() {
    let list = [...state.data.models];
    const kw = state.keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(kw) ||
          m.vendor.toLowerCase().includes(kw) ||
          (m.scenarios || []).join(' ').toLowerCase().includes(kw),
      );
    }
    if (state.scene !== 'all') list = list.filter((m) => (m.scenarios || []).includes(state.scene));

    const cmp = {
      usage: (a, b) => b.usage - a.usage,
      score: (a, b) => b.score - a.score,
      winRate: (a, b) => b.winRate - a.winRate,
      calls: (a, b) => b.calls - a.calls,
      trend: (a, b) => deltaOf(b.id) - deltaOf(a.id),
      value: (a, b) => b.usage / (b.price || 0.01) - a.usage / (a.price || 0.01),
      newest: (a, b) => String(b.releasedAt || '').localeCompare(String(a.releasedAt || '')),
    }[state.sort];
    return list.sort(cmp);
  }

  function renderRank() {
    const list = filtered();
    if (!list.length) {
      $('#rank-head').style.display = 'none';
      $('#rank-list').innerHTML = '<div class="empty-tip">没有匹配的模型，换个关键词或场景试试</div>';
      return;
    }
    $('#rank-head').style.display = 'grid';

    $('#rank-list').innerHTML = list
      .map((m) => {
        const d = deltaOf(m.id);
        const deltaCls = d > 0.05 ? 'up' : d < -0.05 ? 'down' : '';
        const deltaTxt = `${d > 0 ? '▲' : d < 0 ? '▼' : '—'} ${Math.abs(d) ? fmt(Math.abs(d), 1) + '%' : ''}`;
        const top3 = m.rank <= 3 ? `top${m.rank}` : '';
        return `<div class="rank-row">
          <div class="rank-no ${top3}">${m.rank}</div>
          <div>
            <div class="m-name">${esc(m.name)}${isNew(m) ? '<span class="tag-new">NEW</span>' : ''}${m.price <= 0.5 ? '<span class="tag-scene">高性价比</span>' : ''}</div>
            <div class="m-vendor">${esc(m.vendor)} · 上下文 ${num(m.context)}K${m.releasedAt ? ` · ${esc(m.releasedAt)} 发布` : ''}</div>
          </div>
          <div class="bar-wrap col-calls">
            <div class="bar"><i style="width:${Math.min(100, (m.calls / 12) * 100).toFixed(1)}%"></i></div>
            <div class="num">日均调用 ${fmt(m.calls, 1)} 亿次</div>
          </div>
          <div class="col-scene">
            ${(m.scenarios || []).slice(0, 2).map((s) => `<span class="tag-scene">${esc(s)}</span>`).join('') || '<span class="m-vendor">—</span>'}
          </div>
          <div class="col-win"><span class="score-pill ${scoreClass(m.winRate)}">${fmt(m.winRate, 1)}%</span></div>
          <div><span class="score-pill ${scoreClass(m.score)}">${fmt(m.score, 1)}</span></div>
          <div class="delta ${deltaCls}">${deltaTxt}</div>
        </div>`;
      })
      .join('');
  }

  /* ---------------- 场景矩阵 ---------------- */
  function renderScenes() {
    const bucket = new Map();
    for (const m of state.data.models) {
      for (const s of m.scenarios || []) {
        if (!bucket.has(s)) bucket.set(s, []);
        bucket.get(s).push(m);
      }
    }
    const items = [...bucket.entries()]
      .map(([scene, list]) => [scene, list.sort((a, b) => b.usage - a.usage)])
      .sort((a, b) => b[1].length - a[1].length);

    $('#scene-grid').innerHTML = items
      .map(
        ([scene, list]) => `<div class="scene-card">
          <h3>${esc(scene)}</h3>
          <div class="count">${list.length} 个模型可胜任</div>
          <ol>${list.slice(0, 3).map((m) => `<li><b>${esc(m.name)}</b> · ${fmt(m.score, 1)} 分</li>`).join('')}</ol>
        </div>`,
      )
      .join('');

    const options = ['<option value="all">全部场景</option>']
      .concat(items.map(([s, l]) => `<option value="${esc(s)}">${esc(s)} (${l.length})</option>`))
      .join('');
    const sel = $('#scene-filter');
    sel.innerHTML = options;
    sel.addEventListener('change', () => {
      state.scene = sel.value;
      renderRank();
    });
  }

  /* ---------------- 明细表 ---------------- */
  function renderTable() {
    const list = filtered();
    $('#detail-body').innerHTML = list
      .map(
        (m) => `<tr>
          <td>${m.rank}</td>
          <td><b>${esc(m.name)}</b></td>
          <td>${esc(m.vendor)}</td>
          <td class="cell-nowrap">${m.releasedAt ? esc(m.releasedAt) : '<span class="m-vendor">—</span>'}</td>
          <td>${fmt(m.usage, 1)}</td>
          <td>${fmt(m.score, 1)}</td>
          <td>${fmt(m.winRate, 1)}%</td>
          <td>${num(m.context)}K</td>
          <td>$${fmt(m.price, 2)}</td>
          <td class="cell-wrap">${(m.scenarios || []).map((s) => `<span class="tag-scene">${esc(s)}</span>`).join(' ')}</td>
          <td class="cell-wrap">${esc(m.summary)}</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="11" class="empty-tip">没有匹配的模型</td></tr>';
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('#search').addEventListener('input', (e) => {
      state.keyword = e.target.value;
      renderRank();
      renderTable();
    });

    $('#sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderRank();
      renderTable();
    });

    document.querySelectorAll('#trend-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#trend-seg button').forEach((b) => b.classList.toggle('active', b === btn));
        state.trendDays = Number(btn.dataset.days);
        renderStats();
        renderRank();
        renderChart();
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
      state.data.models.sort((a, b) => b.usage - a.usage);
    } catch (err) {
      document.querySelectorAll('section.block, .stats').forEach((el) => (el.style.display = 'none'));
      $('#load-error').style.display = 'block';
      $('#load-error').textContent = `数据加载失败：${err.message}。若直接双击打开 index.html，请改用本地服务，例如在 llm-rank 目录执行 python3 -m http.server 8080`;
      return;
    }

    const d = state.data;
    const latest = newestOf(d.models);
    $('#snapshot').textContent = latest
      ? `数据快照 ${d.snapshot}｜最新 ${latest.name}`
      : `数据快照 ${d.snapshot}`;
    $('#footer-meta').textContent = `数据快照：${d.snapshot}｜来源：${d.source}｜${d.sourceNote || ''}`;
    $('#source-note').textContent = d.sourceNote || '';
    if (d.updatedAt) $('#updated').textContent = new Date(d.updatedAt).toLocaleString('zh-CN');

    renderStats();
    renderLatest();
    renderScenes();
    renderRank();
    renderTable();
    renderChart();
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
