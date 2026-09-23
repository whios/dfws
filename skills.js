// 管理端成果库以卡片呈现，便于在大量成果中快速判断来源、状态与可用性。
function skills() {
  const view = $('#skills');
  const canReview = Boolean(window.DfwsCloud?.staff?.());
  const isLeader = window.DfwsCloud?.role === 'leader';
  const canViewDownloadDetails = canReview || isLeader;
  if (!canReview && !isLeader) { view.innerHTML = '<div class="empty">当前账号没有查看成果的权限。</div>'; return; }
  const statusOptions = [['pending', '待审核'], ['published', '已发布并入账'], ['rejected', '退回修改'], ['archived', '已下架']];
  const hasBrandScope = Boolean(window.DfwsCloud?.brandAdmin?.());
  const scopedBrand = hasBrandScope ? window.DfwsCloud.managementBrand?.() : '';
  const canManageResource = (resource) => canReview && (!hasBrandScope || resource.partners?.brand === scopedBrand);
  const statusName = new Map(statusOptions);
  const visibilityLabel = (scope, brand) => scope === 'brand_only' ? `仅限${brand || '本品牌'}伙伴可见` : '全体伙伴可见';
  let resources = [];
  let partners = [];
  let downloads = [];
  let evaluationSummaries = [];
  let editingSkillId = null;
  // Dashboard drill-down can preset the review filters for this one visit.
  const initialFilters = window.DfwsSkillFilters || {};
  window.DfwsSkillFilters = null;
  const formatSize = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  const extract = (description, label) => {
    const matched = String(description || '').match(new RegExp(`(?:^|\\n\\n)${label}：([\\s\\S]*?)(?=\\n\\n[^：]+：|$)`));
    return matched?.[1]?.trim() || '';
  };
  const displayLabel = (label) => ({ '个人效果评估': '应用效果自评', '使用前后变化': '应用前后对比', '核验证据': '操作步骤链接' })[label] || label;
  const detail = (label, value) => `<div class="skill-detail"><strong>${displayLabel(label)}</strong><span>${esc(value || '未填写')}</span></div>`;
  const showcaseLinksView = (value) => String(value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const url = line.match(/https?:\/\/[^\s<>"'）】]+/i)?.[0];
    if (!url) return '';
    const label = line.replace(url, '').replace(/[|｜：:－—-]+\s*$/, '').trim() || url;
    return `<a class="action-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  }).filter(Boolean).join('') || '<span class="sub">未填写</span>';
  view.innerHTML = `<div class="toolbar"><div><strong>${isLeader ? '成果进度总览' : '成果审核'}</strong><div class="sub">${isLeader ? '查看全公司成果提交、发布状态和下载明细；不包含审核操作或文件下载。' : hasBrandScope ? (scopedBrand ? `可审核 ${esc(scopedBrand)} 品牌成果；其他品牌全员可见成果仅可查看和下载。` : '当前账号尚未绑定品牌，无法审核成果。') : '所有新成果在此提交；发布后自动写入资产台账。'}</div></div><span style="flex:1"></span><button class="button secondary" id="refresh-skills">刷新</button><button class="button primary" id="add-admin-skill" ${!canReview || (hasBrandScope && !scopedBrand) ? 'disabled hidden' : ''}>管理员提交成果</button></div><div class="toolbar" aria-label="成果审核筛选"><input id="skill-search" placeholder="搜索成果、提交伙伴或文件名" /><label>品牌 <select id="skill-brand"><option value="">全部品牌</option></select></label><label>审核状态 <select id="skill-review-type"><option value="">全部状态</option>${statusOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><span class="sub" id="skill-filter-count">正在加载成果...</span></div><div id="skill-library-summary" class="skill-library-summary"><span class="sub">正在加载成果数据...</span></div><article class="card reuse-ranking" ${canViewDownloadDetails ? '' : 'hidden'}><div class="section-head"><div><h2>成果复用榜</h2><p>按去重下载人数排序，下载仅代表获取文件，不等同于实际使用。</p></div><label class="sub">排行口径 <select id="reuse-ranking-mode"><option value="month">近 30 天最受复用</option><option value="total">累计下载最多</option><option value="recent">最近有新下载</option></select></label></div><div class="table-wrap"><table class="table"><thead><tr><th>排名</th><th>成果</th><th>归属伙伴</th><th>下载人数</th><th>下载次数</th><th>最近下载</th></tr></thead><tbody id="reuse-ranking-body"><tr><td colspan="6" class="empty">正在统计下载数据...</td></tr></tbody></table></div></article><div id="skill-card-grid" class="skill-card-grid"><div class="empty">正在加载成果...</div></div><article class="card" ${canViewDownloadDetails ? '' : 'hidden'}><div class="section-head"><div><h2>下载明细</h2><p>仅记录从本站点击“下载文件”的行为</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>成果</th><th>下载伙伴</th><th>下载时间</th></tr></thead><tbody id="download-body"><tr><td colspan="3" class="empty">正在加载下载记录...</td></tr></tbody></table></div></article>`;
  view.querySelector('.toolbar strong').textContent = isLeader ? '成果进度总览' : '成果审核与发布';
  view.querySelector('#add-admin-skill').textContent = '管理员代提交成果';
  view.querySelectorAll('.toolbar')[1].setAttribute('aria-label', isLeader ? '成果进度筛选' : '成果审核与发布筛选');
  view.querySelector('.reuse-ranking h2').textContent = '下载热度榜';
  view.querySelector('.reuse-ranking p').textContent = '按去重下载人数排序；下载代表获取文件，不等同于实际使用。';
  view.querySelector('#reuse-ranking-mode option[value="month"]').textContent = '近 30 天下载最多';
  view.querySelector('#reuse-ranking-body').innerHTML = '<tr><td colspan="6" class="empty">正在统计下载数据...</td></tr>';
  const renderRanking = () => {
    const brand = $('#skill-brand').value;
    const mode = $('#reuse-ranking-mode').value;
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const byId = new Map(resources.filter((resource) => resource.status === 'published' && (!brand || resource.partners?.brand === brand)).map((resource) => [resource.id, { resource, events: [] }]));
    downloads.forEach((item) => {
      const row = byId.get(item.resource_id);
      if (row) row.events.push(item);
    });
    const rows = [...byId.values()].map(({ resource, events }) => {
      const scoped = mode === 'month' ? events.filter((item) => new Date(item.downloaded_at).getTime() >= since) : events;
      const latest = events.map((item) => new Date(item.downloaded_at).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
      return { resource, unique: new Set(scoped.map((item) => item.downloaded_by)).size, count: scoped.length, latest };
    }).filter((item) => mode === 'recent' ? item.latest > 0 : item.count > 0).sort((a, b) => mode === 'recent' ? b.latest - a.latest : b.unique - a.unique || b.count - a.count || b.latest - a.latest).slice(0, 5);
    $('#reuse-ranking-body').innerHTML = rows.map((item, index) => `<tr><td><span class="ranking-number">${index + 1}</span></td><td><strong>${esc(item.resource.title)}</strong></td><td>${esc(item.resource.partners?.owner_name || '未关联')}<br><span class="sub">${esc(item.resource.partners?.brand || '未填写品牌')}</span></td><td>${item.unique} 人</td><td>${item.count} 次</td><td>${item.latest ? new Date(item.latest).toLocaleString('zh-CN', { hour12: false }) : '暂无'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">当前口径下暂无下载记录</td></tr>';
  };
  const render = () => {
    const query = $('#skill-search').value.trim().toLowerCase();
    const brand = $('#skill-brand').value;
    const status = $('#skill-review-type').value;
    const filtered = resources.filter((resource) => {
      const text = `${resource.title || ''}${resource.file_name || ''}${resource.description || ''}${resource.partners?.owner_name || ''}${resource.partners?.brand || ''}`.toLowerCase();
      return (!query || text.includes(query)) && (!brand || resource.partners?.brand === brand) && (!status || resource.status === status) && (!initialFilters.resourceId || resource.id === initialFilters.resourceId);
    });
    const published = resources.filter((resource) => resource.status === 'published').length;
    const evaluationsByResource = new Map(evaluationSummaries.map((item) => [item.resource_id, item]));
    $('#skill-filter-count').textContent = `当前显示 ${filtered.length} / ${resources.length} 项成果`;
    $('#skill-library-summary').innerHTML = `<button type="button" class="skill-summary-filter" data-filter-published title="只查看已发布并入账的成果"><strong>${published}</strong> 项已发布并入账</button><span class="sub">待审核 ${resources.filter((resource) => resource.status === 'pending').length} 项 · 本页累计下载 ${resources.reduce((sum, resource) => sum + Number(resource.download_count || 0), 0)} 次</span>`;
    $('#skill-card-grid').innerHTML = filtered.map((resource) => {
      const type = extract(resource.description, '成果类型') || '成果';
      const scenario = extract(resource.description, '适用场景') || resource.description || '尚未填写使用场景';
      const steps = extract(resource.description, '使用步骤');
      const input = extract(resource.description, '输入要求与示例');
      const output = extract(resource.description, '预期输出与示例');
      const effectTypes = extract(resource.description, '效果类型');
      const effectChange = extract(resource.description, '使用前后变化');
      const effectOther = extract(resource.description, '其他效果说明');
      const effectEvidence = extract(resource.description, '测算依据');
      const effectRating = extract(resource.description, '个人效果评估');
      const effectNext = extract(resource.description, '后续优化方向');
      const showcaseLinks = extract(resource.description, '成果展示链接');
      const showcaseNote = extract(resource.description, '成果展示说明');
      const showcasePath = extract(resource.description, '成果展示附件路径');
      const showcaseFileName = extract(resource.description, '成果展示附件名称');
      const guardrails = extract(resource.description, '使用限制与数据权限');
      const evidence = extract(resource.description, '核验证据');
      const evidenceUrl = String(evidence).match(/https?:\/\/[^\s<>"'）】]+/i)?.[0] || '';
      const partner = resource.partners || {};
      const evaluation = evaluationsByResource.get(resource.id);
      const evaluationSummary = evaluation ? `<div class="skill-evaluation-summary"><strong>应用效果评价</strong><span>已评价 ${evaluation.response_count} / ${evaluation.target_count} 人 · 提效 ${evaluation.efficiency_count} 人 · 提质 ${evaluation.quality_count} 人 · 暂无明显效果 ${evaluation.no_effect_count} 人</span></div>` : '';
      const badgeClass = resource.status === 'published' ? 'v3' : resource.status === 'rejected' ? 'high' : resource.status === 'archived' ? 'v0' : 'v1';
      const showcase = showcaseLinks || showcaseNote || showcasePath ? `<div class="skill-showcase"><strong>应用成果展示</strong>${showcaseLinksView(showcaseLinks)}${showcaseNote ? `<span>${esc(showcaseNote)}</span>` : ''}${showcasePath ? `<button class="action-link" data-download-showcase="${resource.id}">下载：${esc(showcaseFileName || '展示附件')}</button>` : ''}</div>` : '';
      const controls = canManageResource(resource) ? `<textarea class="skill-card-note" data-skill-note="${resource.id}" placeholder="审核备注，伙伴被退回后可见">${esc(resource.review_note || '')}</textarea><div class="skill-card-actions"><select data-skill-status="${resource.id}">${statusOptions.map(([value, label]) => `<option value="${value}" ${resource.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select><span style="flex:1"></span><button class="button secondary" data-download-skill="${resource.id}">下载文件</button>${showcasePath ? `<button class="button secondary" data-download-showcase="${resource.id}">下载展示附件</button>` : ''}<button class="button secondary" data-edit-skill="${resource.id}">编辑</button><button class="button primary" data-save-skill="${resource.id}">保存</button><button class="button secondary danger-action" data-delete-skill="${resource.id}">删除成果</button></div>` : resource.status === 'published' ? `<div class="skill-card-readonly"><span>仅查看</span><button class="button secondary" data-download-skill="${resource.id}">下载文件</button>${showcasePath ? `<button class="button secondary" data-download-showcase="${resource.id}">下载展示附件</button>` : ''}</div>` : '<div class="skill-card-readonly">仅查看</div>';
      return `<article class="card skill-library-card"><div class="skill-card-top"><span class="badge ${badgeClass}">${esc(statusName.get(resource.status) || '待审核')}</span><span class="sub">${esc(type)}</span></div><div><h3>${esc(resource.title)}</h3><p>${esc(scenario).slice(0, 150)}${scenario.length > 150 ? '...' : ''}</p><span class="visibility-tag ${resource.visibility_scope === 'brand_only' ? 'brand-only' : ''}">${esc(visibilityLabel(resource.visibility_scope, partner.brand))}</span></div>${showcase}${evidenceUrl ? `<a class="action-link skill-evidence-link" href="${esc(evidenceUrl)}" target="_blank" rel="noopener">打开核验证据</a>` : ''}<details class="skill-card-details"><summary>查看完整填写信息</summary><div class="skill-detail-grid">${detail('适用场景', scenario)}${detail('效果类型（伙伴自评）', effectTypes)}${detail('其他效果说明', effectOther)}${detail('个人效果评估', effectRating)}${detail('使用前后的变化', effectChange)}${detail('测算依据', effectEvidence)}${detail('后续优化方向', effectNext)}${detail('使用步骤', steps)}${detail('使用前准备', input)}${detail('使用结果', output)}${detail('使用限制与数据权限', guardrails)}${detail('核验证据', evidence)}</div></details><div class="skill-card-meta"><span><strong>${esc(partner.owner_name || '未关联伙伴')}</strong> · ${esc(partner.brand || '未填写品牌')} · ${esc(partner.department || '未填写部门')}</span><span>${esc(resource.file_name || '未上传文件')} · ${formatSize(resource.size_bytes || 0)}${canReview ? ` · 已下载 ${resource.download_count || 0} 次` : ''}</span></div>${evaluationSummary}${controls}</article>`;
    }).join('') || '<div class="empty">没有符合筛选条件的成果</div>';
    $$('.skill-evidence-link').forEach((link) => { link.textContent = '打开操作步骤'; });
    $$('.skill-card-details summary').forEach((summary) => { summary.textContent = '查看完整填写信息与操作步骤'; });
    $$('.skill-library-card').forEach((card, index) => {
      const resource = filtered[index];
      if (!canManageResource(resource) || resource?.status !== 'published') return;
      card.querySelector('.skill-card-actions')?.insertAdjacentHTML('beforeend', `<button class="button secondary" data-create-evaluation="${resource.id}">发送评价</button>`);
    });
    renderRanking();
  };
  const openEdit = (resource) => {
    editingSkillId = resource.id;
    $('#skill-edit-title').value = resource.title || '';
    $('#skill-edit-description').value = resource.description || '';
    $('#skill-edit-dialog').showModal();
  };
  const load = async () => {
    try {
      const [data, partnerRows, downloadRows] = await Promise.all([window.DfwsCloud.listSkillResources(), canReview ? window.DfwsCloud.listSkillPartners() : Promise.resolve([]), canViewDownloadDetails ? window.DfwsCloud.listSkillDownloads() : Promise.resolve([])]);
      const selectedBrand = initialFilters.brand ?? $('#skill-brand').value;
      const selectedStatus = initialFilters.status ?? $('#skill-review-type').value;
      resources = data.resources;
      evaluationSummaries = await window.DfwsCloud.listSkillEvaluationCampaigns(resources).catch(() => []);
      partners = partnerRows || [];
      downloads = downloadRows || [];
      const brands = [...new Set(resources.map((resource) => resource.partners?.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      $('#skill-brand').innerHTML = `<option value="">全部品牌</option>${brands.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('')}`;
      $('#skill-brand').value = brands.includes(selectedBrand) ? selectedBrand : '';
      $('#skill-brand').disabled = false;
      $('#skill-review-type').value = statusOptions.some(([value]) => value === selectedStatus) ? selectedStatus : '';
      render();
      const titles = new Map(resources.map((resource) => [resource.id, resource.title]));
      const downloadBody = $('#download-body');
      if (downloadBody) downloadBody.innerHTML = downloads.map((item) => `<tr><td>${esc(titles.get(item.resource_id) || '已删除成果')}</td><td>${esc(item.downloader)}</td><td>${new Date(item.downloaded_at).toLocaleString('zh-CN', { hour12: false })}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">暂未有下载记录</td></tr>';
    } catch (error) {
      $('#skill-filter-count').textContent = '成果加载失败';
      $('#skill-card-grid').innerHTML = `<div class="empty">${esc(error.message || '成果加载失败')}</div>`;
    }
  };
  const normalizeEvidence = (value) => String(value || '').trim().match(/https?:\/\/[^\s<>"'）】]+/i)?.[0]?.replace(/[，。；、]+$/u, '') || String(value || '').trim();
  const syncAdminOtherEffectField = () => {
    const field = $('#admin-skill-effect-other-field');
    const selected = $('#admin-skill-effect-other-toggle').checked;
    field.hidden = !selected;
    if (!selected) $('#admin-skill-effect-other').value = '';
  };
  const clearAdminValidation = () => {
    const panel = $('#admin-skill-validation');
    panel.hidden = true;
    panel.replaceChildren();
    $('#admin-skill-form').querySelectorAll('[aria-invalid="true"], .form-validation-invalid').forEach((field) => {
      field.removeAttribute('aria-invalid');
      field.classList.remove('form-validation-invalid');
    });
  };
  const showAdminIssues = (issues) => {
    const panel = $('#admin-skill-validation');
    const blocks = new Set();
    issues.forEach((issue) => {
      const field = issue.field;
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.classList.add('form-validation-invalid');
        const block = field.closest('.form-accordion');
        if (block) blocks.add(block);
      }
      if (issue.group) issue.group.classList.add('form-validation-invalid');
    });
    blocks.forEach((block) => { block.open = true; });
    panel.hidden = false;
    panel.innerHTML = `<strong>还有 ${issues.length} 项需要完善</strong><ul>${issues.map((issue) => `<li>${esc(issue.message)}</li>`).join('')}</ul>`;
    const first = issues.find((issue) => issue.field)?.field || issues.find((issue) => issue.group)?.group;
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.focus?.({ preventScroll: true });
  };
  const buildAdminDescription = (evidence) => [
    `成果类型：${$('#admin-skill-type').value}`,
    `适用场景：${$('#admin-skill-scenario').value.trim()}`,
    $('#admin-skill-showcase-links').value.trim() ? `成果展示链接：${$('#admin-skill-showcase-links').value.trim()}` : '',
    $('#admin-skill-showcase-note').value.trim() ? `成果展示说明：${$('#admin-skill-showcase-note').value.trim()}` : '',
    `使用步骤：${$('#admin-skill-steps').value.trim()}`,
    `输入要求与示例：${$('#admin-skill-input').value.trim()}`,
    `预期输出与示例：${$('#admin-skill-output').value.trim()}`,
    `效果类型：${[...document.querySelectorAll('input[name="admin-skill-effect-type"]:checked')].map((input) => input.value).join('、')}`,
    `使用前后变化：${$('#admin-skill-effect-change').value.trim()}`,
    $('#admin-skill-effect-other').value.trim() ? `其他效果说明：${$('#admin-skill-effect-other').value.trim()}` : '',
    $('#admin-skill-effect-evidence').value.trim() ? `测算依据：${$('#admin-skill-effect-evidence').value.trim()}` : '',
    `个人效果评估：${$('#admin-skill-effect-rating').value}`,
    $('#admin-skill-effect-next').value.trim() ? `后续优化方向：${$('#admin-skill-effect-next').value.trim()}` : '',
    `核验证据：${evidence}`
  ].filter(Boolean).join('\n\n');
  const openAdminSubmit = () => {
    const select = $('#admin-skill-partner');
    select.innerHTML = `<option value="">请选择归属伙伴</option>${partners.map((partner) => `<option value="${partner.id}">${esc(partner.owner_name)} · ${esc(partner.brand)} · ${esc(partner.department)}</option>`).join('')}`;
    $('#admin-skill-form').reset();
    $('#admin-skill-message').textContent = '';
    $('#admin-skill-file-status').textContent = '请选择 Skill 文件包。支持压缩包、文档、表格和演示文件等格式，单个文件不超过 200MB。';
    $('#admin-skill-showcase-file-status').textContent = '未选择展示附件。支持方案 PPT、PDF、图片、视频等，单个文件不超过 200MB。';
    syncAdminOtherEffectField();
    clearAdminValidation();
    $('#admin-skill-dialog').showModal();
  };
  ['skill-search', 'skill-brand', 'skill-review-type'].forEach((id) => $('#'+id).addEventListener(id === 'skill-search' ? 'input' : 'change', render));
  $('#reuse-ranking-mode').addEventListener('change', renderRanking);
  $('#skill-library-summary').onclick = (event) => {
    if (!event.target.closest('[data-filter-published]')) return;
    $('#skill-review-type').value = 'published';
    render();
  };
  $('#skill-card-grid').onclick = async (event) => {
    const evaluationId = event.target.dataset.createEvaluation;
    if (evaluationId) {
      const resource = resources.find((item) => item.id === evaluationId);
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 14);
      try {
        event.target.disabled = true;
        event.target.textContent = '正在发送...';
        const result = await window.DfwsCloud.createSkillEvaluationCampaign(resource, deadline.toISOString().slice(0, 10));
        toast(result?.action === 'reminded' ? `已提醒 ${result.targetCount} 位未评价伙伴` : `评价任务已发送${result?.targetCount ? `，已通知 ${result.targetCount} 位伙伴` : ''}`);
        await load();
      } catch (error) { toast(error.message || '评价任务发送失败'); }
      finally { event.target.disabled = false; }
      return;
    }
    const id = event.target.dataset.downloadSkill || event.target.dataset.downloadShowcase || event.target.dataset.editSkill || event.target.dataset.saveSkill || event.target.dataset.deleteSkill;
    if (!id) return;
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    if (event.target.dataset.editSkill) { openEdit(resource); return; }
    if (event.target.dataset.deleteSkill) {
      if (!confirm(`确认永久删除“${resource.title || '该成果'}”吗？关联资产台账、下载明细和文件都会删除，无法恢复。`)) return;
      try {
        event.target.disabled = true;
        event.target.textContent = '正在删除...';
        const result = await window.DfwsCloud.deleteSkillResource(id);
        const remote = await window.DfwsCloud.refreshState();
        if (remote) {
          state = { ...state, ...remote };
          localStorage.setItem(key, JSON.stringify(state));
          dashboard();
        }
        toast(result.fileCleanupPending ? '成果与关联资产已删除；文件清理将由管理员复核' : '成果与关联资产已删除');
        await load();
      } catch (error) {
        toast(error.message || '删除失败，请稍后重试');
      } finally {
        event.target.disabled = false;
      }
      return;
    }
    try {
      event.target.disabled = true;
      if (event.target.dataset.downloadSkill || event.target.dataset.downloadShowcase) { event.target.textContent = '准备下载...'; if (event.target.dataset.downloadShowcase) await window.DfwsCloud.downloadShowcaseFile(resource); else await window.DfwsCloud.downloadSkill(resource); toast('文件已开始下载'); await load(); return; }
      event.target.textContent = $(`[data-skill-status="${id}"]`).value === 'published' ? '正在入账...' : '保存中...';
      const result = await window.DfwsCloud.reviewSkill(id, { status: $(`[data-skill-status="${id}"]`).value, reviewNote: $(`[data-skill-note="${id}"]`).value });
      toast(result.email === 'sent' ? '审核状态已保存，站内通知和邮件已发送' : result.email === 'failed' ? `审核状态已保存；邮件未发出：${result.message}` : '审核状态已保存'); await load();
    } catch (error) { toast(error.message || '操作失败'); }
    finally { event.target.disabled = false; }
  };
  $('#skill-edit-form').onsubmit = async (event) => {
    event.preventDefault();
    if (!editingSkillId) return;
    const submit = $('#skill-edit-submit');
    const statusValue = $(`[data-skill-status="${editingSkillId}"]`)?.value;
    const reviewNote = $(`[data-skill-note="${editingSkillId}"]`)?.value;
    if (!statusValue) { toast('成果状态已变化，请关闭编辑框后刷新重试。'); return; }
    try {
      submit.disabled = true;
      const result = await window.DfwsCloud.editSkill(editingSkillId, { title: $('#skill-edit-title').value.trim(), description: $('#skill-edit-description').value.trim(), status: statusValue, reviewNote });
      $('#skill-edit-dialog').close();
      toast(result.email === 'sent' ? '成果与审核状态已保存，站内通知和邮件已发送' : result.email === 'failed' ? `成果与审核状态已保存；邮件未发出：${result.message}` : '成果与审核状态已保存');
      await load();
    }
    catch (error) { toast(error.message || '修改失败'); }
    finally { submit.disabled = false; }
  };
  $('#add-admin-skill').onclick = openAdminSubmit;
  document.querySelectorAll('[data-close-admin-skill]').forEach((button) => { button.onclick = () => $('#admin-skill-dialog').close(); });
  $('#admin-skill-evidence').onblur = (event) => { event.target.value = normalizeEvidence(event.target.value); };
  $('#admin-skill-effect-other-toggle').onchange = syncAdminOtherEffectField;
  $('#admin-skill-file').onchange = (event) => {
    const file = event.target.files[0];
    $('#admin-skill-file-status').textContent = file ? `本次将上传：${file.name} · ${formatSize(file.size)}` : '请选择 Skill 文件包。';
  };
  $('#admin-skill-showcase-file').onchange = (event) => {
    const file = event.target.files[0];
    $('#admin-skill-showcase-file-status').textContent = file ? `${file.name} · ${formatSize(file.size)}` : '未选择展示附件。';
  };
  $('#admin-skill-form').onsubmit = async (event) => {
    event.preventDefault();
    const partner = partners.find((item) => item.id === $('#admin-skill-partner').value);
    const file = $('#admin-skill-file').files[0];
    const showcaseFile = $('#admin-skill-showcase-file').files[0];
    const submit = $('#admin-skill-submit');
    const effectTypes = [...document.querySelectorAll('input[name="admin-skill-effect-type"]:checked')];
    const issues = [];
    if (!partner) issues.push({ message: '请选择“归属伙伴”。', field: $('#admin-skill-partner') });
    if (!$('#admin-skill-title').value.trim()) issues.push({ message: '请填写“成果名称”。', field: $('#admin-skill-title') });
    if (!$('#admin-skill-scenario').value.trim()) issues.push({ message: '请填写“适用场景”，说明成果解决什么问题。', field: $('#admin-skill-scenario') });
    if (!effectTypes.length) issues.push({ message: '请至少选择一项“效果类型”：提效、提质或其他。', field: document.querySelector('input[name="admin-skill-effect-type"]'), group: $('#admin-skill-effect-options') });
    if ($('#admin-skill-effect-other-toggle').checked && !$('#admin-skill-effect-other').value.trim()) issues.push({ message: '选择“其他”后，请填写“其他效果说明”。', field: $('#admin-skill-effect-other') });
    if (!$('#admin-skill-effect-change').value.trim()) issues.push({ message: '请填写“应用前后对比”。', field: $('#admin-skill-effect-change') });
    if (!$('#admin-skill-effect-rating').value) issues.push({ message: '请选择“应用效果自评”。', field: $('#admin-skill-effect-rating') });
    if (!$('#admin-skill-evidence').value.trim()) issues.push({ message: '请粘贴“AI 对话的详细操作步骤（链接）”。', field: $('#admin-skill-evidence') });
    if (!file) issues.push({ message: '请上传要提交的 Skill 文件。', field: $('#admin-skill-file') });
    if (!$('#admin-skill-tested').checked) issues.push({ message: '请勾选“我已实际试用”的提交确认。', field: $('#admin-skill-tested') });
    if (!$('#admin-skill-steps').value.trim() && !$('#admin-skill-guide-in-evidence').checked) issues.push({ message: '请填写“使用步骤”，或勾选“附件或 AI 对话中已包含完整操作步骤”。', field: $('#admin-skill-guide-in-evidence') });
    if (issues.length) {
      showAdminIssues(issues);
      $('#admin-skill-message').textContent = '请按上方提示补齐信息后再提交。';
      return;
    }
    clearAdminValidation();
    const evidence = normalizeEvidence($('#admin-skill-evidence').value);
    $('#admin-skill-evidence').value = evidence;
    try {
      submit.disabled = true;
      submit.textContent = '正在上传...';
      await window.DfwsCloud.uploadSkill(partner, { title: $('#admin-skill-title').value.trim(), description: buildAdminDescription(evidence), showcaseFile, visibilityScope: $('#admin-skill-visibility').value }, file);
      $('#admin-skill-dialog').close();
      toast('成果已提交，等待审核发布后自动入账');
      await load();
    } catch (error) {
      $('#admin-skill-message').textContent = error.message || '成果上传失败，请稍后重试。';
    } finally {
      submit.disabled = false;
      submit.textContent = '提交成果审核';
    }
  };
  $('#refresh-skills').onclick = load;
  load();
}
document.querySelector('[data-view="skills"]')?.addEventListener('click', () => { $('#page-title').textContent = window.DfwsCloud?.role === 'leader' ? '成果进度总览' : '成果审核与发布'; });
