const staffRoles = new Set(['manager', 'brand_admin', 'ai_officer']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

async function authorize(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('请先登录后操作。');
  const user = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: serviceHeaders() });
  if (!staffRoles.has(profiles?.[0]?.role)) throw new Error('当前账号没有人员管理权限。');
}

function cleanUnitIds(value) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map((id) => String(id || '').trim()).filter((id) => uuidPattern.test(id)))];
  if (!ids.length) throw new Error('请至少选择一个归属部门。');
  return ids;
}

async function listDirectory() {
  const [units, people, memberships, partners, profiles] = await Promise.all([
    supabaseFetch('/rest/v1/organization_units?select=id,name,parent_id,brand,sort_order&order=sort_order.asc,name.asc', { headers: serviceHeaders() }),
    supabaseFetch('/rest/v1/organization_people?select=id,display_name,email,partner_id,is_active&order=display_name.asc', { headers: serviceHeaders() }),
    supabaseFetch('/rest/v1/organization_memberships?select=person_id,unit_id', { headers: serviceHeaders() }),
    supabaseFetch('/rest/v1/partners?select=id,owner_name,brand,department&order=brand.asc,owner_name.asc', { headers: serviceHeaders() }),
    supabaseFetch('/rest/v1/profiles?select=id,email,display_name,partner_id,role', { headers: serviceHeaders() })
  ]);
  return { units, people, memberships, partners, profiles };
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return reply(response, 405, { error: '仅支持读取或维护组织通讯录。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '组织通讯录服务尚未完成安全配置。' });
  try {
    await authorize(request);
    if (request.method === 'GET') return reply(response, 200, { ok: true, ...(await listDirectory()) });

    const action = String(request.body?.action || '');
    if (action === 'create_unit') {
      const name = String(request.body?.name || '').trim();
      const parentId = String(request.body?.parentId || '').trim() || null;
      const brand = String(request.body?.brand || '').trim() || null;
      if (!name) return reply(response, 400, { error: '请填写部门名称。' });
      if (parentId && !uuidPattern.test(parentId)) return reply(response, 400, { error: '上级部门无效。' });
      const created = await supabaseFetch('/rest/v1/organization_units', { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ name, parent_id: parentId, brand }) });
      return reply(response, 200, { ok: true, unit: created?.[0] });
    }

    if (action === 'save_person') {
      const id = String(request.body?.id || '').trim();
      const displayName = String(request.body?.displayName || '').trim();
      const email = String(request.body?.email || '').trim().toLowerCase();
      const partnerId = String(request.body?.partnerId || '').trim() || null;
      const unitIds = cleanUnitIds(request.body?.unitIds);
      if (!displayName || !emailPattern.test(email)) return reply(response, 400, { error: '请填写姓名和有效公司邮箱。' });
      if (partnerId && !uuidPattern.test(partnerId)) return reply(response, 400, { error: '伙伴绑定无效。' });
      let personId = id;
      if (id) {
        if (!uuidPattern.test(id)) return reply(response, 400, { error: '人员编号无效。' });
        await supabaseFetch(`/rest/v1/organization_people?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ display_name: displayName, email, partner_id: partnerId, updated_at: new Date().toISOString() }) });
      } else {
        const created = await supabaseFetch('/rest/v1/organization_people', { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ display_name: displayName, email, partner_id: partnerId }) });
        personId = created?.[0]?.id;
      }
      if (!personId) throw new Error('通讯录人员保存失败。');
      await supabaseFetch(`/rest/v1/organization_memberships?person_id=eq.${encodeURIComponent(personId)}`, { method: 'DELETE', headers: serviceHeaders() });
      await supabaseFetch('/rest/v1/organization_memberships', { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(unitIds.map((unitId) => ({ person_id: personId, unit_id: unitId }))) });
      return reply(response, 200, { ok: true, personId });
    }
    return reply(response, 400, { error: '未知的组织通讯录操作。' });
  } catch (error) {
    const message = error?.message || '组织通讯录操作失败';
    const duplicate = /duplicate|already exists/i.test(message);
    return reply(response, duplicate ? 409 : /请先登录|没有人员管理权限/.test(message) ? 403 : 500, { error: duplicate ? '该邮箱或部门已存在，请检查后重试。' : message });
  }
}
