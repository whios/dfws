const staffRoles = new Set(['manager', 'brand_admin', 'ai_officer']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const allowedBrands = new Set(['迈点', '最佳东方', '乔邦', '先之', '技术中心', '职能']);

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

function normalizedName(value) {
  return String(value || '').trim().split(/\s*[-－—]\s*/)[0].trim();
}

async function readPeople(ids) {
  const selected = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()))];
  if (!selected.length || selected.some((id) => !uuidPattern.test(id))) throw new Error('待绑定人员无效，请刷新后重试。');
  return supabaseFetch(`/rest/v1/organization_people?id=in.(${encodeURIComponent(selected.join(','))})&select=id,display_name,partner_id`, { headers: serviceHeaders() });
}

async function findPartner(ownerName, brand, department) {
  const query = new URLSearchParams({
    owner_name: `eq.${ownerName}`,
    brand: `eq.${brand}`,
    department: `eq.${department}`,
    select: 'id',
    order: 'id.asc',
    limit: '1'
  });
  const partners = await supabaseFetch(`/rest/v1/partners?${query.toString()}`, { headers: serviceHeaders() });
  return partners?.[0] || null;
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
    if (action === 'apply_binding_decisions') {
      const decisions = Array.isArray(request.body?.decisions) ? request.body.decisions : [];
      if (!decisions.length || decisions.length > 100) return reply(response, 400, { error: '请选择 1 到 100 位待处理人员。' });
      const people = await readPeople(decisions.map((item) => item?.personId));
      const peopleById = new Map(people.map((person) => [person.id, person]));
      const results = [];
      for (const decision of decisions) {
        const personId = String(decision?.personId || '').trim();
        const person = peopleById.get(personId);
        if (!person) { results.push({ personId, status: 'skipped', reason: '通讯录人员不存在。' }); continue; }
        if (person.partner_id) { results.push({ personId, status: 'skipped', reason: '已绑定伙伴档案。' }); continue; }
        const mode = String(decision?.mode || '');
        try {
          let partnerId = null;
          if (mode === 'bind_existing') {
            partnerId = String(decision?.partnerId || '').trim();
            if (!uuidPattern.test(partnerId)) throw new Error('未选择有效的伙伴档案。');
            const partners = await supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}&select=id,owner_name`, { headers: serviceHeaders() });
            if (!partners?.length || normalizedName(partners[0].owner_name) !== normalizedName(person.display_name)) throw new Error('候选伙伴姓名不匹配，未执行绑定。');
          } else if (mode === 'create_partner') {
            const brand = String(decision?.brand || '').trim();
            const department = String(decision?.department || '').trim();
            if (!allowedBrands.has(brand) || !department) throw new Error('新建伙伴缺少品牌或部门。');
            // Do not depend on a database upsert constraint that may not exist in older deployments.
            const existing = await findPartner(person.display_name, brand, department);
            if (existing) {
              partnerId = existing.id;
            } else {
              try {
                const created = await supabaseFetch('/rest/v1/partners', {
                  method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
                  body: JSON.stringify({ owner_name: person.display_name, brand, department })
                });
                partnerId = created?.[0]?.id || null;
              } catch (error) {
                // A concurrent admin operation may have created the same record. Reuse it if so.
                const concurrent = await findPartner(person.display_name, brand, department);
                if (!concurrent) throw error;
                partnerId = concurrent.id;
              }
            }
            if (!partnerId) throw new Error('伙伴档案创建失败。');
          } else { throw new Error('未知的绑定处理方式。'); }
          const updated = await supabaseFetch(`/rest/v1/organization_people?id=eq.${encodeURIComponent(person.id)}&partner_id=is.null`, {
            method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ partner_id: partnerId, updated_at: new Date().toISOString() })
          });
          if (!updated?.length) throw new Error('该人员刚刚被其他操作绑定，请刷新后查看。');
          results.push({ personId, status: 'bound', reason: mode === 'create_partner' ? '已新建伙伴档案并绑定。' : '已绑定既有伙伴档案。' });
        } catch (error) { results.push({ personId, status: 'failed', reason: error?.message || '绑定失败。' }); }
      }
      return reply(response, 200, { ok: true, bound: results.filter((item) => item.status === 'bound').length, failed: results.filter((item) => item.status === 'failed').length, skipped: results.filter((item) => item.status === 'skipped').length, results });
    }
    return reply(response, 400, { error: '未知的组织通讯录操作。' });
  } catch (error) {
    const message = error?.message || '组织通讯录操作失败';
    const duplicate = /duplicate|already exists/i.test(message);
    return reply(response, duplicate ? 409 : /请先登录|没有人员管理权限/.test(message) ? 403 : 500, { error: duplicate ? '该邮箱或部门已存在，请检查后重试。' : message });
  }
}
