import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import deleteSkillResource from './api/staff/delete-skill-resource.js';
import inviteMember from './api/staff/invite-member.js';
import sendSkillReviewEmail from './api/staff/send-skill-review-email.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const apiHandlers = new Map([
  ['/api/staff/delete-skill-resource', deleteSkillResource],
  ['/api/staff/invite-member', inviteMember],
  ['/api/staff/send-skill-review-email', sendSkillReviewEmail]
]);
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function responseAdapter(response) {
  return {
    status(code) { response.statusCode = code; return this; },
    setHeader(name, value) { response.setHeader(name, value); return this; },
    send(value) {
      if (!response.getHeader('Content-Type')) response.setHeader('Content-Type', typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
      response.end(typeof value === 'string' ? value : JSON.stringify(value));
    }
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('请求内容过大。');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('请求格式不合法。'); }
}

async function serveFile(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || path.basename(filePath).startsWith('.')) return sendJson(response, 404, { error: '未找到页面。' });
  const contentType = mimeTypes.get(path.extname(filePath));
  if (!contentType) return sendJson(response, 404, { error: '未找到页面。' });
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return sendJson(response, 404, { error: '未找到页面。' });
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300');
    if (request.method === 'HEAD') return response.end();
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: '未找到页面。' });
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/_health') return sendJson(response, 200, { ok: true });
  const handler = apiHandlers.get(url.pathname);
  if (handler) {
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.setHeader('Allow', 'POST, OPTIONS');
      return response.end();
    }
    try {
      request.body = await readBody(request);
      return await handler(request, responseAdapter(response));
    } catch (error) {
      return sendJson(response, error?.message === '请求内容过大。' ? 413 : 400, { error: error?.message || '请求处理失败。' });
    }
  }
  if (!['GET', 'HEAD'].includes(request.method || '')) return sendJson(response, 405, { error: '仅支持读取页面。' });
  return serveFile(request, response, decodeURIComponent(url.pathname));
}).listen(port, '127.0.0.1', () => {
  console.log(`DFWS server listening on 127.0.0.1:${port}`);
});
