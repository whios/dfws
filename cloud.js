/* global supabase */
(function () {
  // 文件协议没有可持久化的网页登录来源，不能承载 Supabase 的邮件登录回跳。
  if (window.location.protocol === 'file:') {
    window.location.replace('https://dfws.wendywang.club');
    return;
  }
  const config = window.DFWS_SUPABASE;
  // 邮件通常会在默认浏览器打开；implicit 让回跳浏览器可直接建立会话，避免 PKCE 跨浏览器丢失 verifier。
  const client = supabase.createClient(config.url, config.publishableKey, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true } });
  const readOnly = false;
  let profile = null;
  let remoteHasData = false;
  let syncTimer = null;
  const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id || '');
  const byPartner = (rows) => new Map(rows.map((row) => [`${row.owner_name}|${row.brand}`, row]));
  const staff = () => !readOnly && ['manager', 'brand_admin', 'ai_officer'].includes(profile?.role);
  const status = (text) => { const el = document.querySelector('#cloud-state'); if (el) el.textContent = text; };
  const showLogin = (show) => document.querySelector('#auth-gate')?.classList.toggle('is-hidden', !show);
  const roleLabel = (role) => ({ partner: '伙伴', manager: '负责人', brand_admin: '品牌管理员', ai_officer: 'AI 应用官', leader: '领导只读' })[role] || '待分配';

  async function getProfile(user) {
    const { data, error } = await client.from('profiles').select('id, email, display_name, role, partner_id').eq('id', user.id).single();
    if (error) throw error;
    profile = data;
    const accountState = document.querySelector('#account-state');
    if (accountState) accountState.textContent = `${data.display_name || data.email} · ${roleLabel(data.role)}`;
    status('已连接云端');
  }

  async function loadState() {
    const [partnersRes, assetsRes, risksRes, reviewsRes] = await Promise.all([
      client.from('partners').select('*').order('brand').order('owner_name'), client.from('assets').select('*').order('created_at'),
      client.from('risks').select('*').order('due_date'), client.from('reviews').select('*')
    ]);
    for (const result of [partnersRes, assetsRes, risksRes, reviewsRes]) if (result.error) throw result.error;
    remoteHasData = partnersRes.data.length > 0;
    if (!remoteHasData) return null;
    const partners = partnersRes.data.map((p) => ({ id: p.id, owner: p.owner_name, brand: p.brand, department: p.department }));
    const reviews = {};
    reviewsRes.data.forEach((r) => { const partner = partnersRes.data.find((p) => p.id === r.partner_id); if (partner) reviews[partner.owner_name] = { self: r.self_review, selfLevel: r.self_level, manager: r.manager_review, managerLevel: r.manager_level, officer: r.officer_review, officerLevel: r.officer_level }; });
    return { partners, reviews, assets: assetsRes.data.map((a) => ({ id: a.id, name: a.name, type: a.asset_type, brand: a.brand, department: a.department, owner: a.owner_name, platform: a.platform, task: a.task, calls: a.calls, level: a.verification_level, status: a.verification_status, evidence: a.evidence_path, review: a.review_note, checks: a.checks || [] })), risks: risksRes.data.map((r) => ({ id: r.id, kind: r.kind, priority: r.priority, brand: r.brand, owner: r.owner_name, due: r.due_date, status: r.status, note: r.note })) };
  }

  async function writeState(state) {
    if (readOnly) throw new Error('当前系统为云端只读模式，禁止写入。');
    if (!staff()) throw new Error('当前账号没有编辑云端台账的权限。请联系 AI 应用官或品牌管理员开通。');
    const partnersResult = await client.from('partners').upsert(state.partners.map((p) => ({ owner_name: p.owner, brand: p.brand, department: p.department })), { onConflict: 'owner_name,brand,department' }).select();
    if (partnersResult.error) throw partnersResult.error;
    const savedPartners = await client.from('partners').select('*');
    if (savedPartners.error) throw savedPartners.error;
    const index = byPartner(savedPartners.data);
    const assetsResult = await client.from('assets').upsert(state.assets.map((a) => { const partner = index.get(`${a.owner}|${a.brand}`); return { ...(isUuid(a.id) ? { id: a.id } : {}), partner_id: partner?.id || null, name: a.name, asset_type: a.type, brand: a.brand, department: a.department, owner_name: a.owner, platform: a.platform || null, task: a.task, calls: Number(a.calls) || 0, verification_level: a.level, verification_status: a.status, evidence_path: a.evidence || null, review_note: a.review || null, checks: a.checks || [] }; })).select();
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
    document.querySelector('#auth-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const username = document.querySelector('#auth-username').value.trim().toLowerCase(); const password = document.querySelector('#auth-password').value; const email = { wanghui: 'wanghui@dfws.internal', luzong: 'luzong@dfws.internal', wanghui01: 'wanghui01@dfwsgroup.com', user01: 'user01@dfws.internal', user02: 'user02@dfws.internal', user03: 'user03@dfws.internal' }[username]; const submit = document.querySelector('#auth-submit'); if (!email) { document.querySelector('#auth-message').textContent = '登录名或密码错误'; return; } submit.disabled = true; const { data, error } = await client.auth.signInWithPassword({ email, password }); submit.disabled = false; if (error || !data.session) { document.querySelector('#auth-message').textContent = '登录名或密码错误'; return; } window.location.reload(); });
    document.querySelector('#sign-out')?.addEventListener('click', async () => { await client.auth.signOut(); window.location.reload(); });
    const { data: { session } } = await client.auth.getSession();
    if (!session) { showLogin(true); status('请登录后连接云端'); return null; }
    await getProfile(session.user);
    // 伙伴端不能复用管理端会话，避免管理账号绕过伙伴登录入口浏览或编辑自评。
    if (document.body.classList.contains('self-review-page') && profile?.role !== 'partner') {
      showLogin(true);
      status('请使用伙伴账号登录');
      return null;
    }
    showLogin(false); return loadState();
  }
  function queueSync(state) { if (readOnly || !remoteHasData || !staff()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => writeState(state).catch((error) => { status('云端同步失败'); console.error(error); }), 600); }
  async function listProfiles() {
    if (!staff()) throw new Error('当前账号没有人员权限管理权限。');
    const [profilesRes, partnersRes] = await Promise.all([client.from('profiles').select('id, email, display_name, role, partner_id, created_at').order('created_at'), client.from('partners').select('id, owner_name, brand, department').order('brand').order('owner_name')]);
    if (profilesRes.error) throw profilesRes.error;
    if (partnersRes.error) throw partnersRes.error;
    return { profiles: profilesRes.data, partners: partnersRes.data };
  }
  async function updateProfile(id, values) {
    if (!staff()) throw new Error('当前账号没有人员权限管理权限。');
    const { error } = await client.from('profiles').update(values).eq('id', id);
    if (error) throw error;
  }
  async function saveReview(owner, values) {
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
    if (!profile) throw new Error('请先登录后提交成果。');
    if (!file) throw new Error('请选择要提交的 Skill 文件。');
    if (file.size > 200 * 1024 * 1024) throw new Error('单个文件最大支持 200MB。');
    if (!partner?.id) throw new Error('请选择对应的伙伴记录。');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'skill-file';
    const path = `${profile.id}/${crypto.randomUUID()}-${safeName}`;
    const bucket = client.storage.from('skill-files');
    const { error: uploadError } = await bucket.upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream' });
    if (uploadError) throw uploadError;
    const { data, error } = await client.from('skill_resources').insert({
      partner_id: partner.id,
      uploaded_by: profile.id,
      title: values.title,
      description: values.description || '',
      file_name: file.name,
      file_path: path,
      mime_type: file.type || null,
      size_bytes: file.size
    }).select().single();
    if (error) {
      await bucket.remove([path]);
      throw error;
    }
    return data;
  }
  async function downloadSkill(resource) {
    const { error: logError } = await client.rpc('record_skill_download', { resource_id: resource.id });
    if (logError) throw logError;
    const { data, error } = await client.storage.from('skill-files').createSignedUrl(resource.file_path, 60);
    if (error) throw error;
    return data.signedUrl;
  }
  async function reviewSkill(id, values) {
    if (!staff()) throw new Error('当前账号没有审核成果的权限。');
    const { error } = await client.from('skill_resources').update({ status: values.status, review_note: values.reviewNote || null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
  // 仅云端完全为空时允许执行一次初始迁移；后续会话一律以云端数据初始化。
  const canBootstrap = () => !readOnly && Boolean(profile) && staff() && !remoteHasData;
  window.DfwsCloud = { init, writeState, queueSync, staff, canBootstrap, listProfiles, updateProfile, saveReview, submitSelfReview, listReviewSubmissions, listSkillResources, uploadSkill, downloadSkill, reviewSkill, get role() { return profile?.role; }, get profile() { return profile; }, readOnly };
})();
