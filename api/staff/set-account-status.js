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

async function writeAuditLog(actorId, target, action) {
  try {
    await supabaseFetch('/rest/v1/operation_audit_logs', {
      method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_id: actorId, action, target_type: 'profile', target_id: target.id, target_name: target.display_name || target.email, details: { email: target.email } })
    });
  } catch (error) {
    // Operation logs are optional in older database environments.
    console.warn('Could not write account status audit log', error?.message || error);
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '账户服务尚未完成安全配置。' });
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { profileId, action } = request.body || {};
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    if (!uuidPattern.test(profileId || '') || !['disable', 'restore'].includes(action)) return reply(response, 400, { error: '账户操作参数无效。' });

    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const actorRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=id,role,account_status`, { headers: serviceHeaders() });
    const actor = actorRows?.[0];
    if (!staffRoles.has(actor?.role) || actor.account_status === 'disabled') return reply(response, 403, { error: '当前账号没有人员权限管理权限。' });
    if (profileId === currentUser.id) return reply(response, 400, { error: '不能停用或恢复当前登录账号，请由其他 AI 应用官或负责人操作。' });

    const targetRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,email,display_name,account_status`, { headers: serviceHeaders() });
    const target = targetRows?.[0];
    if (!target) return reply(response, 404, { error: '账号不存在或已删除。' });
    const disabled = action === 'disable';
    if ((target.account_status === 'disabled') === disabled) {
      return reply(response, 200, { ok: true, unchanged: true, profile: target, message: disabled ? '该账号已停用。' : '该账号已恢复。' });
    }

    if (disabled) {
      const activePersonnelAdmins = await supabaseFetch('/rest/v1/profiles?account_status=eq.active&role=in.(manager,ai_officer)&select=id', { headers: serviceHeaders() });
      if (activePersonnelAdmins?.length <= 1 && activePersonnelAdmins[0]?.id === profileId) {
        return reply(response, 409, { error: '不能停用最后一个 AI 应用官或负责人账号，否则无人可以恢复账户。' });
      }
    }

    // Banning at the auth layer blocks future sign-ins. The profile flag is
    // used by the application to stop an already-open browser session.
    await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(profileId)}`, {
      method: 'PUT', headers: serviceHeaders(), body: JSON.stringify({ ban_duration: disabled ? '876000h' : 'none' })
    });
    let updated;
    try {
      updated = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`, {
        method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ account_status: disabled ? 'disabled' : 'active', account_status_updated_at: new Date().toISOString(), account_status_updated_by: currentUser.id })
      });
    } catch (error) {
      // Avoid leaving an account banned when its platform status could not be saved.
      await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(profileId)}`, { method: 'PUT', headers: serviceHeaders(), body: JSON.stringify({ ban_duration: 'none' }) }).catch(() => {});
      throw error;
    }
    if (!updated?.length) throw new Error('账户状态未保存，请刷新后重试。');
    await writeAuditLog(currentUser.id, target, disabled ? '停用账户' : '恢复账户');
    return reply(response, 200, { ok: true, profile: updated[0], message: disabled ? '账户已停用，该人员无法继续登录。' : '账户已恢复，可正常登录。' });
  } catch (error) {
    return reply(response, 500, { error: error?.message || '账户状态更新失败。' });
  }
}
