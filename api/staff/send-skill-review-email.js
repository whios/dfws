import net from 'node:net';
import tls from 'node:tls';

const staffRoles = new Set(['manager', 'brand_admin', 'ai_officer']);
const reviewStatuses = new Set(['published', 'rejected']);
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
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function smtpConfigured() {
  return ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'].every((name) => process.env[name]);
}

function waitForSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timeout = setTimeout(() => finish(new Error('SMTP 服务响应超时。')), 20000);
    const onData = (chunk) => {
      text += chunk.toString('utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.some((line) => /^\d{3} /.test(line))) finish(null, text);
    };
    const onError = (error) => finish(error);
    const onClose = () => finish(new Error('SMTP 服务连接已关闭。'));
    function finish(error, value) {
      clearTimeout(timeout);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      if (error) reject(error); else resolve(value);
    }
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function expectSmtp(response, codes) {
  const code = Number(String(response).match(/^(\d{3})/m)?.[1]);
  if (!codes.includes(code)) throw new Error(`SMTP 服务返回异常（${code || '未知状态'}）。`);
}

function connectSocket(options) {
  return new Promise((resolve, reject) => {
    const socket = options.secure ? tls.connect(options) : net.createConnection(options);
    const welcome = waitForSmtpResponse(socket);
    const event = options.secure ? 'secureConnect' : 'connect';
    const timeout = setTimeout(() => finish(new Error('SMTP 服务连接超时。')), 20000);
    const onError = (error) => finish(error);
    const onConnect = () => finish(null, socket);
    function finish(error, value) {
      clearTimeout(timeout);
      socket.removeListener('error', onError);
      socket.removeListener(event, onConnect);
      if (error) { welcome.catch(() => {}); socket.destroy(); reject(error); } else resolve({ socket: value, welcome });
    }
    socket.once('error', onError);
    socket.once(event, onConnect);
  });
}

function writeSmtp(socket, command) {
  const pending = waitForSmtpResponse(socket);
  socket.write(`${command}\r\n`);
  return pending;
}

async function sendSmtpMail({ from, to, subject, text, html }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('发件人或收件人邮箱格式不合法。');
  const options = { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), servername: process.env.SMTP_HOST, secure: process.env.SMTP_SECURE === 'true' };
  const connection = await connectSocket(options);
  let socket = connection.socket;
  try {
    expectSmtp(await connection.welcome, [220]);
    expectSmtp(await writeSmtp(socket, 'EHLO dfws.wendywang.club'), [250]);
    if (!options.secure) {
      expectSmtp(await writeSmtp(socket, 'STARTTLS'), [220]);
      socket = await new Promise((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: process.env.SMTP_HOST });
        upgraded.once('secureConnect', () => resolve(upgraded));
        upgraded.once('error', reject);
      });
      expectSmtp(await writeSmtp(socket, 'EHLO dfws.wendywang.club'), [250]);
    }
    expectSmtp(await writeSmtp(socket, 'AUTH LOGIN'), [334]);
    expectSmtp(await writeSmtp(socket, Buffer.from(process.env.SMTP_USER).toString('base64')), [334]);
    expectSmtp(await writeSmtp(socket, Buffer.from(process.env.SMTP_PASSWORD).toString('base64')), [235]);
    expectSmtp(await writeSmtp(socket, `MAIL FROM:<${from}>`), [250]);
    expectSmtp(await writeSmtp(socket, `RCPT TO:<${to}>`), [250, 251]);
    expectSmtp(await writeSmtp(socket, 'DATA'), [354]);
    const body = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject.replace(/[\r\n]/g, '')}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="dfws-boundary"',
      '',
      '--dfws-boundary',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '', text,
      '--dfws-boundary',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '', html,
      '--dfws-boundary--'
    ].join('\r\n').replace(/\r?\n\./g, '\r\n..');
    expectSmtp(await writeSmtp(socket, `${body}\r\n.`), [250]);
    await writeSmtp(socket, 'QUIT').catch(() => {});
  } finally {
    socket.destroy();
  }
}

function mailContent(status, resource) {
  const title = resource.title || '未命名成果';
  const reviewNote = resource.review_note || '请补充或修改后重新提交。';
  if (status === 'published') {
    return {
      subject: `[AI应用官] 成果已发布并入账：${title}`,
      text: `你好，\n\n你的成果《${title}》已通过审核，已进入资产台账并在成果库发布，伙伴可下载使用。\n\n请登录伙伴端查看详情：${process.env.PARTNER_PORTAL_URL || 'https://dfws.wendywang.club/self-review.html'}\n`,
      html: `<p>你好，</p><p>你的成果《<strong>${escapeHtml(title)}</strong>》已通过审核，已进入资产台账并在成果库发布，伙伴可下载使用。</p><p><a href="${escapeHtml(process.env.PARTNER_PORTAL_URL || 'https://dfws.wendywang.club/self-review.html')}">登录伙伴端查看详情</a></p>`
    };
  }
  return {
    subject: `[AI应用官] 成果需要修改：${title}`,
    text: `你好，\n\n你的成果《${title}》需要修改后重新提交。\n\n审核说明：${reviewNote}\n\n请登录伙伴端查看详情：${process.env.PARTNER_PORTAL_URL || 'https://dfws.wendywang.club/self-review.html'}\n`,
    html: `<p>你好，</p><p>你的成果《<strong>${escapeHtml(title)}</strong>》需要修改后重新提交。</p><p><strong>审核说明：</strong>${escapeHtml(reviewNote)}</p><p><a href="${escapeHtml(process.env.PARTNER_PORTAL_URL || 'https://dfws.wendywang.club/self-review.html')}">登录伙伴端查看详情</a></p>`
  };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: '仅支持 POST 请求' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) return reply(response, 503, { error: '审核邮件服务尚未完成安全配置。' });
  if (!smtpConfigured()) return reply(response, 503, { error: '审核邮件服务尚未配置 SMTP。' });

  let claimedNoticeId = null;
  let mailAccepted = false;
  try {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(response, 401, { error: '请先登录后操作。' });
    const currentUser = await supabaseFetch('/auth/v1/user', { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    const ownProfile = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(currentUser.id)}&select=role`, { headers: serviceHeaders() });
    if (!staffRoles.has(ownProfile?.[0]?.role)) return reply(response, 403, { error: '当前账号没有发送审核邮件的权限。' });

    const { resourceId, status } = request.body || {};
    if (!uuidPattern.test(resourceId || '') || !reviewStatuses.has(status)) return reply(response, 400, { error: '成果或审核状态不合法。' });

    const resources = await supabaseFetch(`/rest/v1/skill_resources?id=eq.${encodeURIComponent(resourceId)}&select=id,title,status,review_note,uploaded_by`, { headers: serviceHeaders() });
    const resource = resources?.[0];
    if (!resource || resource.status !== status || !resource.uploaded_by) return reply(response, 409, { error: '成果审核状态已变化，请刷新后重试。' });

    const kind = status === 'published' ? 'skill_published' : 'skill_rejected';
    const notices = await supabaseFetch(`/rest/v1/notifications?skill_resource_id=eq.${encodeURIComponent(resourceId)}&kind=eq.${kind}&email_sent_at=is.null&email_send_started_at=is.null&select=id&order=created_at.desc&limit=1`, { headers: serviceHeaders() });
    const notice = notices?.[0];
    if (!notice) return reply(response, 200, { ok: true, delivered: false, message: '该审核结果无需重复发送邮件。' });

    const claimed = await supabaseFetch(`/rest/v1/notifications?id=eq.${encodeURIComponent(notice.id)}&email_sent_at=is.null&email_send_started_at=is.null`, {
      method: 'PATCH',
      headers: { ...serviceHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ email_send_started_at: new Date().toISOString() })
    });
    if (!claimed?.length) return reply(response, 200, { ok: true, delivered: false, message: '该审核邮件正在发送或已发送。' });
    claimedNoticeId = notice.id;

    const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(resource.uploaded_by)}&select=email,display_name`, { headers: serviceHeaders() });
    const recipient = profiles?.[0];
    if (!recipient?.email) throw new Error('该成果提交人未绑定有效邮箱。');

    const content = mailContent(status, resource);
    await sendSmtpMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipient.email, ...content });
    mailAccepted = true;
    await supabaseFetch(`/rest/v1/notifications?id=eq.${encodeURIComponent(notice.id)}`, {
      method: 'PATCH',
      headers: serviceHeaders(),
      body: JSON.stringify({ email_sent_at: new Date().toISOString() })
    });
    return reply(response, 200, { ok: true, delivered: true, recipient: recipient.email });
  } catch (error) {
    // 发送前的可恢复失败允许下次审核动作重试；SMTP 已接受邮件后不再重试，避免重复投递。
    if (claimedNoticeId && !mailAccepted) {
      try {
        await supabaseFetch(`/rest/v1/notifications?id=eq.${encodeURIComponent(claimedNoticeId)}`, {
          method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ email_send_started_at: null })
        });
      } catch { /* 保留领取标记，避免不确定状态下重复发送。 */ }
    }
    const message = error?.message || '审核邮件发送失败';
    console.error('Skill review email delivery failed', { name: error?.name, code: error?.code, message });
    return reply(response, 500, { error: message });
  }
}
