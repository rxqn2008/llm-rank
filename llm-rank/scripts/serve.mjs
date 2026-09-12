#!/usr/bin/env node
/**
 * 极简静态站点服务器（零依赖）
 *
 * 用途：
 *   1) 本地预览：node llm-rank/scripts/serve.mjs
 *   2) CNB「云原生开发 · 仅预览模式」：由 .cnb.yml 的 launch 调起，
 *      服务监听 8686 端口，平台会自动打开预览页面
 *
 * 之所以需要它：站点用 fetch 读取 data/models.json，
 * 直接双击 index.html 会被浏览器同源策略拦截，必须通过 HTTP 访问。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8686);
const HOST = process.env.HOST || '0.0.0.0'; // 必须 0.0.0.0，否则容器外访问不到

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  // 阻止路径穿越
  let target = path.normalize(path.join(ROOT, urlPath));
  if (!target.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  let stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (stat?.isDirectory()) {
    target = path.join(target, 'index.html');
    stat = fs.existsSync(target) ? fs.statSync(target) : null;
  }
  // 目录式访问无 index.html 时，回退到站点入口
  if (!stat) {
    const fallback = path.join(ROOT, 'index.html');
    if (fs.existsSync(fallback)) {
      target = fallback;
      stat = fs.statSync(target);
    }
  }
  if (!stat?.isFile()) return send(res, 404, 'Not Found');

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.json' ? 'no-store' : 'no-cache',
  });
  fs.createReadStream(target)
    .on('error', () => send(res, 500, 'Internal Server Error'))
    .pipe(res);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`🔥 大模型热度排行站点已启动：http://${shown}:${PORT}`);
  console.log(`   站点根目录：${ROOT}`);
});
