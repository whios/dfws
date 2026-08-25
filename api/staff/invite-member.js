const allowedRoles = new Set(['partner', 'manager', 'brand_admin', 'ai_officer', 'leader']);
const staffRoles = new Set(['manager', 'brand_admin', 'ai_officer']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    return reply(response, 503, { error: '人员服务尚未完成安全配置，请联系系统管理员。' });
  }
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const ownProfile = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role`, { headers: serviceHeaders() });
    if (!staffRoles.has(ownProfile?.[0]?.role)) return reply(response, 403, { error: '当前账号没有人员管理权限。' });

    const { email, displayName, role = 'partner', partnerId = null, newPartner = null } = request.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(displayName || '').trim();
    if (!emailPattern.test(normalizedEmail) || !normalizedName || !allowedRoles.has(role)) return reply(response, 400, { error: '请填写姓名、有效公司邮箱和角色。' });

    let boundPartnerId = partnerId || null;
    if (newPartner) {
      const ownerName = String(newPartner.ownerName || normalizedName).trim();
      const brand = String(newPartner.brand || '').trim();
      const department = String(newPartner.department || '').trim();
      if (!ownerName || !brand || !department) return reply(response, 400, { error: '新增伙伴档案需填写姓名、品牌和部门。' });
      const created = await supabaseFetch('/rest/v1/partners?on_conflict=owner_name,brand,department', { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ owner_name: ownerName, brand, department }) });
      boundPartnerId = created?.[0]?.id || null;
    }
    if (boundPartnerId) {
      const partner = await supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(boundPartnerId)}&select=id,owner_name`, { headers: serviceHeaders() });
      if (!partner?.length) return reply(response, 400, { error: '所选伙伴记录不存在，请刷新后重试。' });
      if (role === 'partner' && partner[0].owner_name !== normalizedName) return reply(response, 400, { error: '伙伴账号姓名必须与所绑定的伙伴记录一致。' });
    }

    const invited = await supabaseFetch('/auth/v1/invite', { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email: normalizedEmail, data: { display_name: normalizedName }, redirect_to: process.env.INVITE_REDIRECT_TO || 'https://dfws.wendywang.club/self-review.html' }) });
    const userId = invited?.id || invited?.user?.id;
    if (!userId) throw new Error('邀请已提交，但未返回账号信息。');
    await supabaseFetch('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: userId, email: normalizedEmail, display_name: normalizedName, role, partner_id: boundPartnerId }) });
    return reply(response, 200, { ok: true, email: normalizedEmail, partnerId: boundPartnerId, message: '账号已创建、角色已设置，并已发送设置密码邮件。' });
  } catch (error) {
    const message = error?.message || '新增人员失败';
    const duplicate = /already|exists|registered|duplicate/i.test(message);
    return reply(response, duplicate ? 409 : 500, { error: duplicate ? '该邮箱已经存在账号。请在人员列表中修改绑定或使用重设密码邮件。' : message });
  }
}
