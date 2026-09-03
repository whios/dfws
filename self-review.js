(() => {
  const cached = JSON.parse(localStorage.getItem('dfws-v1') || '{}');
  let partners = cached.partners?.length ? cached.partners : [];
  const $ = (selector) => document.querySelector(selector);
  let resourceSubmitInFlight = false;
  let activePartner = null;
  let resourceData = { resources: [], downloads: [], ratings: [] };
  let evaluationCampaigns = [];
  let libraryFilters = { query: '', brand: '', type: '', sort: 'recent' };

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
  function showcaseLinksView(value) {
    const links = String(value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const url = line.match(/https?:\/\/[^\s<>"'）】]+/i)?.[0];
      if (!url) return '';
      const label = line.replace(url, '').replace(/[|｜：:－—-]+\s*$/, '').trim() || url;
      return `<a class="action-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
    }).filter(Boolean);
    return links.length ? `<div class="showcase-links">${links.join('')}</div>` : '<span>未填写</span>';
  }
  function reviewStatusLabel(status) {
    return ({ pending: '待审核', published: '已发布', rejected: '退回修改', archived: '已下架' })[status] || '待审核';
  }
  function visibilityLabel(scope, brand) {
    return scope === 'brand_only' ? `仅限${brand || '本品牌'}伙伴可见` : '全体伙伴可见';
  }
  function resourceType(resource) {
    return parseResourceDescription(resource.description).type || '未分类';
  }
  function resourceTime(resource) {
    const value = new Date(resource.created_at || 0).getTime();
    return Number.isFinite(value) ? value : 0;
  }
  function renderLibraryControls(allResources, filteredResources) {
    const brands = [...new Set(allResources.map((resource) => resource.partners?.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const types = [...new Set(allResources.map(resourceType).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const controls = $('#resource-library-controls');
    controls.innerHTML = `<input id="resource-search" type="search" value="${esc(libraryFilters.query)}" placeholder="搜索成果、场景、伙伴或文件名，按回车搜索" /><label>品牌<select id="resource-brand-filter"><option value="">全部品牌</option>${brands.map((brand) => `<option value="${esc(brand)}" ${libraryFilters.brand === brand ? 'selected' : ''}>${esc(brand)}</option>`).join('')}</select></label><label>类别<select id="resource-type-filter"><option value="">全部类别</option>${types.map((type) => `<option value="${esc(type)}" ${libraryFilters.type === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></label><label>排序<select id="resource-sort"><option value="recent" ${libraryFilters.sort === 'recent' ? 'selected' : ''}>最近发布</option><option value="downloads" ${libraryFilters.sort === 'downloads' ? 'selected' : ''}>下载最多</option></select></label><span class="sub">当前显示 ${filteredResources.length} / ${allResources.length} 项</span>`;
    const applySearch = (event) => { libraryFilters.query = event.target.value; renderResources(resourceData); };
    $('#resource-search').addEventListener('change', applySearch);
    $('#resource-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applySearch(event); } });
    $('#resource-brand-filter').addEventListener('change', (event) => { libraryFilters.brand = event.target.value; renderResources(resourceData); });
    $('#resource-type-filter').addEventListener('change', (event) => { libraryFilters.type = event.target.value; renderResources(resourceData); });
    $('#resource-sort').addEventListener('change', (event) => { libraryFilters.sort = event.target.value; renderResources(resourceData); });
  }
  function renderLibraryRanking(resources) {
    const ranked = [...resources].sort((left, right) => Number(right.download_count || 0) - Number(left.download_count || 0) || resourceTime(right) - resourceTime(left)).slice(0, 5);
    $('#resource-library-ranking').innerHTML = ranked.length ? `<div class="library-ranking-head"><strong>下载热度</strong><span>下载代表获取文件，不等同于实际使用</span></div><ol>${ranked.map((resource, index) => `<li><span class="ranking-number">${index + 1}</span><span class="ranking-title">${esc(resource.title || '未命名成果')}<small>${esc(resource.partners?.owner_name || '未关联伙伴')} · ${esc(resourceType(resource))}</small></span><strong>${Number(resource.download_count || 0)} 次</strong></li>`).join('')}</ol>` : '';
  }
  function ratingLabel(value) {
    return ['', '不适用或无法复用', '需要大量调整', '基本可用', '好用，有明显帮助', '强烈推荐，可直接复用'][value] || '';
  }
  function ratingView(resource, summary) {
    const count = Number(summary?.rating_count || 0);
    const average = Number(summary?.average_rating || 0);
    const myRating = Number(summary?.my_rating || 0);
    const canRate = Boolean(summary?.can_rate);
    const score = count < 3 ? `已有 ${count} 人评分` : `${average.toFixed(1)} 分 · ${count} 人评分`;
    const hint = canRate ? '点击星星提交或更新你的使用评分' : resource.uploaded_by === window.DfwsCloud.profile?.id ? '这是你提交的成果，不能自行评分' : '打开操作步骤或下载文件后即可评分';
    return `<div class="resource-rating"><div><strong>伙伴评分</strong><span>${score}</span></div><div class="star-rating" aria-label="${esc(hint)}">${[1, 2, 3, 4, 5].map((value) => `<button type="button" class="star-button ${value <= myRating ? 'selected' : ''}" data-rate-skill="${resource.id}" data-rating="${value}" title="${ratingLabel(value)}" aria-label="${ratingLabel(value)}" ${canRate ? '' : 'disabled'}>★</button>`).join('')}</div><small>${esc(hint)}</small></div>`;
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
  function renderSubmissions(data, campaigns = evaluationCampaigns) {
    const profile = window.DfwsCloud.profile;
    const ownResources = data.resources.filter((resource) => resource.uploaded_by === profile?.id);
    const returned = ownResources.filter((resource) => resource.status === 'rejected');
    $('#submission-count').textContent = `${ownResources.length} 项提交`;
    $('#submission-returned-count').textContent = returned.length;
    $('#submission-returned-count').classList.toggle('is-hidden', returned.length === 0);
    const evaluationsByResource = new Map(campaigns.map((item) => [item.resource_id, item]));
    $('#submission-list').innerHTML = ownResources.length ? ownResources.map((resource) => {
      const returnedNote = resource.status === 'rejected' ? `<p class="submission-note"><strong>审核说明：</strong>${esc(resource.review_note || '请根据实际使用情况补充材料后重新提交。')}</p>` : '';
      const publishedNote = resource.status === 'published' ? `<p>审核已通过，当前已被下载 ${resource.download_count} 次。</p>` : '';
      const evaluation = evaluationsByResource.get(resource.id);
      const evaluationSummary = evaluation ? `<div class="submission-evaluation"><strong>伙伴应用效果评价</strong><span>已评价 ${evaluation.response_count} / ${evaluation.target_count} 人 · 提效 ${evaluation.efficiency_count} 人 · 提质 ${evaluation.quality_count} 人 · 暂无明显效果 ${evaluation.no_effect_count} 人</span></div>` : '';
      return `<article class="submission-card"><div><h3>${esc(resource.title)}</h3><p>${esc(resource.file_name)} · 提交于 ${new Date(resource.created_at).toLocaleString('zh-CN', { hour12: false })}</p>${returnedNote}${publishedNote}${evaluationSummary}</div><div class="submission-side"><span class="submission-status ${esc(resource.status)}">${reviewStatusLabel(resource.status)}</span>${resource.status === 'rejected' ? `<button class="button secondary" data-resubmit="${resource.id}">重新提交</button>` : ''}</div></article>`;
    }).join('') : '<p class="empty">你还没有提交成果。完成提交后，审核进度会显示在这里。</p>';
  }
  function ensureEvaluationDialog() {
    if ($('#skill-evaluation-dialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="skill-evaluation-dialog" class="dialog"><form id="skill-evaluation-form"><header><h2>应用效果评价</h2></header><p class="sub" id="skill-evaluation-resource"></p><fieldset class="evaluation-options"><legend>本次使用后，你感受到哪些变化？</legend><label class="check-field"><input name="evaluation-effect" value="efficiency" type="checkbox" />提效：减少耗时、重复操作或等待时间</label><label class="check-field"><input name="evaluation-effect" value="quality" type="checkbox" />提质：减少返工或错误，提升完整性、一致性或结果质量</label><label class="check-field"><input id="evaluation-no-effect" name="evaluation-effect" value="none" type="checkbox" />暂无明显效果</label></fieldset><p class="sub" id="skill-evaluation-message"></p><footer><button type="submit" class="button primary">提交评价</button></footer></form></dialog>`);
    const dialog = $('#skill-evaluation-dialog');
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    const noEffect = $('#evaluation-no-effect');
    const positives = [...document.querySelectorAll('input[name="evaluation-effect"]')].filter((input) => input !== noEffect);
    noEffect.addEventListener('change', () => { if (noEffect.checked) positives.forEach((input) => { input.checked = false; }); });
    positives.forEach((input) => input.addEventListener('change', () => { if (input.checked) noEffect.checked = false; }));
    $('#skill-evaluation-form').onsubmit = async (event) => {
      event.preventDefault();
      const campaign = evaluationCampaigns.find((item) => item.id === dialog.dataset.campaignId);
      if (!campaign) return;
      const submit = dialog.querySelector('[type="submit"]');
      try {
        submit.disabled = true;
        await window.DfwsCloud.submitSkillEvaluation(campaign.id, { efficiency: document.querySelector('input[value="efficiency"]').checked, quality: document.querySelector('input[value="quality"]').checked, noEffect: noEffect.checked });
        dialog.close();
        await loadNotifications();
      } catch (error) { $('#skill-evaluation-message').textContent = error.message || '评价未提交，请稍后重试。'; }
      finally { submit.disabled = false; }
    };
  }
  function openEvaluation(campaign) {
    if (!campaign) return;
    ensureEvaluationDialog();
    const dialog = $('#skill-evaluation-dialog');
    dialog.dataset.campaignId = campaign.id;
    $('#skill-evaluation-resource').textContent = `成果：${campaign.resource_title || '未命名成果'} · 截止 ${new Date(campaign.closes_at).toLocaleDateString('zh-CN')}`;
    document.querySelector('input[value="efficiency"]').checked = Boolean(campaign.response?.efficiency_improved);
    document.querySelector('input[value="quality"]').checked = Boolean(campaign.response?.quality_improved);
    $('#evaluation-no-effect').checked = Boolean(campaign.response?.no_obvious_effect);
    $('#skill-evaluation-message').textContent = campaign.response ? '已填写过评价，可在截止前更新。' : '';
    dialog.showModal();
  }
  function renderNotifications(notifications, campaigns = []) {
    const pending = campaigns.filter((item) => !item.response && new Date(item.closes_at).getTime() >= Date.now());
    const visibleNotifications = notifications.filter((item) => item.kind !== 'skill_evaluation');
    const unread = visibleNotifications.filter((item) => !item.is_read).length;
    const count = unread + pending.length;
    $('#notification-count').textContent = count ? `${count} 条待关注` : '暂无待关注';
    $('#notification-unread-count').textContent = count;
    $('#notification-unread-count').classList.toggle('is-hidden', count === 0);
    const evaluationItems = pending.map((item) => `<article class="notification-item evaluation-notification unread"><div><h3>请评价近期使用成果</h3><p>${esc(item.resource_title || '未命名成果')} · 请在 ${new Date(item.closes_at).toLocaleDateString('zh-CN')} 前勾选本次使用是否提效、提质或暂无明显效果。</p></div><div class="notification-side"><button class="button secondary" data-open-evaluation="${item.id}">去评价</button></div></article>`).join('');
    const notificationItems = visibleNotifications.map((item) => `<article class="notification-item ${item.is_read ? '' : 'unread'}"><div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></div><div class="notification-side"><time>${new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</time>${item.is_read ? '' : `<button class="action-link" data-notification-read="${item.id}">标为已读</button>`}</div></article>`).join('');
    $('#notification-list').innerHTML = evaluationItems || notificationItems ? `${evaluationItems}${notificationItems}` : '<p class="empty">暂无审核通知。</p>';
  }
  function openNewEvaluationPrompt(campaigns) {
    const pending = campaigns.filter((item) => !item.response && new Date(item.closes_at).getTime() >= Date.now());
    if (!pending.length || !window.DfwsCloud.profile) return;
    // Evaluation is mandatory once assigned. A partner returning to the page
    // must see the unfinished task again, but an already-open dialog is not
    // reopened by the notification polling timer.
    if ($('#skill-evaluation-dialog')?.open) return;
    openEvaluation(pending[0]);
  }
  async function loadNotifications() {
    try {
      const [notifications, campaigns] = await Promise.all([window.DfwsCloud.listNotifications(), window.DfwsCloud.listSkillEvaluationCampaigns(resourceData.resources).catch(() => [])]);
      evaluationCampaigns = campaigns;
      renderNotifications(notifications, campaigns);
      renderSubmissions(resourceData, campaigns);
      openNewEvaluationPrompt(campaigns);
    }
    catch (error) {
      $('#notification-count').textContent = '通知加载失败';
      $('#notification-list').innerHTML = `<p class="empty">${esc(error.message || '通知加载失败')}</p>`;
    }
  }
  function renderResources(data) {
    const visibleResources = data.resources.filter((resource) => resource.status === 'published' && (resource.visibility_scope !== 'brand_only' || resource.partners?.brand === currentPartner()?.brand));
    const ratingsByResource = new Map((data.ratings || []).map((item) => [item.resource_id, item]));
    const query = libraryFilters.query.trim().toLowerCase();
    const list = visibleResources.filter((resource) => {
      const text = `${resource.title || ''}${resource.file_name || ''}${resource.description || ''}${resource.partners?.owner_name || ''}${resource.partners?.brand || ''}`.toLowerCase();
      return (!query || text.includes(query)) && (!libraryFilters.brand || resource.partners?.brand === libraryFilters.brand) && (!libraryFilters.type || resourceType(resource) === libraryFilters.type);
    }).sort((left, right) => libraryFilters.sort === 'downloads' ? Number(right.download_count || 0) - Number(left.download_count || 0) || resourceTime(right) - resourceTime(left) : resourceTime(right) - resourceTime(left));
    $('#resource-count').textContent = `${visibleResources.length} 项可下载`;
    renderLibraryControls(visibleResources, list);
    renderLibraryRanking(list);
    $('#resource-list').innerHTML = list.length ? list.map((resource) => {
      const partner = resource.partners;
      const fields = parseResourceDescription(resource.description);
      if (!fields.scenario) fields.scenario = resource.description || '';
      const evidence = normalizeEvidence(fields.evidence || resource.description);
      const evidenceView = /^https?:\/\//i.test(evidence)
        ? `<a class="action-link" data-open-steps="${resource.id}" href="${esc(evidence)}" target="_blank" rel="noopener">打开操作步骤</a><span>${esc(evidence)}</span>`
        : `<span>${esc(evidence || '未填写')}</span>`;
      const displayLabel = (label) => ({ '个人效果评估': '应用效果自评', '使用前后变化': '应用前后对比' })[label] || label;
      const detail = (label, value) => `<div class="resource-detail"><strong>${displayLabel(label)}</strong><span>${esc(value || '未填写')}</span></div>`;
      const showcaseFile = fields.showcasePath ? `<button class="button secondary" data-download-showcase="${resource.id}">下载展示附件</button>` : '';
      const showcaseDetail = fields.showcaseLinks || fields.showcaseNote || fields.showcasePath ? `<div class="resource-detail resource-showcase"><strong>应用成果展示</strong>${showcaseLinksView(fields.showcaseLinks)}${fields.showcaseNote ? `<span>${esc(fields.showcaseNote)}</span>` : ''}${fields.showcasePath ? `<button class="action-link" data-download-showcase="${resource.id}">下载：${esc(fields.showcaseFileName || '展示附件')}</button>` : ''}</div>` : '';
      return `<article class="resource-card"><div class="resource-card-head"><div><div class="resource-card-title"><h3>${esc(resource.title)}</h3><span class="resource-type">${esc(fields.type || '未分类')}</span></div><span class="resource-meta">${esc(partner?.owner_name || '未关联伙伴')} · ${esc(partner?.brand || '未填写品牌')} · ${esc(resource.file_name)}</span><span class="visibility-tag ${resource.visibility_scope === 'brand_only' ? 'brand-only' : ''}">${esc(visibilityLabel(resource.visibility_scope, partner?.brand))}</span></div><div class="resource-download"><span class="sub">已下载 ${resource.download_count} 次</span><div class="resource-download-actions"><button class="button secondary" data-download="${resource.id}">下载文件</button>${showcaseFile}</div></div></div><p class="resource-card-summary">${esc(fields.scenario || '未填写适用场景')}</p><details class="resource-details"><summary>查看使用说明、应用效果与操作步骤</summary><div class="resource-detail-grid">${detail('成果类型', fields.type)}${detail('适用场景', fields.scenario)}${showcaseDetail}${detail('效果类型（伙伴自评）', fields.effectTypes)}${detail('其他效果说明', fields.effectOther)}${detail('个人效果评估', fields.effectRating)}${detail('使用前后变化', fields.effectChange)}${detail('测算依据', fields.effectEvidence)}${detail('后续优化方向', fields.effectNext)}${detail('使用前准备', fields.input)}${detail('使用结果', fields.output)}${detail('使用步骤', fields.steps)}${detail('使用限制与数据权限', fields.guardrails)}<div class="resource-detail resource-evidence"><strong>操作步骤链接</strong>${evidenceView}</div></div></details></article>`;
    }).join('') : '<p class="empty">当前筛选条件下没有可下载成果。</p>';
    document.querySelectorAll('.resource-details summary').forEach((summary) => { summary.textContent = '查看使用说明、应用效果与操作步骤'; });
    document.querySelectorAll('.resource-evidence strong').forEach((label) => { label.textContent = '操作步骤链接'; });
    $('#resource-list').onclick = async (event) => {
      const accessId = event.target.dataset.openSteps;
      if (accessId) {
        event.preventDefault();
        const resource = list.find((item) => item.id === accessId);
        const url = event.target.href;
        window.open(url, '_blank', 'noopener');
        try { await window.DfwsCloud.recordSkillAccess(resource); await loadResources(); }
        catch (error) { $('#form-message').textContent = error.message || '操作步骤已打开，但使用记录未保存。'; }
        return;
      }
      const ratingId = event.target.dataset.rateSkill;
      if (ratingId) {
        const resource = list.find((item) => item.id === ratingId);
        try { await window.DfwsCloud.rateSkill(resource, event.target.dataset.rating); await loadResources(); }
        catch (error) { $('#form-message').textContent = error.message || '评分未保存，请稍后重试。'; }
        return;
      }
      const id = event.target.dataset.download || event.target.dataset.downloadShowcase;
      if (!id) return;
      const resource = list.find((item) => item.id === id);
      try {
        event.target.disabled = true;
        event.target.textContent = '准备下载...';
        if (event.target.dataset.downloadShowcase) await window.DfwsCloud.downloadShowcaseFile(resource);
        else await window.DfwsCloud.downloadSkill(resource);
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
      const resources = await window.DfwsCloud.listSkillResources();
      const ratings = await window.DfwsCloud.listSkillRatingSummaries(resources.resources).catch((error) => { console.warn('评分数据加载失败', error); return []; });
      resourceData = { ...resources, ratings };
      evaluationCampaigns = await window.DfwsCloud.listSkillEvaluationCampaigns(resourceData.resources).catch(() => evaluationCampaigns);
      renderResources(resourceData);
      renderSubmissions(resourceData, evaluationCampaigns);
    } catch (error) {
      $('#resource-list').innerHTML = `<p class="empty">${esc(error.message || '成果库加载失败')}</p>`;
      $('#submission-list').innerHTML = `<p class="empty">${esc(error.message || '我的提交加载失败')}</p>`;
    }
  }
  document.querySelectorAll('[data-partner-view]').forEach((tab) => tab.addEventListener('click', () => { showPartnerView(tab.dataset.partnerView); if (tab.dataset.partnerView === 'notifications') loadNotifications(); }));
  $('#notification-list').addEventListener('click', async (event) => {
    const campaignId = event.target.dataset.openEvaluation;
    if (campaignId) { openEvaluation(evaluationCampaigns.find((item) => item.id === campaignId)); return; }
    const id = event.target.dataset.notificationRead;
    if (!id) return;
    try { event.target.disabled = true; await window.DfwsCloud.markNotificationRead(id); await loadNotifications(); }
    catch (error) { event.target.disabled = false; $('#form-message').textContent = error.message || '通知状态更新失败，请稍后重试。'; }
  });
  document.querySelectorAll('.form-accordion').forEach((block) => block.addEventListener('toggle', syncSubmissionSteps));
  const syncOtherEffectField = () => {
    const selected = $('#skill-effect-other-toggle').checked;
    $('#skill-effect-other-field').hidden = !selected;
    $('#skill-effect-other').required = selected;
    if (!selected) $('#skill-effect-other').value = '';
  };
  $('#skill-effect-other-toggle').addEventListener('change', syncOtherEffectField);
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
    $('#skill-visibility').value = resource?.visibility_scope || 'all_partners';
    $('#skill-scenario').value = fields.scenario || '';
    $('#skill-showcase-links').value = fields.showcaseLinks || '';
    $('#skill-showcase-note').value = fields.showcaseNote || '';
    $('#skill-showcase-file').value = '';
    $('#skill-showcase-file-status').textContent = fields.showcaseFileName ? `原展示附件：${fields.showcaseFileName}；如需替换请重新选择文件` : '未选择展示附件';
    document.querySelectorAll('input[name="skill-effect-type"]').forEach((input) => { input.checked = (fields.effectTypes || '').split('、').includes(input.value); });
    $('#skill-effect-other').value = fields.effectOther || '';
    syncOtherEffectField();
    $('#skill-effect-change').value = fields.effectChange || '';
    $('#skill-effect-evidence').value = fields.effectEvidence || '';
    $('#skill-effect-rating').value = fields.effectRating || '';
    $('#skill-effect-next').value = fields.effectNext || '';
    $('#skill-steps').value = fields.steps || '';
    $('#skill-input').value = fields.input || '';
    $('#skill-output').value = fields.output || '';
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
  $('#skill-showcase-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    $('#skill-showcase-file-status').textContent = file ? `${file.name} · ${formatSize(file.size)}` : '未选择展示附件';
  });
  function buildResourceDescription(evidence) {
    return [
      `成果类型：${$('#skill-type').value}`,
      `适用场景：${$('#skill-scenario').value.trim()}`,
      $('#skill-showcase-links').value.trim() ? `成果展示链接：${$('#skill-showcase-links').value.trim()}` : '',
      $('#skill-showcase-note').value.trim() ? `成果展示说明：${$('#skill-showcase-note').value.trim()}` : '',
      `使用步骤：${$('#skill-steps').value.trim()}`,
      `输入要求与示例：${$('#skill-input').value.trim()}`,
      `预期输出与示例：${$('#skill-output').value.trim()}`,
      `效果类型：${[...document.querySelectorAll('input[name="skill-effect-type"]:checked')].map((input) => input.value).join('、')}`,
      `使用前后变化：${$('#skill-effect-change').value.trim()}`,
      $('#skill-effect-other').value.trim() ? `其他效果说明：${$('#skill-effect-other').value.trim()}` : '',
      $('#skill-effect-evidence').value.trim() ? `测算依据：${$('#skill-effect-evidence').value.trim()}` : '',
      `个人效果评估：${$('#skill-effect-rating').value}`,
      $('#skill-effect-next').value.trim() ? `后续优化方向：${$('#skill-effect-next').value.trim()}` : '',
      `核验证据：${evidence}`
    ].filter(Boolean).join('\n\n');
  }
  function parseResourceDescription(description) {
    const fields = {};
    const labels = {
      '成果类型': 'type',
      '适用场景': 'scenario',
      '成果展示链接': 'showcaseLinks',
      '成果展示说明': 'showcaseNote',
      '成果展示附件路径': 'showcasePath',
      '成果展示附件名称': 'showcaseFileName',
      '使用步骤': 'steps',
      '输入要求与示例': 'input',
      '预期输出与示例': 'output',
      '效果类型': 'effectTypes',
      '使用前后变化': 'effectChange',
      '其他效果说明': 'effectOther',
      '测算依据': 'effectEvidence',
      '个人效果评估': 'effectRating',
      '后续优化方向': 'effectNext',
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
    const showcaseFile = $('#skill-showcase-file').files[0];
    const title = $('#skill-title').value.trim();
    const scenario = $('#skill-scenario');
    const evidenceInput = $('#evidence-url');
    const tested = $('#skill-tested');
    const steps = $('#skill-steps');
    const guideInEvidence = $('#skill-guide-in-evidence');
    const effectTypes = [...document.querySelectorAll('input[name="skill-effect-type"]:checked')];
    const effectChange = $('#skill-effect-change');
    const effectRating = $('#skill-effect-rating');
    const effectOther = $('#skill-effect-other');
    if (!partner) { showSubmissionError('当前账号尚未绑定伙伴记录，请联系 AI 应用官处理。'); return; }
    if (!title) { showSubmissionError('请填写成果名称。', $('#skill-title')); return; }
    if (!scenario.value.trim()) { showSubmissionError('请填写适用场景，说明成果解决什么问题。', scenario); return; }
    if (!effectTypes.length) { showSubmissionError('请至少选择一项应用效果：提效、提质或其他。', document.querySelector('input[name="skill-effect-type"]')); return; }
    if ($('#skill-effect-other-toggle').checked && !effectOther.value.trim()) { showSubmissionError('请选择“其他”时，请填写其他效果说明。', effectOther); return; }
    if (!effectChange.value.trim()) { showSubmissionError('请填写使用前后的变化，说明成果带来的实际改善。', effectChange); return; }
    if (!effectRating.value) { showSubmissionError('请选择个人效果评估。', effectRating); return; }
    if (!evidenceInput.value.trim()) { showSubmissionError('请粘贴 AI 对话的详细操作步骤链接。', evidenceInput); return; }
    if (!file) { showSubmissionError('请选择要提交的 Skill 文件。', $('#skill-file')); return; }
    if (!tested.checked) { showSubmissionError('请确认已实际试用，且内容不含不应共享的数据。', tested); return; }
    if (!steps.value.trim() && !guideInEvidence.checked) {
      showSubmissionError('请填写使用步骤，或勾选“附件或 AI 对话中已包含完整操作步骤”。', guideInEvidence);
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
      await window.DfwsCloud.uploadSkill(partner, { title, description: buildResourceDescription(evidence), showcaseFile, visibilityScope: $('#skill-visibility').value }, file);
      $('#skill-title').value = '';
      $('#skill-visibility').value = 'all_partners';
      $('#skill-scenario').value = '';
      $('#skill-showcase-links').value = '';
      $('#skill-showcase-note').value = '';
      $('#skill-showcase-file').value = '';
      $('#skill-showcase-file-status').textContent = '未选择展示附件';
      document.querySelectorAll('input[name="skill-effect-type"]').forEach((input) => { input.checked = false; });
      syncOtherEffectField();
      $('#skill-effect-change').value = '';
      $('#skill-effect-evidence').value = '';
      $('#skill-effect-rating').value = '';
      $('#skill-effect-next').value = '';
      $('#skill-steps').value = '';
      $('#skill-input').value = '';
      $('#skill-output').value = '';
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
      if (window.DfwsCloud.profile) {
        setStatus('云端已连接');
        await Promise.all([loadResources(), loadNotifications()]);
        setInterval(loadNotifications, 30000);
      }
    } catch (error) { setStatus('云端连接失败'); $('#form-message').textContent = error.message || '云端连接失败，请稍后重试。'; }
  }
  init();
})();
