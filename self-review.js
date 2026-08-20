(() => {
  const localKey = 'dfws-self-assessment-preview';
  const cached = JSON.parse(localStorage.getItem('dfws-v1') || '{}');
  const fallback = [
    { owner: '章立合', brand: '先之', department: '销售部' },
    { owner: '程亚蕊', brand: '最佳东方', department: '续签部' },
    { owner: '熊思敏', brand: '迈点', department: '研究院' }
  ];
  let partners = cached.partners?.length ? cached.partners : fallback;
  const saved = JSON.parse(localStorage.getItem(localKey) || '{}');
  const $ = (selector) => document.querySelector(selector);
  const select = $('#partner-select');
  const brandFilter = $('#brand-filter');
  const partnerSearch = $('#partner-search');
  const summary = $('#partner-summary');
  const preview = $('#evidence-preview');
  const link = $('#evidence-link');
  const historySelect = $('#submission-history-select');
  const historyContent = $('#submission-history-content');

  function esc(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
  function formatSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`; }
  function fuzzyMatch(text, query) {
    const source = String(text || '').toLowerCase();
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return terms.every((term) => source.includes(term) || [...source].reduce((cursor, char) => cursor < term.length && char === term[cursor] ? cursor + 1 : cursor, 0) === term.length);
  }
  function currentPartner() { return partners[Number(select.value)]; }
  function partnerKey(partner) { return `${partner.owner}|${partner.brand}|${partner.department}`; }
  function setStatus(text) { $('#save-status').textContent = text; }
  function renderPartnerOptions() {
    const brand = brandFilter.value;
    const query = partnerSearch.value;
    const list = partners.map((partner, index) => ({ ...partner, index })).filter((partner) => (brand === '全部品牌' || partner.brand === brand) && fuzzyMatch(`${partner.owner}${partner.brand}${partner.department}`, query));
    select.disabled = list.length === 0 || window.DfwsCloud?.profile?.role === 'partner';
    select.innerHTML = list.length ? list.map((partner) => `<option value="${partner.index}">${esc(partner.owner)} · ${esc(partner.brand)} · ${esc(partner.department)}</option>`).join('') : '<option value="">未找到匹配伙伴</option>';
    if (!list.length) { summary.innerHTML = '<div><dt>伙伴信息</dt><dd>请调整品牌或搜索条件</dd></div>'; return; }
    renderPartner();
  }
  function renderPartner() {
    const partner = currentPartner();
    if (!partner) return;
    const value = saved[partnerKey(partner)];
    summary.innerHTML = `<div><dt>伙伴姓名</dt><dd>${esc(partner.owner)}</dd></div><div><dt>品牌 / 部门</dt><dd>${esc(partner.brand)} · ${esc(partner.department)}</dd></div><div><dt>核验对应</dt><dd>伙伴记录与核验工作台证据</dd></div>`;
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
  function refreshBrands() {
    brandFilter.innerHTML = '<option value="全部品牌">全部品牌</option>' + [...new Set(partners.map((partner) => partner.brand))].map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('');
  }

  select.addEventListener('change', renderPartner);
  brandFilter.addEventListener('change', renderPartnerOptions);
  partnerSearch.addEventListener('input', renderPartnerOptions);
  $('#skill-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    $('#skill-file-status').textContent = file ? `${file.name} · ${formatSize(file.size)}` : '尚未选择文件';
  });
  $('#self-review-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const partner = currentPartner();
    if (!partner) return;
    const evidence = $('#evidence-url').value.trim();
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
      submit.disabled = true;
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
      submit.disabled = false;
    }
  });
  $('#upload-skill').addEventListener('click', async () => {
    const partner = currentPartner();
    const file = $('#skill-file').files[0];
    const title = $('#skill-title').value.trim();
    if (!title) { $('#form-message').textContent = '请填写成果名称。'; return; }
    if (!file) { $('#form-message').textContent = '请选择要提交的 Skill 文件。'; return; }
    const button = $('#upload-skill');
    try {
      button.disabled = true;
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
      button.disabled = false;
      button.textContent = '提交成果审核';
    }
  });
  async function init() {
    refreshBrands();
    renderPartnerOptions();
    try {
      const remote = await window.DfwsCloud.init();
      if (remote?.partners?.length) {
        partners = remote.partners;
        const profile = window.DfwsCloud.profile;
        if (profile?.role === 'partner') {
          // 伙伴账号只能浏览、上传和自评其 profile 绑定的唯一伙伴记录。
          partners = partners.filter((partner) => partner.id === profile.partner_id);
          brandFilter.value = '全部品牌';
          brandFilter.disabled = true;
          partnerSearch.value = '';
          partnerSearch.disabled = true;
          select.disabled = true;
        }
        refreshBrands();
        renderPartnerOptions();
      }
      if (window.DfwsCloud.profile) { setStatus('云端已连接'); await Promise.all([loadResources(), loadSubmissionHistory()]); }
    } catch (error) { setStatus('云端连接失败'); $('#form-message').textContent = error.message || '云端连接失败，请稍后重试。'; }
  }
  init();
})();
