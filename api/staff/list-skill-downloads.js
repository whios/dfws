const allowedRoles = new Set(['manager', 'brand_admin', 'ai_officer', 'leader']);

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
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '下载明细服务尚未完成安全配置。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后查看下载明细。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const actorRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role,partner_id`, { headers: serviceHeaders() });
    const actor = actorRows?.[0];
    if (!allowedRoles.has(actor?.role)) return reply(response, 403, { error: '当前账号没有查看下载明细的权限。' });

    const [resources, partners, allDownloads] = await Promise.all([
      supabaseFetch('/rest/v1/skill_resources?select=id,partner_id,status,visibility_scope&order=created_at.desc', { headers: serviceHeaders() }),
      supabaseFetch('/rest/v1/partners?select=id,brand', { headers: serviceHeaders() }),
      supabaseFetch('/rest/v1/skill_downloads?select=resource_id,downloaded_by,downloaded_at&order=downloaded_at.desc', { headers: serviceHeaders() })
    ]);
    const partnerBrand = new Map((partners || []).map((partner) => [partner.id, partner.brand]));
    let permittedResourceIds = new Set((resources || []).map((resource) => resource.id));
    if (actor.role === 'brand_admin') {
      const managementBrand = partnerBrand.get(actor.partner_id);
      if (!managementBrand) return reply(response, 403, { error: '品牌管理员尚未绑定有效品牌，无法查看下载明细。' });
      permittedResourceIds = new Set((resources || []).filter((resource) => (
        partnerBrand.get(resource.partner_id) === managementBrand
        || (resource.status === 'published' && resource.visibility_scope === 'all_partners')
      )).map((resource) => resource.id));
    }
    const downloads = (allDownloads || []).filter((item) => permittedResourceIds.has(item.resource_id));
    const downloaderIds = [...new Set(downloads.map((item) => item.downloaded_by).filter(Boolean))];
    let profiles = [];
    if (downloaderIds.length) {
      profiles = await supabaseFetch(`/rest/v1/profiles?id=in.(${downloaderIds.map(encodeURIComponent).join(',')})&select=id,display_name,email`, { headers: serviceHeaders() });
    }
    const nameById = new Map((profiles || []).map((profile) => [profile.id, profile.display_name || profile.email || '未知账号']));
    return reply(response, 200, { downloads: downloads.map((item) => ({ ...item, downloader: nameById.get(item.downloaded_by) || '未知账号' })) });
  } catch (error) {
    return reply(response, 500, { error: error?.message || '下载明细加载失败。' });
  }
}
