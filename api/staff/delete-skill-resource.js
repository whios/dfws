const staffRoles = new Set(['manager', 'brand_admin', 'ai_officer']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

function reply(response, status, body) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || '云端服务请求失败');
  return body;
}

function serviceHeaders() {
  return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
}

function storagePath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '成果删除服务尚未完成安全配置。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const ownProfile = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role`, { headers: serviceHeaders() });
    if (!staffRoles.has(ownProfile?.[0]?.role)) return reply(response, 403, { error: '当前账号没有删除成果的权限。' });

    const { resourceId } = request.body || {};
    if (!uuidPattern.test(resourceId || '')) return reply(response, 400, { error: '成果标识不合法。' });
    const resources = await supabaseFetch(`/rest/v1/skill_resources?id=eq.${encodeURIComponent(resourceId)}&select=id,file_path`, { headers: serviceHeaders() });
    const resource = resources?.[0];
    if (!resource) return reply(response, 404, { error: '成果不存在或已被删除。' });

    // 先移除下载明细，再删除成果；资产由数据库外键级联删除，通知保留为审核留痕。
    await supabaseFetch(`/rest/v1/skill_downloads?resource_id=eq.${encodeURIComponent(resourceId)}`, { method: 'DELETE', headers: serviceHeaders() });
    await supabaseFetch(`/rest/v1/skill_resources?id=eq.${encodeURIComponent(resourceId)}`, { method: 'DELETE', headers: { ...serviceHeaders(), Prefer: 'return=representation' } });

    let fileCleanupPending = false;
    if (resource.file_path) {
      try {
        await supabaseFetch(`/storage/v1/object/skill-files/${storagePath(resource.file_path)}`, { method: 'DELETE', headers: serviceHeaders() });
      } catch {
        fileCleanupPending = true;
      }
    }
    return reply(response, 200, { ok: true, fileCleanupPending });
  } catch (error) {
    const message = error?.message || '成果删除失败';
    console.error('Skill resource deletion failed', { name: error?.name, code: error?.code, message });
    return reply(response, 500, { error: message });
  }
}
