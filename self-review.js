(() => {
  const cached = JSON.parse(localStorage.getItem('dfws-v1') || '{}');
  let partners = cached.partners?.length ? cached.partners : [];
  const $ = (selector) => document.querySelector(selector);
  let resourceSubmitInFlight = false;
  let activePartner = null;
  let resourceData = { resources: [], downloads: [] };

  function esc(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
  function formatSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`; }
  function currentPartner() { return activePartner; }
  function setStatus(text) { $('#save-status').textContent = text; }
  function normalizeEvidence(value) {
    const raw = String(value || '').trim();
    // 从聊天分享文案中只保留第一个 http(s) 链接，避免“【WorkBuddy】hi”等前缀进入核验台账。
    const matched = raw.match(/https?:\/\/[^\s<>"'）】]+/i);
    return matched ? matched[0].replace(/[，。；、]+$/u, '') : raw;
  }
  function reviewStatusLabel(status) {
    return ({ pending: '待审核', published: '已发布', rejected: '退回修改', archived: '已下架' })[status] || '待审核';
  }
  function showPartnerView(view) {
    document.querySelectorAll('[data-partner-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.partnerPanel === view));
    document.querySelectorAll('[data-partner-view]').forEach((tab) => tab.classList.toggle('active', tab.dataset.partnerView === view));
  }
  function syncSubmissionSteps() {
    const blocks = [...document.querySelectorAll('.form-accordion')];
    const openIndex = blocks.findIndex((block) => block.open);
    document.querySelectorAll('.submission-steps span').forEach((step, index) => step.classList.toggle('active', index === (openIndex < 0 ? 0 : openIndex)));
  }
  function showSubmissionError(message, field) {
    const block = field?.closest('.form-accordion');
    if (block) {
      block.open = true;
      syncSubmissionSteps();
      requestAnimationFrame(() => field.focus({ preventScroll: true }));
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    $('#form-message').textContent = message;
    setStatus('请补充提交信息');
  }
  function renderSubmissions(data) {
    const profile = window.DfwsCloud.profile;
    const ownResources = data.resources.filter((resource) => resource.uploaded_by === profile?.id);
    const returned = ownResources.filter((resource) => resource.status === 'rejected');
    $('#submission-count').textContent = `${ownResources.length} 项提交`;
    $('#submission-returned-count').textContent = returned.length;
    $('#submission-returned-count').classList.toggle('is-hidden', returned.length === 0);
    $('#submission-list').innerHTML = ownResources.length ? ownResources.map((resource) => {
      const returnedNote = resource.status === 'rejected' ? `<p class="submission-note"><strong>审核说明：</strong>${esc(resource.review_note || '请根据实际使用情况补充材料后重新提交。')}</p>` : '';
      const publishedNote = resource.status === 'published' ? `<p>审核已通过，当前已被下载 ${resource.download_count} 次。</p>` : '';
      return `<article class="submission-card"><div><h3>${esc(resource.title)}</h3><p>${esc(resource.file_name)} · 提交于 ${new Date(resource.created_at).toLocaleString('zh-CN', { hour12: false })}</p>${returnedNote}${publishedNote}</div><div class="submission-side"><span class="submission-status ${esc(resource.status)}">${reviewStatusLabel(resource.status)}</span>${resource.status === 'rejected' ? `<button class="button secondary" data-resubmit="${resource.id}">重新提交</button>` : ''}</div></article>`;
    }).join('') : '<p class="empty">你还没有提交成果。完成提交后，审核进度会显示在这里。</p>';
  }
  function renderNotifications(notifications) {
    const unread = notifications.filter((item) => !item.is_read).length;
    $('#notification-count').textContent = unread ? `${unread} 条未读` : '暂无未读';
    $('#notification-unread-count').textContent = unread;
    $('#notification-unread-count').classList.toggle('is-hidden', unread === 0);
    $('#notification-list').innerHTML = notifications.length ? notifications.map((item) => `<article class="notification-item ${item.is_read ? '' : 'unread'}"><div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></div><div class="notification-side"><time>${new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</time>${item.is_read ? '' : `<button class="action-link" data-notification-read="${item.id}">标为已读</button>`}</div></article>`).join('') : '<p class="empty">暂无审核通知。</p>';
  }
  async function loadNotifications() {
    try { renderNotifications(await window.DfwsCloud.listNotifications()); }
    catch (error) {
      $('#notification-count').textContent = '通知加载失败';
      $('#notification-list').innerHTML = `<p class="empty">${esc(error.message || '通知加载失败')}</p>`;
    }
  }
  function renderResources(data) {
    const list = data.resources.filter((resource) => resource.status === 'published');
    $('#resource-count').textContent = `${list.length} 项可下载`;
    $('#resource-list').innerHTML = list.length ? list.map((resource) => {
      const partner = resource.partners;
      const fields = parseResourceDescription(resource.description);
      if (!fields.scenario) fields.scenario = resource.description || '';
      const evidence = normalizeEvidence(fields.evidence || resource.description);
      const evidenceView = /^https?:\/\//i.test(evidence)
        ? `<a class="action-link" href="${esc(evidence)}" target="_blank" rel="noopener">打开核验证据</a><span>${esc(evidence)}</span>`
        : `<span>${esc(evidence || '未填写')}</span>`;
      const detail = (label, value) => `<div class="resource-detail"><strong>${label}</strong><span>${esc(value || '未填写')}</span></div>`;
      return `<article class="resource-card"><div class="resource-card-head"><div><h3>${esc(resource.title)}</h3><span class="resource-meta">${esc(partner?.owner_name || '未关联伙伴')} · ${esc(partner?.brand || '未填写品牌')} · ${esc(resource.file_name)}</span></div><div class="resource-download"><span class="sub">已下载 ${resource.download_count} 次</span><button class="button secondary" data-download="${resource.id}">下载文件</button></div></div><p class="resource-card-summary">${esc(fields.scenario || '未填写适用场景')}</p><details class="resource-details"><summary>查看使用说明与核验证据</summary><div class="resource-detail-grid">${detail('成果类型', fields.type)}${detail('适用场景', fields.scenario)}${detail('使用前准备', fields.input)}${detail('使用结果', fields.output)}${detail('使用步骤', fields.steps)}${detail('使用限制与数据权限', fields.guardrails)}<div class="resource-detail resource-evidence"><strong>核验证据</strong>${evidenceView}</div></div></details></article>`;
    }).join('') : '<p class="empty">暂未有审核发布的成果。</p>';
    $('#resource-list').onclick = async (event) => {
      const id = event.target.dataset.download;
      if (!id) return;
      const resource = list.find((item) => item.id === id);
      try {
        event.target.disabled = true;
        event.target.textContent = '准备下载...';
        await window.DfwsCloud.downloadSkill(resource);
        event.target.textContent = '下载';
        event.target.disabled = false;
        renderResources(await window.DfwsCloud.listSkillResources());
      } catch (error) {
        event.target.disabled = false;
        event.target.textContent = '下载';
        $('#form-message').textContent = error.message || '下载失败，请稍后重试。';
      }
    };
  }
  async function loadResources() {
    try {
      resourceData = await window.DfwsCloud.listSkillResources();
      renderResources(resourceData);
      renderSubmissions(resourceData);
    } catch (error) {
      $('#resource-list').innerHTML = `<p class="empty">${esc(error.message || '成果库加载失败')}</p>`;
      $('#submission-list').innerHTML = `<p class="empty">${esc(error.message || '我的提交加载失败')}</p>`;
    }
  }
  document.querySelectorAll('[data-partner-view]').forEach((tab) => tab.addEventListener('click', () => { showPartnerView(tab.dataset.partnerView); if (tab.dataset.partnerView === 'notifications') loadNotifications(); }));
  $('#notification-list').addEventListener('click', async (event) => {
    const id = event.target.dataset.notificationRead;
    if (!id) return;
    try { event.target.disabled = true; await window.DfwsCloud.markNotificationRead(id); await loadNotifications(); }
    catch (error) { event.target.disabled = false; $('#form-message').textContent = error.message || '通知状态更新失败，请稍后重试。'; }
  });
  document.querySelectorAll('.form-accordion').forEach((block) => block.addEventListener('toggle', syncSubmissionSteps));
  $('#self-review-form').addEventListener('invalid', (event) => {
    const block = event.target.closest('.form-accordion');
    if (block) { block.open = true; syncSubmissionSteps(); }
  }, true);
  $('#submission-list').addEventListener('click', (event) => {
    const id = event.target.dataset.resubmit;
    if (!id) return;
    const resource = resourceData.resources.find((item) => item.id === id);
    const fields = parseResourceDescription(resource?.description);
    showPartnerView('submit');
    $('#skill-title').value = resource ? `${resource.title}（修改版）` : '';
    $('#skill-type').value = fields.type || 'Skill';
    $('#skill-scenario').value = fields.scenario || '';
    $('#skill-steps').value = fields.steps || '';
    $('#skill-input').value = fields.input || '';
    $('#skill-output').value = fields.output || '';
    $('#skill-guardrails').value = fields.guardrails || '';
    $('#evidence-url').value = fields.evidence || '';
    $('#skill-tested').checked = false;
    $('#skill-file').value = '';
    $('#skill-file-status').textContent = '请重新选择修改后的成果文件';
    $('#form-message').textContent = '已带回原提交内容。请按审核说明修改，并重新选择成果文件后提交。';
    $('#skill-title').focus();
  });
  $('#evidence-url').addEventListener('blur', (event) => { event.target.value = normalizeEvidence(event.target.value); });
  $('#skill-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    $('#skill-file-status').textContent = file ? `${file.name} · ${formatSize(file.size)}` : '尚未选择文件';
  });
  function buildResourceDescription(evidence) {
    return [
      `成果类型：${$('#skill-type').value}`,
      `适用场景：${$('#skill-scenario').value.trim()}`,
      `使用步骤：${$('#skill-steps').value.trim()}`,
      `输入要求与示例：${$('#skill-input').value.trim()}`,
      `预期输出与示例：${$('#skill-output').value.trim()}`,
      $('#skill-guardrails').value.trim() ? `使用限制与数据权限：${$('#skill-guardrails').value.trim()}` : '',
      `核验证据：${evidence}`
    ].filter(Boolean).join('\n\n');
  }
  function parseResourceDescription(description) {
    const fields = {};
    const labels = {
      '成果类型': 'type',
      '适用场景': 'scenario',
      '使用步骤': 'steps',
      '输入要求与示例': 'input',
      '预期输出与示例': 'output',
      '使用限制与数据权限': 'guardrails',
      '核验证据': 'evidence'
    };
    const source = String(description || '').trim();
    source.split(/\n\n+/).forEach((part) => {
      const matched = part.match(/^([^：]+)：/);
      if (matched && labels[matched[1]]) fields[labels[matched[1]]] = part.slice(matched[0].length).trim();
    });
    return fields;
  }
  $('#self-review-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (resourceSubmitInFlight) return;
    const partner = currentPartner();
    const file = $('#skill-file').files[0];
    const title = $('#skill-title').value.trim();
    const scenario = $('#skill-scenario');
    const evidenceInput = $('#evidence-url');
    const tested = $('#skill-tested');
    const steps = $('#skill-steps');
    const guideInEvidence = $('#skill-guide-in-evidence');
    if (!partner) { showSubmissionError('当前账号尚未绑定伙伴记录，请联系 AI 应用官处理。'); return; }
    if (!title) { showSubmissionError('请填写成果名称。', $('#skill-title')); return; }
    if (!scenario.value.trim()) { showSubmissionError('请填写适用场景，说明成果解决什么问题。', scenario); return; }
    if (!evidenceInput.value.trim()) { showSubmissionError('请粘贴 WorkBuddy 对话的详细操作步骤链接。', evidenceInput); return; }
    if (!file) { showSubmissionError('请选择要提交的 Skill 文件。', $('#skill-file')); return; }
    if (!tested.checked) { showSubmissionError('请确认已实际试用，且内容不含不应共享的数据。', tested); return; }
    if (!steps.value.trim() && !guideInEvidence.checked) {
      showSubmissionError('请填写使用步骤，或勾选“附件或 WorkBuddy 对话已包含完整操作步骤”。', guideInEvidence);
      return;
    }
    const evidence = normalizeEvidence($('#evidence-url').value);
    $('#evidence-url').value = evidence;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    try {
      resourceSubmitInFlight = true;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      submit.textContent = '正在上传...';
      setStatus('成果上传中');
      await window.DfwsCloud.uploadSkill(partner, { title, description: buildResourceDescription(evidence) }, file);
      $('#skill-title').value = '';
      $('#skill-scenario').value = '';
      $('#skill-steps').value = '';
      $('#skill-input').value = '';
      $('#skill-output').value = '';
      $('#skill-guardrails').value = '';
      $('#evidence-url').value = '';
      $('#skill-guide-in-evidence').checked = false;
      $('#skill-tested').checked = false;
      $('#skill-file').value = '';
      $('#skill-file-status').textContent = '成果已提交，等待审核';
      $('#form-message').textContent = '成果已进入审核队列，审核通过后将出现在成果库中。';
      setStatus('成果已提交');
      await loadResources();
    } catch (error) {
      $('#form-message').textContent = error.message || '成果上传失败，请稍后重试。';
      setStatus('上传失败');
    } finally {
      resourceSubmitInFlight = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.textContent = '提交成果审核';
    }
  });
  async function init() {
    try {
      const remote = await window.DfwsCloud.init();
      if (remote?.partners?.length) {
        partners = remote.partners;
        const profile = window.DfwsCloud.profile;
        if (profile?.role === 'partner') {
          // 伙伴端始终按账号绑定的唯一伙伴记录提交，不提供切换入口。
          activePartner = partners.find((partner) => partner.id === profile.partner_id) || null;
          if (!activePartner) throw new Error('当前账号尚未绑定伙伴记录，请联系 AI 应用官处理。');
        }
      }
      if (window.DfwsCloud.profile) { setStatus('云端已连接'); await Promise.all([loadResources(), loadNotifications()]); }
    } catch (error) { setStatus('云端连接失败'); $('#form-message').textContent = error.message || '云端连接失败，请稍后重试。'; }
  }
  init();
})();
