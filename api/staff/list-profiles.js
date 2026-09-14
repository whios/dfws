const staffRoles = new Set(['manager', 'ai_officer']);

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

export default async function handler(request, response) {
  if (request.method !== 'GET') return reply(response, 405, { error: '仅支持读取人员账号。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '人员服务尚未完成安全配置。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后查看人员权限。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const actorRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role`, { headers: serviceHeaders() });
    if (!staffRoles.has(actorRows?.[0]?.role)) return reply(response, 403, { error: '当前账号没有人员权限管理权限。' });

    const [profiles, partners] = await Promise.all([
      supabaseFetch('/rest/v1/profiles?select=id,email,display_name,role,partner_id,created_at&order=created_at.asc', { headers: serviceHeaders() }),
      supabaseFetch('/rest/v1/partners?select=id,owner_name,brand,department&order=brand.asc,owner_name.asc', { headers: serviceHeaders() })
    ]);
    return reply(response, 200, { profiles: profiles || [], partners: partners || [] });
  } catch (error) {
    return reply(response, 500, { error: error?.message || '人员账号加载失败。' });
  }
}
