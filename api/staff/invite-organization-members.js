const staffRoles = new Set(['manager', 'brand_admin', 'ai_officer']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const maxBatchSize = 50;

function reply(response, status, body) { response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body)); }
async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || '云端服务请求失败');
  return body;
}
function serviceHeaders() { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }; }
function normalizedName(value) { return String(value || '').trim().split(/\s*[-－—]\s*/)[0].trim(); }
function isDuplicateError(message) { return /already|exists|registered|duplicate/i.test(message || ''); }
function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '人员服务尚未完成安全配置，请联系系统管理员。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    const user = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const ownProfile = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: serviceHeaders() });
    if (!staffRoles.has(ownProfile?.[0]?.role)) return reply(response, 403, { error: '当前账号没有人员管理权限。' });
    const personIds = [...new Set((Array.isArray(request.body?.personIds) ? request.body.personIds : []).map((id) => String(id || '').trim()))];
    if (!personIds.length || personIds.some((id) => !uuidPattern.test(id))) return reply(response, 400, { error: '请选择有效的通讯录人员。' });
    if (personIds.length > maxBatchSize) return reply(response, 400, { error: `单次最多发送 ${maxBatchSize} 人，请分批操作。` });
    const people = await supabaseFetch(`/rest/v1/organization_people?id=in.(${encodeURIComponent(personIds.join(','))})&is_active=is.true&select=id,display_name,email,partner_id`, { headers: serviceHeaders() });
    const results = [];
    for (const person of people || []) {
      const profiles = await supabaseFetch(`/rest/v1/profiles?email=eq.${encodeURIComponent(person.email)}&select=id`, { headers: serviceHeaders() });
      if (profiles?.length) { results.push({ personId: person.id, status: 'skipped', reason: '该邮箱已开通账号。' }); continue; }
      if (!person.partner_id) { results.push({ personId: person.id, status: 'skipped', reason: '尚未绑定伙伴记录，不能安全发送邀请。' }); continue; }
      const partners = await supabaseFetch(`/rest/v1/partners?id=eq.${encodeURIComponent(person.partner_id)}&select=id,owner_name`, { headers: serviceHeaders() });
      if (!partners?.length || normalizedName(partners[0].owner_name) !== normalizedName(person.display_name)) { results.push({ personId: person.id, status: 'skipped', reason: '伙伴绑定已变化，请先在通讯录中核对。' }); continue; }
      const bindings = await supabaseFetch(`/rest/v1/profiles?partner_id=eq.${encodeURIComponent(person.partner_id)}&select=id`, { headers: serviceHeaders() });
      if (bindings?.length) { results.push({ personId: person.id, status: 'skipped', reason: '该伙伴记录已绑定其他账号。' }); continue; }
      try {
        const invited = await supabaseFetch('/auth/v1/invite', { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email: person.email, data: { display_name: person.display_name }, redirect_to: process.env.INVITE_REDIRECT_TO || 'https://dfws.wendywang.club/self-review.html' }) });
        const userId = invited?.id || invited?.user?.id;
        if (!userId) throw new Error('邀请已提交，但未返回账号信息。');
        await supabaseFetch('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: userId, email: person.email, display_name: person.display_name, role: 'partner', partner_id: person.partner_id }) });
        results.push({ personId: person.id, status: 'invited', reason: '账号已开通，邀请邮件已发送。' });
      } catch (error) { results.push({ personId: person.id, status: isDuplicateError(error?.message) ? 'skipped' : 'failed', reason: isDuplicateError(error?.message) ? '该邮箱已经存在账号。' : error?.message || '邀请发送失败。' }); }
      await wait(250);
    }
    const invited = results.filter((item) => item.status === 'invited').length;
    const skipped = results.filter((item) => item.status === 'skipped').length;
    const failed = results.filter((item) => item.status === 'failed').length;
    return reply(response, 200, { ok: true, invited, skipped, failed, results });
  } catch (error) { return reply(response, 500, { error: error?.message || '批量邀请失败' }); }
}
