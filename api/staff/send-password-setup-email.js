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

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    return reply(response, 503, { error: '人员服务尚未完成安全配置，请联系系统管理员。' });
  }
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { profileId } = request.body || {};
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    if (!uuidPattern.test(profileId || '')) return reply(response, 400, { error: '账号标识不合法。' });

    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const ownProfile = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role`, { headers: serviceHeaders() });
    if (!staffRoles.has(ownProfile?.[0]?.role)) return reply(response, 403, { error: '当前账号没有人员权限管理权限。' });

    const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,email,display_name`, { headers: serviceHeaders() });
    const profile = profiles?.[0];
    if (!profile?.email) return reply(response, 404, { error: '未找到可发送邮件的平台账号。' });

    await supabaseFetch('/auth/v1/recover', {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ email: profile.email, redirect_to: process.env.INVITE_REDIRECT_TO || 'https://dfws.wendywang.club/self-review.html' })
    });
    return reply(response, 200, { ok: true, message: `已向 ${profile.email} 发送设置密码邮件。` });
  } catch (error) {
    return reply(response, 500, { error: error?.message || '设置密码邮件发送失败' });
  }
}
