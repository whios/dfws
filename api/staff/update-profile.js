const allowedRoles = new Set(['partner', 'manager', 'brand_admin', 'ai_officer', 'leader']);
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

async function profileWithBrand(id) {
  const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,role,partner_id`, { headers: serviceHeaders() });
  const profile = profiles?.[0];
  if (!profile) return null;
  if (!profile.partner_id) return { ...profile, brand: null };
  const partners = await supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(profile.partner_id)}&select=brand`, { headers: serviceHeaders() });
  return { ...profile, brand: partners?.[0]?.brand || null };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '人员服务尚未完成安全配置，请联系系统管理员。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const actor = await profileWithBrand(currentUser.id);
    if (!staffRoles.has(actor?.role)) return reply(response, 403, { error: '当前账号没有人员权限管理权限。' });

    const { profileId, role, partnerId } = request.body || {};
    if (!uuidPattern.test(profileId || '') || !allowedRoles.has(role)) return reply(response, 400, { error: '账号或角色信息无效。' });
    if (partnerId && !uuidPattern.test(partnerId)) return reply(response, 400, { error: '伙伴档案信息无效。' });

    const target = await profileWithBrand(profileId);
    if (!target) return reply(response, 404, { error: '账号不存在或已删除。' });
    let targetBrand = null;
    if (partnerId) {
      const partners = await supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}&select=brand`, { headers: serviceHeaders() });
      targetBrand = partners?.[0]?.brand || null;
      if (!targetBrand) return reply(response, 400, { error: '所选伙伴档案不存在。' });
    }

    if (actor.role === 'brand_admin') {
      if (!actor.brand) return reply(response, 403, { error: '品牌管理员尚未绑定品牌，无法维护人员。' });
      if (role !== 'partner' || targetBrand !== actor.brand || (target.brand && target.brand !== actor.brand)) {
        return reply(response, 403, { error: '品牌管理员只能绑定本品牌伙伴，且不能调整管理角色。' });
      }
    }

    const updated = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`, {
      method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ role, partner_id: partnerId || null })
    });
    if (!updated?.length) return reply(response, 409, { error: '账号未更新，请刷新后重试。' });
    return reply(response, 200, { ok: true, profile: updated[0] });
  } catch (error) {
    return reply(response, /没有人员权限|品牌管理员/.test(error?.message || '') ? 403 : 500, { error: error?.message || '权限保存失败。' });
  }
}
