(() => {
  const localKey = 'dfws-self-assessment-preview';
  const cached = JSON.parse(localStorage.getItem('dfws-v1') || '{}');
  let partners = cached.partners?.length ? cached.partners : [];
  const saved = JSON.parse(localStorage.getItem(localKey) || '{}');
  const $ = (selector) => document.querySelector(selector);
  const preview = $('#evidence-preview');
  const link = $('#evidence-link');
  const historySelect = $('#submission-history-select');
  const historyContent = $('#submission-history-content');
  let selfSubmitInFlight = false;
  let skillUploadInFlight = false;
  let activePartner = null;

  function esc(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
  function formatSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`; }
  function currentPartner() { return activePartner; }
  function partnerKey(partner) { return `${partner.owner}|${partner.brand}|${partner.department}`; }
  function setStatus(text) { $('#save-status').textContent = text; }
  function normalizeEvidence(value) {
    const raw = String(value || '').trim();
    // 从聊天分享文案中只保留第一个 http(s) 链接，避免“【WorkBuddy】hi”等前缀进入核验台账。
    const matched = raw.match(/https?:\/\/[^\s<>"'）】]+/i);
    return matched ? matched[0].replace(/[，。；、]+$/u, '') : raw;
  }
  function loadPartnerDraft() {
    const partner = currentPartner();
    if (!partner) return;
    const value = saved[partnerKey(partner)];
    $('#self-level').value = value?.level || '基本达标';
    $('#self-summary').value = value?.summary || '';
    $('#self-outcome').value = value?.outcome || '';
    $('#evidence-url').value = value?.evidence || '';
    preview.hidden = !value?.evidence;
    if (value?.evidence) link.href = value.evidence;
  }
  function renderResources(data) {
    const list = data.resources.filter((resource) => resource.status === 'published');
    $('#resource-count').textContent = `${list.length} 项可下载`;
    $('#resource-list').innerHTML = list.length ? list.map((resource) => {
      const partner = resource.partners;
      return `<article class="resource-card"><div><h3>${esc(resource.title)}</h3><p>${esc(resource.description || '未填写使用说明')}</p><span class="resource-meta">${esc(partner?.owner_name || '未关联伙伴')} · ${esc(partner?.brand || '')} · ${esc(resource.file_name)}</span></div><div class="resource-download"><span class="sub">已下载 ${resource.download_count} 次</span><button class="button secondary" data-download="${resource.id}">下载</button></div></article>`;
    }).join('') : '<p class="empty">暂未有审核发布的成果。</p>';
    $('#resource-list').onclick = async (event) => {
      const id = event.target.dataset.download;
      if (!id) return;
      const resource = list.find((item) => item.id === id);
      try {
        event.target.disabled = true;
        event.target.textContent = '准备下载...';
        const url = await window.DfwsCloud.downloadSkill(resource);
        window.open(url, '_blank', 'noopener');
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
    try { renderResources(await window.DfwsCloud.listSkillResources()); } catch (error) { $('#resource-list').innerHTML = `<p class="empty">${esc(error.message || '成果库加载失败')}</p>`; }
  }
  function formatSubmittedAt(value) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  function renderSubmissionHistory(records) {
    $('#submission-history-count').textContent = `${records.length} 次提交`;
    historySelect.disabled = records.length === 0;
    historySelect.innerHTML = records.length ? records.map((record, index) => `<option value="${index}">${formatSubmittedAt(record.submittedAt)} · ${esc(record.selfLevel)}</option>`).join('') : '<option>暂无提交记录</option>';
    const renderSelected = () => {
      const record = records[Number(historySelect.value)];
      if (!record) { historyContent.innerHTML = '<p class="empty">暂未提交个人自评。</p>'; return; }
      const evidence = record.evidence ? `<p><strong>证据：</strong><a href="${esc(record.evidence)}" target="_blank" rel="noreferrer">打开证据</a></p>` : '';
      historyContent.innerHTML = `<p><strong>${esc(record.selfLevel)} · ${formatSubmittedAt(record.submittedAt)}</strong></p><p>${esc(record.selfReview)}</p>${evidence}`;
    };
    historySelect.onchange = renderSelected;
    renderSelected();
  }
  async function loadSubmissionHistory() {
    try { renderSubmissionHistory(await window.DfwsCloud.listReviewSubmissions()); }
    catch (error) { $('#submission-history-count').textContent = '加载失败'; historyContent.innerHTML = `<p class="empty">${esc(error.message || '提交记录加载失败')}</p>`; }
  }
  $('#evidence-url').addEventListener('blur', (event) => { event.target.value = normalizeEvidence(event.target.value); });
  $('#skill-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    $('#skill-file-status').textContent = file ? `${file.name} · ${formatSize(file.size)}` : '尚未选择文件';
  });
  $('#self-review-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (selfSubmitInFlight) return;
    const partner = currentPartner();
    if (!partner) return;
    const evidence = normalizeEvidence($('#evidence-url').value);
    $('#evidence-url').value = evidence;
    const level = $('#self-level').value;
    const summaryText = $('#self-summary').value.trim();
    const outcome = $('#self-outcome').value.trim();
    const selfReview = [
      `真实任务：${summaryText}`,
      outcome ? `效果或复用：${outcome}` : '',
      `核验证据：${evidence}`
    ].filter(Boolean).join('\n');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    try {
      selfSubmitInFlight = true;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      setStatus('正在提交云端自评');
      await window.DfwsCloud.submitSelfReview(partner, { self: selfReview, selfLevel: level, evidence });
      // 保留浏览器草稿，仅用于断网后再次编辑；云端记录才是管理端的正式数据源。
      saved[partnerKey(partner)] = { level, summary: summaryText, outcome, evidence, submittedAt: new Date().toISOString() };
      localStorage.setItem(localKey, JSON.stringify(saved));
      preview.hidden = false;
      link.href = evidence;
      $('#form-message').textContent = '个人自评已提交云端，管理端可立即查看。';
      setStatus('云端自评已提交');
      await loadSubmissionHistory();
    } catch (error) {
      $('#form-message').textContent = error.message || '自评提交失败，请稍后重试。';
      setStatus('提交失败');
    } finally {
      selfSubmitInFlight = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });
  $('#upload-skill').addEventListener('click', async () => {
    if (skillUploadInFlight) return;
    const partner = currentPartner();
    const file = $('#skill-file').files[0];
    const title = $('#skill-title').value.trim();
    if (!title) { $('#form-message').textContent = '请填写成果名称。'; return; }
    if (!file) { $('#form-message').textContent = '请选择要提交的 Skill 文件。'; return; }
    const button = $('#upload-skill');
    try {
      skillUploadInFlight = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = '正在上传...';
      setStatus('成果上传中');
      await window.DfwsCloud.uploadSkill(partner, { title, description: $('#skill-description').value.trim() }, file);
      $('#skill-title').value = '';
      $('#skill-description').value = '';
      $('#skill-file').value = '';
      $('#skill-file-status').textContent = '成果已提交，等待审核';
      $('#form-message').textContent = '成果已进入审核队列，审核通过后将出现在成果库中。';
      setStatus('成果已提交');
      await loadResources();
    } catch (error) {
      $('#form-message').textContent = error.message || '成果上传失败，请稍后重试。';
      setStatus('上传失败');
    } finally {
      skillUploadInFlight = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = '提交成果审核';
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
          loadPartnerDraft();
        }
      }
      if (window.DfwsCloud.profile) { setStatus('云端已连接'); await Promise.all([loadResources(), loadSubmissionHistory()]); }
    } catch (error) { setStatus('云端连接失败'); $('#form-message').textContent = error.message || '云端连接失败，请稍后重试。'; }
  }
  init();
})();
