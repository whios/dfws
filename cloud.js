/* global supabase */
(function () {
  // 文件协议没有可持久化的网页登录来源，不能承载 Supabase 的邮件登录回跳。
  if (window.location.protocol === 'file:') {
    window.location.replace('https://dfws.wendywang.club');
    return;
  }
  const config = window.DFWS_SUPABASE;
  const authRedirect = `${window.location.search}${window.location.hash}`;
  const isRecoveryRedirect = /(?:[?#&])type=recovery(?:[&#]|$)/.test(authRedirect);
  const isInviteRedirect = /(?:[?#&])type=invite(?:[&#]|$)/.test(authRedirect);
  // Supabase may finish verification with either type=invite/recovery or a PKCE code.
  // All password setup callbacks must enter the partner page, never the admin home.
  const isCodeRedirect = new URLSearchParams(window.location.search).has('code');
  const isPasswordSetupRedirect = isRecoveryRedirect || isInviteRedirect || isCodeRedirect;
  if (isPasswordSetupRedirect && !document.body.classList.contains('self-review-page')) {
    const partnerUrl = new URL('self-review.html', window.location.href);
    partnerUrl.search = window.location.search;
    partnerUrl.hash = window.location.hash;
    window.location.replace(partnerUrl.href);
    return;
  }
  // 邮件通常会在默认浏览器打开；implicit 让回跳浏览器可直接建立会话，避免 PKCE 跨浏览器丢失 verifier。
  const client = supabase.createClient(config.url, config.publishableKey, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true } });
  const readOnly = false;
  const localPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  let profile = null;
  let remoteHasData = false;
  let syncTimer = null;
  const localRatingKey = 'dfws-skill-ratings-preview-v1';
  const localAccessKey = 'dfws-skill-access-preview-v1';
  const localEvaluationCampaignKey = 'dfws-skill-evaluation-campaigns-preview-v1';
  const localEvaluationResponseKey = 'dfws-skill-evaluation-responses-preview-v1';
  const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id || '');
  const byPartner = (rows) => new Map(rows.map((row) => [`${row.owner_name}|${row.brand}`, row]));
  const staff = () => !readOnly && ['manager', 'brand_admin', 'ai_officer'].includes(profile?.role);
  const requireWritable = () => {
    if (localPreview) throw new Error('本地审核版只读取云端数据，禁止修改或发送通知。');
    if (readOnly) throw new Error('当前系统为云端只读模式，禁止写入。');
  };
  const status = (text) => { const el = document.querySelector('#cloud-state'); if (el) el.textContent = localPreview ? '本地审核版 · 仅查看云端数据' : text; };
  const showLogin = (show) => document.querySelector('#auth-gate')?.classList.toggle('is-hidden', !show);
  const showPasswordReset = (show) => document.querySelector('#reset-gate')?.classList.toggle('is-hidden', !show);
  const roleLabel = (role) => ({ partner: '伙伴', manager: '负责人', brand_admin: '品牌管理员', ai_officer: 'AI 应用官', leader: '领导只读' })[role] || '待分配';
  const readLocalList = (key) => {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  };
  const writeLocalList = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  async function getProfile(user) {
    const { data, error } = await client.from('profiles').select('id, email, display_name, role, partner_id').eq('id', user.id).single();
    if (error) throw error;
    profile = data;
    const accountState = document.querySelector('#account-state');
    if (accountState) accountState.textContent = `${data.display_name || data.email} · ${roleLabel(data.role)}`;
    status('已连接云端');
  }

  async function loadState() {
    const [partnersRes, assetsRes, risksRes, reviewsRes, resourcesRes] = await Promise.all([
      client.from('partners').select('*').order('brand').order('owner_name'), client.from('assets').select('*').order('created_at'),
      client.from('risks').select('*').order('due_date'), client.from('reviews').select('*'),
      client.from('skill_resources').select('id, partner_id, status, created_at, partners(owner_name, brand, department)').order('created_at', { ascending: false })
    ]);
    for (const result of [partnersRes, assetsRes, risksRes, reviewsRes, resourcesRes]) if (result.error) throw result.error;
    remoteHasData = partnersRes.data.length > 0;
    if (!remoteHasData) return null;
    const partners = partnersRes.data.map((p) => ({ id: p.id, owner: p.owner_name, brand: p.brand, department: p.department }));
    const reviews = {};
    reviewsRes.data.forEach((r) => { const partner = partnersRes.data.find((p) => p.id === r.partner_id); if (partner) reviews[partner.owner_name] = { self: r.self_review, selfLevel: r.self_level, manager: r.manager_review, managerLevel: r.manager_level, officer: r.officer_review, officerLevel: r.officer_level }; });
    return { partners, reviews, assets: assetsRes.data.map((a) => ({ id: a.id, resourceId: a.skill_resource_id || null, name: a.name, type: a.asset_type, brand: a.brand, department: a.department, owner: a.owner_name, platform: a.platform, task: a.task, calls: a.calls, level: a.verification_level, status: a.verification_status, evidence: a.evidence_path, review: a.review_note, checks: a.checks || [] })), risks: risksRes.data.map((r) => ({ id: r.id, kind: r.kind, priority: r.priority, brand: r.brand, owner: r.owner_name, due: r.due_date, status: r.status, note: r.note })), submissions: (resourcesRes.data || []).map((r) => ({ id: r.id, partnerId: r.partner_id, status: r.status, createdAt: r.created_at, owner: r.partners?.owner_name || '未关联伙伴', brand: r.partners?.brand || '未填写品牌', department: r.partners?.department || '未填写部门' })) };
  }

  async function writeState(state) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有编辑云端台账的权限。请联系 AI 应用官或品牌管理员开通。');
    const partnersResult = await client.from('partners').upsert(state.partners.map((p) => ({ owner_name: p.owner, brand: p.brand, department: p.department })), { onConflict: 'owner_name,brand,department' }).select();
    if (partnersResult.error) throw partnersResult.error;
    const savedPartners = await client.from('partners').select('*');
    if (savedPartners.error) throw savedPartners.error;
    const index = byPartner(savedPartners.data);
    const assetsResult = await client.from('assets').upsert(state.assets.map((a) => { const partner = index.get(`${a.owner}|${a.brand}`); return { ...(isUuid(a.id) ? { id: a.id } : {}), ...(isUuid(a.resourceId) ? { skill_resource_id: a.resourceId } : {}), partner_id: partner?.id || null, name: a.name, asset_type: a.type, brand: a.brand, department: a.department, owner_name: a.owner, platform: a.platform || null, task: a.task, calls: Number(a.calls) || 0, verification_level: a.level, verification_status: a.status, evidence_path: a.evidence || null, review_note: a.review || null, checks: a.checks || [] }; })).select();
    if (assetsResult.error) throw assetsResult.error;
    const risksResult = await client.from('risks').upsert(state.risks.map((r) => ({ ...(isUuid(r.id) ? { id: r.id } : {}), kind: r.kind, priority: r.priority, brand: r.brand, owner_name: r.owner, due_date: r.due, status: r.status, note: r.note }))).select();
    if (risksResult.error) throw risksResult.error;
    const reviewPayload = Object.entries(state.reviews || {}).map(([owner, r]) => { const p = state.partners.find((item) => item.owner === owner); const partner = p && index.get(`${p.owner}|${p.brand}`); return partner && { partner_id: partner.id, self_review: r.self || '', self_level: r.selfLevel || '未填写', manager_review: r.manager || '', manager_level: r.managerLevel || '未填写', officer_review: r.officer || '', officer_level: r.officerLevel || '待点评' }; }).filter(Boolean);
    if (reviewPayload.length) { const reviewsResult = await client.from('reviews').upsert(reviewPayload, { onConflict: 'partner_id' }); if (reviewsResult.error) throw reviewsResult.error; }
    remoteHasData = true;
    // 首次写入由数据库生成 UUID；回填内存状态，避免下一次保存重复插入。
    const refreshed = await loadState();
    if (refreshed) Object.assign(state, refreshed);
    status('云端已同步');
  }

  async function init() {
    const passwordInput = document.querySelector('#auth-password');
    const passwordToggle = document.querySelector('[data-password-toggle]');
    const renderPasswordToggle = () => {
      if (!passwordInput || !passwordToggle) return;
      const visible = passwordInput.type === 'text';
      passwordToggle.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
      passwordToggle.title = visible ? '隐藏密码' : '显示密码';
      passwordToggle.innerHTML = `<i data-lucide="${visible ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
      window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
    };
    passwordToggle?.addEventListener('click', () => { passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password'; renderPasswordToggle(); passwordInput.focus(); });
    renderPasswordToggle();
    document.querySelector('#reset-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = document.querySelector('#reset-password').value;
      const confirmation = document.querySelector('#reset-password-confirm').value;
      const message = document.querySelector('#reset-message');
      const submit = document.querySelector('#reset-submit');
      if (password !== confirmation) { message.textContent = '两次输入的密码不一致'; return; }
      submit.disabled = true;
      const { error } = await client.auth.updateUser({ password });
      submit.disabled = false;
      if (error) { message.textContent = error.message || '密码设置失败，请重新打开邮件链接。'; return; }
      await client.auth.signOut();
      window.history.replaceState({}, document.title, window.location.pathname);
      showPasswordReset(false); showLogin(true);
      document.querySelector('#auth-message').textContent = '密码已设置，请使用新密码登录。';
      status('请使用新密码登录');
    });
    document.querySelector('#auth-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = document.querySelector('#auth-username').value.trim().toLowerCase();
      const password = document.querySelector('#auth-password').value;
      // 已开通邮箱的伙伴可用拼音账号或邮箱登录；管理员测试账号仍沿用内部账号。
      const aliases = {
        wanghui: 'wanghui@dfws.internal', luzong: 'luzong@dfws.internal', wanghui01: 'wanghui01@dfwsgroup.com',
        sunliqiang: 'sunliqiang@dfwsgroup.com', wudan: 'wudan@dfwsgroup.com', wangqingqing: 'wangqingqing@dfwsgroup.com', limengcong: 'limengcong@dfwsgroup.com', qiujuan: 'qiujuan@dfwsgroup.com', zhangzhe: 'zhangzhe@dfwsgroup.com',
        user01: 'user01@dfws.internal', user02: 'user02@dfws.internal', user03: 'user03@dfws.internal'
      };
      // 公司邮箱按拼音命名时，可直接输入邮箱前缀；保留既有内部管理和测试账号映射。
      const email = aliases[username] || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) ? username : (/^[a-z0-9._-]+$/.test(username) ? `${username}@dfwsgroup.com` : null));
      const submit = document.querySelector('#auth-submit');
      if (!email) { document.querySelector('#auth-message').textContent = '登录名或密码错误'; return; }
      submit.disabled = true;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      submit.disabled = false;
      if (error || !data.session) { document.querySelector('#auth-message').textContent = '登录名或密码错误'; return; }
      await getProfile(data.user);
      const partnerPage = document.body.classList.contains('self-review-page');
      if (profile?.role === 'partner' && !partnerPage) { window.location.replace('self-review.html'); return; }
      if (profile?.role !== 'partner' && partnerPage) { window.location.replace('index.html'); return; }
      window.location.reload();
    });
    document.querySelector('#sign-out')?.addEventListener('click', async (event) => {
      await client.auth.signOut();
      const redirect = event.currentTarget.dataset.signOutRedirect;
      if (redirect) window.location.replace(redirect);
      else window.location.reload();
    });
    const { data: { session } } = await client.auth.getSession();
    if (isPasswordSetupRedirect) {
      if (!session) {
        showLogin(false);
        showPasswordReset(false);
        document.querySelector('#auth-message').textContent = '链接已失效或无法验证，请联系 AI 应用官重新发送。';
        status('密码设置链接无效');
        return null;
      }
      showLogin(false);
      showPasswordReset(true);
      status('请设置新密码');
      return null;
    }
    if (!session) { showLogin(true); status('请登录后连接云端'); return null; }
    await getProfile(session.user);
    // 伙伴账号和管理端各自进入对应入口，避免越权浏览或误入错误页面。
    if (!document.body.classList.contains('self-review-page') && profile?.role === 'partner') {
      window.location.replace('self-review.html');
      return null;
    }
    if (document.body.classList.contains('self-review-page') && profile?.role !== 'partner') {
      window.location.replace('index.html');
      return null;
    }
    showLogin(false); return loadState();
  }
  function queueSync(state) { if (localPreview || readOnly || !remoteHasData || !staff()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => writeState(state).catch((error) => { status('云端同步失败'); console.error(error); }), 600); }
  async function listProfiles() {
    if (!staff()) throw new Error('当前账号没有人员权限管理权限。');
    const [profilesRes, partnersRes] = await Promise.all([client.from('profiles').select('id, email, display_name, role, partner_id, created_at').order('created_at'), client.from('partners').select('id, owner_name, brand, department').order('brand').order('owner_name')]);
    if (profilesRes.error) throw profilesRes.error;
    if (partnersRes.error) throw partnersRes.error;
    return { profiles: profilesRes.data, partners: partnersRes.data };
  }
  async function updateProfile(id, values) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有人员权限管理权限。');
    const { error } = await client.from('profiles').update(values).eq('id', id);
    if (error) throw error;
  }
  async function deleteAsset(id) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有删除云端台账的权限。');
    if (!isUuid(id)) throw new Error('该资产尚未同步到云端，无法删除。');
    const { data, error } = await client.from('assets').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('未能删除该资产，请刷新后重试。');
  }
  async function refreshState() {
    if (!profile) throw new Error('登录状态已失效，请重新登录。');
    return loadState();
  }
  async function inviteMember(values) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有人员权限管理权限。');
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      throw new Error('本地预览不发送邀请邮件，请使用 dfws.wendywang.club 的管理端操作。');
    }
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('登录状态已失效，请重新登录。');
    const response = await fetch('/api/staff/invite-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(values)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '新增人员失败');
    return result;
  }
  async function saveReview(owner, values) {
    requireWritable();
    const role = profile?.role;
    if (!['partner', 'manager', 'ai_officer'].includes(role)) throw new Error('当前角色没有点评权限。');
    const { data: partners, error: partnerError } = await client.from('partners').select('id').eq('owner_name', owner).limit(2);
    if (partnerError || partners.length !== 1) throw new Error('未找到唯一的伙伴记录，请联系 AI 应用官处理。');
    const partnerId = partners[0].id;
    if (role === 'partner' && profile.partner_id !== partnerId) throw new Error('伙伴账号只能填写本人自评。');
    const payload = { partner_id: partnerId };
    if (role === 'partner') Object.assign(payload, { self_review: values.self, self_level: values.selfLevel });
    if (role === 'manager') Object.assign(payload, { manager_review: values.manager, manager_level: values.managerLevel });
    if (role === 'ai_officer') Object.assign(payload, { officer_review: values.officer, officer_level: values.officerLevel });
    const { error } = await client.from('reviews').upsert(payload, { onConflict: 'partner_id' });
    if (error) throw error;
  }
  async function submitSelfReview(partner, values) {
    requireWritable();
    if (profile?.role !== 'partner' || profile.partner_id !== partner?.id) throw new Error('伙伴账号只能提交本人自评。');
    const { error: historyError } = await client.from('review_submissions').insert({ partner_id: partner.id, submitted_by: profile.id, self_level: values.selfLevel, self_review: values.self, evidence_path: values.evidence || null });
    if (historyError) throw historyError;
    await saveReview(partner.owner, values);
  }
  async function listReviewSubmissions() {
    const { data, error } = await client.from('review_submissions').select('id, partner_id, self_level, self_review, evidence_path, submitted_at, partners(owner_name, brand, department)').order('submitted_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((item) => ({ id: item.id, partnerId: item.partner_id, selfLevel: item.self_level, selfReview: item.self_review, evidence: item.evidence_path, submittedAt: item.submitted_at, owner: item.partners?.owner_name, brand: item.partners?.brand, department: item.partners?.department }));
  }
  async function listNotifications() {
    if (!profile) throw new Error('请先登录后查看通知。');
    const { data, error } = await client.from('notifications').select('id, skill_resource_id, kind, title, body, is_read, created_at').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async function markNotificationRead(id) {
    requireWritable();
    if (!profile) throw new Error('请先登录后处理通知。');
    const { error } = await client.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) throw error;
  }
  async function listSkillResources(includeDownloads = false) {
    const { data: resources, error } = await client.from('skill_resources').select('*, partners(owner_name, brand, department)').order('created_at', { ascending: false });
    if (error) throw error;
    let downloads = [];
    if (includeDownloads && staff()) {
      const [downloadsRes, profilesRes] = await Promise.all([
        client.from('skill_downloads').select('resource_id, downloaded_by, downloaded_at').order('downloaded_at', { ascending: false }),
        client.from('profiles').select('id, email, display_name')
      ]);
      if (downloadsRes.error) throw downloadsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      const names = new Map(profilesRes.data.map((item) => [item.id, item.display_name || item.email]));
      downloads = downloadsRes.data.map((item) => ({ ...item, downloader: names.get(item.downloaded_by) || '未知账号' }));
    }
    return { resources: resources || [], downloads };
  }
  async function uploadSkill(partner, values, file) {
    requireWritable();
    if (!profile) throw new Error('请先登录后提交成果。');
    if (!file) throw new Error('请选择要提交的 Skill 文件。');
    if (file.size > 200 * 1024 * 1024) throw new Error('单个文件最大支持 200MB。');
    const showcaseFile = values.showcaseFile;
    if (showcaseFile?.size > 200 * 1024 * 1024) throw new Error('成果展示附件最大支持 200MB。');
    if (!partner?.id) throw new Error('请选择对应的伙伴记录。');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'skill-file';
    const path = `${profile.id}/${crypto.randomUUID()}-${safeName}`;
    const bucket = client.storage.from('skill-files');
    const { error: uploadError } = await bucket.upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream' });
    if (uploadError) throw uploadError;
    let showcasePath = '';
    if (showcaseFile) {
      const showcaseName = showcaseFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'showcase-file';
      showcasePath = `${profile.id}/showcase-${crypto.randomUUID()}-${showcaseName}`;
      const { error: showcaseError } = await bucket.upload(showcasePath, showcaseFile, { cacheControl: '3600', upsert: false, contentType: showcaseFile.type || 'application/octet-stream' });
      if (showcaseError) {
        await bucket.remove([path]);
        throw showcaseError;
      }
    }
    const description = [values.description || '', showcasePath ? `成果展示附件路径：${showcasePath}` : '', showcaseFile ? `成果展示附件名称：${showcaseFile.name}` : ''].filter(Boolean).join('\n\n');
    const { data, error } = await client.from('skill_resources').insert({
      partner_id: partner.id,
      uploaded_by: profile.id,
      title: values.title,
      description,
      visibility_scope: values.visibilityScope || 'all_partners',
      file_name: file.name,
      file_path: path,
      mime_type: file.type || null,
      size_bytes: file.size
    }).select().single();
    if (error) {
      await bucket.remove([path, showcasePath].filter(Boolean));
      throw error;
    }
    return data;
  }
  async function downloadSkill(resource) {
    return downloadResourceFile(resource, resource.file_path, resource.file_name || 'skill-file');
  }
  async function recordSkillAccess(resource) {
    if (!profile) throw new Error('请先登录后记录使用。');
    if (localPreview) {
      const access = readLocalList(localAccessKey).filter((item) => !(item.resource_id === resource.id && item.opened_by === profile.id));
      access.push({ resource_id: resource.id, opened_by: profile.id, opened_at: new Date().toISOString() });
      writeLocalList(localAccessKey, access);
      return;
    }
    requireWritable();
    const { error } = await client.rpc('record_skill_resource_access', { resource_id: resource.id });
    if (error) throw error;
  }
  async function listSkillRatingSummaries(resources = []) {
    if (!profile) return [];
    if (localPreview) {
      const ratings = readLocalList(localRatingKey);
      const access = readLocalList(localAccessKey);
      return resources.map((resource) => {
        const rows = ratings.filter((item) => item.resource_id === resource.id);
        const own = rows.find((item) => item.rater_id === profile.id);
        const total = rows.reduce((sum, item) => sum + Number(item.rating || 0), 0);
        const accessed = access.some((item) => item.resource_id === resource.id && item.opened_by === profile.id);
        return { resource_id: resource.id, average_rating: rows.length ? total / rows.length : null, rating_count: rows.length, my_rating: own?.rating || null, can_rate: profile.role === 'partner' && resource.uploaded_by !== profile.id && accessed };
      });
    }
    const { data, error } = await client.rpc('skill_rating_summaries');
    if (error) throw error;
    return data || [];
  }
  async function rateSkill(resource, rating) {
    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('请选择 1 到 5 星。');
    if (!profile || profile.role !== 'partner') throw new Error('仅伙伴账号可以提交使用评分。');
    if (resource.uploaded_by === profile.id) throw new Error('不能评价自己提交的成果。');
    if (localPreview) {
      const access = readLocalList(localAccessKey);
      if (!access.some((item) => item.resource_id === resource.id && item.opened_by === profile.id)) throw new Error('请先打开操作步骤或下载文件后再评分。');
      const ratings = readLocalList(localRatingKey).filter((item) => !(item.resource_id === resource.id && item.rater_id === profile.id));
      ratings.push({ resource_id: resource.id, rater_id: profile.id, rating: value, updated_at: new Date().toISOString() });
      writeLocalList(localRatingKey, ratings);
      return;
    }
    requireWritable();
    const { error } = await client.rpc('upsert_skill_rating', { resource_id: resource.id, rating: value });
    if (error) throw error;
  }
  async function listSkillEvaluationCampaigns(resources = []) {
    if (!profile) return [];
    if (localPreview) {
      const campaigns = readLocalList(localEvaluationCampaignKey);
      const responses = readLocalList(localEvaluationResponseKey);
      return campaigns.filter((campaign) => {
        const resource = resources.find((item) => item.id === campaign.resource_id);
        return staff() || campaign.target_profile_ids.includes(profile.id) || resource?.uploaded_by === profile.id;
      }).map((campaign) => {
        const response = responses.find((item) => item.campaign_id === campaign.id && item.respondent_id === profile.id);
        const allResponses = responses.filter((item) => item.campaign_id === campaign.id);
        const resource = resources.find((item) => item.id === campaign.resource_id);
        return { ...campaign, resource_title: resource?.title || campaign.resource_title, target_count: campaign.target_profile_ids.length, response_count: allResponses.length, efficiency_count: allResponses.filter((item) => item.efficiency_improved).length, quality_count: allResponses.filter((item) => item.quality_improved).length, no_effect_count: allResponses.filter((item) => item.no_obvious_effect).length, response: response || null };
      });
    }
    const { data, error } = await client.rpc('skill_evaluation_campaign_summaries');
    if (error) throw error;
    return (data || []).map((item) => ({ ...item, response: item.my_efficiency_improved || item.my_quality_improved || item.my_no_obvious_effect ? { efficiency_improved: item.my_efficiency_improved, quality_improved: item.my_quality_improved, no_obvious_effect: item.my_no_obvious_effect } : null }));
  }
  async function createSkillEvaluationCampaign(resource, closesAt) {
    if (!staff()) throw new Error('仅 AI 应用官、负责人和品牌管理员可以发起效果评价。');
    if (!resource?.id || resource.status !== 'published') throw new Error('请选择已发布成果。');
    if (!closesAt) throw new Error('请选择评价截止日期。');
    if (localPreview) {
      const targets = [...new Set(readLocalList(localAccessKey).filter((item) => item.resource_id === resource.id && item.opened_by !== resource.uploaded_by).map((item) => item.opened_by))];
      if (!targets.length) throw new Error('该成果暂无已打开操作步骤的伙伴，暂时不能发起评价。');
      const campaigns = readLocalList(localEvaluationCampaignKey);
      const active = campaigns.find((item) => item.resource_id === resource.id && new Date(item.closes_at).getTime() >= Date.now());
      if (active) {
        active.target_profile_ids = [...new Set([...active.target_profile_ids, ...targets])];
        const answered = new Set(readLocalList(localEvaluationResponseKey).filter((item) => item.campaign_id === active.id).map((item) => item.respondent_id));
        const pendingCount = active.target_profile_ids.filter((id) => !answered.has(id)).length;
        if (!pendingCount) throw new Error('本轮评价的伙伴均已完成，无需再次提醒。');
        active.reminder_version = Number(active.reminder_version || 0) + 1;
        active.reminded_at = new Date().toISOString();
        writeLocalList(localEvaluationCampaignKey, campaigns);
        return { action: 'reminded', targetCount: pendingCount };
      }
      campaigns.unshift({ id: crypto.randomUUID(), resource_id: resource.id, resource_title: resource.title, created_by: profile.id, closes_at: `${closesAt}T23:59:59+08:00`, created_at: new Date().toISOString(), target_profile_ids: targets, reminder_version: 0 });
      writeLocalList(localEvaluationCampaignKey, campaigns);
      return { action: 'created', targetCount: targets.length };
    }
    requireWritable();
    const { data, error } = await client.rpc('create_skill_evaluation_campaign', { resource_id: resource.id, closes_at: `${closesAt}T23:59:59+08:00` });
    if (error) throw error;
    return data;
  }
  async function submitSkillEvaluation(campaignId, values) {
    const payload = { efficiency: Boolean(values.efficiency), quality: Boolean(values.quality), noEffect: Boolean(values.noEffect) };
    if (!payload.efficiency && !payload.quality && !payload.noEffect) throw new Error('请至少选择一项使用效果。');
    if (payload.noEffect && (payload.efficiency || payload.quality)) throw new Error('“暂无明显效果”不能与提效或提质同时选择。');
    if (!profile || profile.role !== 'partner') throw new Error('仅伙伴账号可以提交效果评价。');
    if (localPreview) {
      const campaigns = readLocalList(localEvaluationCampaignKey);
      const campaign = campaigns.find((item) => item.id === campaignId && item.target_profile_ids.includes(profile.id));
      if (!campaign) throw new Error('未找到可填写的评价任务。');
      if (new Date(campaign.closes_at).getTime() < Date.now()) throw new Error('本次评价已截止。');
      const responses = readLocalList(localEvaluationResponseKey).filter((item) => !(item.campaign_id === campaignId && item.respondent_id === profile.id));
      responses.push({ campaign_id: campaignId, respondent_id: profile.id, efficiency_improved: payload.efficiency, quality_improved: payload.quality, no_obvious_effect: payload.noEffect, updated_at: new Date().toISOString() });
      writeLocalList(localEvaluationResponseKey, responses);
      return;
    }
    requireWritable();
    const { error } = await client.rpc('upsert_skill_evaluation_response', { campaign_id: campaignId, efficiency_improved: payload.efficiency, quality_improved: payload.quality, no_obvious_effect: payload.noEffect });
    if (error) throw error;
  }
  function descriptionValue(description, label) {
    return String(description || '').match(new RegExp(`(?:^|\\n\\n)${label}：([\\s\\S]*?)(?=\\n\\n[^：]+：|$)`))?.[1]?.trim() || '';
  }
  async function downloadShowcaseFile(resource) {
    const path = descriptionValue(resource.description, '成果展示附件路径');
    const name = descriptionValue(resource.description, '成果展示附件名称') || 'showcase-file';
    if (!path) throw new Error('该成果没有可下载的展示附件。');
    return downloadResourceFile(resource, path, name);
  }
  async function downloadResourceFile(resource, path, name) {
    requireWritable();
    const { data, error } = await client.storage.from('skill-files').createSignedUrl(path, 60, { download: name });
    if (error) throw error;
    const { error: logError } = await client.rpc('record_skill_download', { resource_id: resource.id });
    if (logError) throw logError;
    const link = document.createElement('a');
    link.href = data.signedUrl;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  async function reviewSkill(id, values) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有审核成果的权限。');
    const { data: before, error: beforeError } = await client.from('skill_resources').select('status').eq('id', id).single();
    if (beforeError) throw beforeError;
    const { error } = await client.from('skill_resources').update({ status: values.status, review_note: values.reviewNote || null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    const sendsReviewEmail = before.status !== values.status && ['published', 'rejected'].includes(values.status);
    if (!sendsReviewEmail) return { email: 'not_needed' };
    try {
      const { data: { session } } = await client.auth.getSession();
      const response = await fetch('/api/staff/send-skill-review-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ resourceId: id, status: values.status })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { email: 'failed', message: body.error || '审核邮件发送失败' };
      return { email: body.delivered ? 'sent' : 'not_needed', message: body.message };
    } catch (mailError) {
      return { email: 'failed', message: mailError.message || '审核邮件发送失败' };
    }
  }
  async function deleteSkillResource(id) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有删除成果的权限。');
    const { data: { session } } = await client.auth.getSession();
    const response = await fetch('/api/staff/delete-skill-resource', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ resourceId: id })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '成果删除失败');
    return body;
  }
  async function editSkill(id, values) {
    requireWritable();
    if (!staff()) throw new Error('当前账号没有编辑成果的权限。');
    const { error } = await client.from('skill_resources').update({ title: values.title, description: values.description, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
  // 仅云端完全为空时允许执行一次初始迁移；后续会话一律以云端数据初始化。
  const canBootstrap = () => !localPreview && !readOnly && Boolean(profile) && staff() && !remoteHasData;
  window.DfwsCloud = { init, refreshState, writeState, queueSync, staff, canBootstrap, listProfiles, updateProfile, deleteAsset, inviteMember, saveReview, submitSelfReview, listReviewSubmissions, listNotifications, markNotificationRead, listSkillResources, uploadSkill, downloadSkill, downloadShowcaseFile, recordSkillAccess, listSkillRatingSummaries, rateSkill, listSkillEvaluationCampaigns, createSkillEvaluationCampaign, submitSkillEvaluation, reviewSkill, deleteSkillResource, editSkill, get role() { return profile?.role; }, get profile() { return profile; }, readOnly, localPreview };
})();
