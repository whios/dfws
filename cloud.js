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
  // 临时公开看板模式：云端数据可匿名读取，所有写入必须保持关闭。
  const readOnly = true;
  let profile = null;
  let remoteHasData = false;
  let syncTimer = null;
  const appOrigin = window.location.origin;
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
    document.querySelector('#account-state').textContent = `${data.display_name || data.email} · ${roleLabel(data.role)}`;
    status('已连接云端');
  }

  async function loadState() {
    const [partnersRes, assetsRes, risksRes, reviewsRes] = await Promise.all([
      client.from('partners').select('*').order('brand').order('owner_name'), client.from('assets').select('*').order('created_at'),
      client.from('risks').select('*').order('due_date'), readOnly ? Promise.resolve({ data: [], error: null }) : client.from('reviews').select('*')
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
    if (readOnly) {
      showLogin(false);
      document.querySelector('#sign-out').hidden = true;
      document.querySelector('#account-state').hidden = true;
      status('云端只读');
      return loadState();
    }
    // 邮件链接回到页面时，SDK 写入 session 后刷新为无 token 的地址，再由下方 getSession 完成加载。
    client.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN' && session && !profile) window.setTimeout(() => window.location.replace(window.location.pathname), 0); });
    document.querySelector('#auth-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const email = document.querySelector('#auth-email').value.trim(); const submit = document.querySelector('#auth-submit'); submit.disabled = true; const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: appOrigin } }); submit.disabled = false; document.querySelector('#auth-message').textContent = error ? error.message : '登录链接已发送，请在邮箱中打开。'; });
    document.querySelector('#sign-out')?.addEventListener('click', async () => { await client.auth.signOut(); window.location.reload(); });
    const { data: { session } } = await client.auth.getSession();
    if (!session) { showLogin(true); status('请登录后连接云端'); return null; }
    await getProfile(session.user); showLogin(false); return loadState();
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
  // 仅云端完全为空时允许执行一次初始迁移；后续会话一律以云端数据初始化。
  const canBootstrap = () => !readOnly && Boolean(profile) && staff() && !remoteHasData;
  window.DfwsCloud = { init, writeState, queueSync, staff, canBootstrap, listProfiles, updateProfile, readOnly };
})();
