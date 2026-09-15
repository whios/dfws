const allowedRoles = new Set(['manager', 'brand_admin', 'ai_officer', 'leader']);
const brands = ['迈点', '最佳东方', '乔邦', '先之', '技术中心', '职能'];

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
  if (request.method !== 'GET') return reply(response, 405, { error: '仅支持读取品牌审核进度。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '品牌进度服务尚未完成安全配置。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后查看品牌审核进度。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const actorRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role`, { headers: serviceHeaders() });
    if (!allowedRoles.has(actorRows?.[0]?.role)) return reply(response, 403, { error: '当前账号没有查看品牌审核进度的权限。' });
    const [resources, partners] = await Promise.all([
      supabaseFetch('/rest/v1/skill_resources?select=partner_id,status', { headers: serviceHeaders() }),
      supabaseFetch('/rest/v1/partners?select=id,brand', { headers: serviceHeaders() })
    ]);
    const brandByPartner = new Map((partners || []).map((partner) => [partner.id, partner.brand]));
    const totals = new Map(brands.map((brand) => [brand, { brand, total: 0, reviewed: 0 }]));
    (resources || []).forEach((resource) => {
      const row = totals.get(brandByPartner.get(resource.partner_id));
      if (!row) return;
      row.total += 1;
      if (resource.status !== 'pending') row.reviewed += 1;
    });
    return reply(response, 200, { brands: brands.map((brand) => totals.get(brand)) });
  } catch (error) {
    return reply(response, 500, { error: error?.message || '品牌审核进度加载失败。' });
  }
}
