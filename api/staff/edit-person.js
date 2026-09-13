const staffRoles = new Set(['manager', 'ai_officer']);
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

async function writeAuditLog(actorId, target, previousName, nextName, brand) {
  try {
    await supabaseFetch('/rest/v1/operation_audit_logs', {
      method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_id: actorId, action: '修改人员姓名', target_type: 'profile', target_id: target.id, target_name: nextName, brand: brand || null, details: { previousName, email: target.email } })
    });
  } catch (error) {
    // 审计表由独立迁移创建；旧环境未升级时不能阻止已校验的姓名修正。
    console.warn('Could not write personnel audit log', error?.message || error);
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '人员编辑服务尚未完成安全配置。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const actorRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=id,role`, { headers: serviceHeaders() });
    if (!staffRoles.has(actorRows?.[0]?.role)) return reply(response, 403, { error: '仅 AI 应用官和负责人可以编辑人员信息。' });

    const { profileId, displayName } = request.body || {};
    const nextName = String(displayName || '').trim();
    if (!uuidPattern.test(profileId || '') || !nextName || nextName.length > 40) return reply(response, 400, { error: '请填写不超过 40 个字符的姓名。' });

    const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,email,display_name,partner_id`, { headers: serviceHeaders() });
    const target = profiles?.[0];
    if (!target) return reply(response, 404, { error: '账号不存在或已被删除。' });
    if (target.display_name === nextName) return reply(response, 200, { ok: true, unchanged: true, message: '姓名未变化。' });

    let brand = null;
    if (target.partner_id) {
      const [partnerRows, bindingRows] = await Promise.all([
        supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(target.partner_id)}&select=id,owner_name,brand,department`, { headers: serviceHeaders() }),
        supabaseFetch(`/rest/v1/profiles?partner_id=eq.${encodeURIComponent(target.partner_id)}&select=id`, { headers: serviceHeaders() })
      ]);
      const partner = partnerRows?.[0];
      if (!partner) return reply(response, 409, { error: '已绑定的伙伴档案不存在，请先处理绑定关系。' });
      if ((bindingRows || []).length > 1) return reply(response, 409, { error: '该伙伴档案同时绑定了多个账号。为避免误改，请先处理“绑定冲突”。' });
      const sameName = await supabaseFetch(`/rest/v1/partners?owner_name=eq.${encodeURIComponent(nextName)}&brand=eq.${encodeURIComponent(partner.brand)}&department=eq.${encodeURIComponent(partner.department)}&id=neq.${encodeURIComponent(partner.id)}&select=id`, { headers: serviceHeaders() });
      if (sameName?.length) return reply(response, 409, { error: '同品牌、同部门已存在同名伙伴档案。请使用可区分的姓名后再保存。' });
      brand = partner.brand;
      await supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(partner.id)}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ owner_name: nextName }) });
      await Promise.all([
        supabaseFetch(`/rest/v1/organization_people?partner_id=eq.${encodeURIComponent(partner.id)}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ display_name: nextName, updated_at: new Date().toISOString() }) }),
        supabaseFetch(`/rest/v1/assets?partner_id=eq.${encodeURIComponent(partner.id)}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ owner_name: nextName }) })
      ]);
    }
    const updated = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(target.id)}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ display_name: nextName }) });
    if (!updated?.length) return reply(response, 409, { error: '账号姓名未保存，请刷新后重试。' });
    await writeAuditLog(currentUser.id, target, target.display_name || '', nextName, brand);
    return reply(response, 200, { ok: true, profile: updated[0], message: target.partner_id ? '姓名已同步到账号、伙伴档案、资产归属和组织通讯录。' : '账号显示名已更新。' });
  } catch (error) {
    const message = error?.message || '人员编辑失败。';
    return reply(response, /同名|绑定冲突|多个账号|仅 AI 应用官/.test(message) ? 409 : 500, { error: message });
  }
}
