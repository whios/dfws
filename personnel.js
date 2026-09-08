// 人员入口统一维护账号、角色与伙伴档案；创建登录账号由受保护的服务端接口执行。
function permissions() {
  const view = $('#permissions');
  if (!window.DfwsCloud?.staff()) { view.innerHTML = '<div class="empty">仅 AI 应用官、负责人和品牌管理员可管理人员权限。</div>'; return; }
  const roles = [['partner', '伙伴'], ['manager', '负责人'], ['brand_admin', '品牌管理员'], ['ai_officer', 'AI 应用官'], ['leader', '领导只读']];
  const roleName = new Map(roles);
  view.innerHTML = `
    <div class="toolbar"><div><strong>人员与权限</strong><div class="sub personnel-intro">统一维护账号、角色和伙伴档案；邀请后由伙伴自行设置密码。</div></div><span style="flex:1"></span><button class="button secondary" id="refresh-profiles">刷新</button><button class="button secondary" id="organization-directory">组织通讯录</button><button class="button primary" id="add-person">新增人员</button></div>
    <div id="permission-kpis" class="permission-kpis"></div>
    <div class="toolbar"><input id="profile-search" placeholder="搜索姓名、邮箱、品牌或部门" /><select id="profile-brand"><option value="">全部品牌</option></select><select id="profile-role"><option value="">全部角色</option></select><select id="profile-binding"><option value="">全部绑定状态</option><option value="bound">已绑定伙伴</option><option value="unbound">待绑定</option><option value="conflict">绑定冲突</option></select><span class="sub" id="profile-count"></span></div>
    <article class="card table-wrap"><table class="table permission-table"><thead><tr><th>账号</th><th>品牌 / 部门</th><th>当前角色</th><th>绑定伙伴</th><th>状态</th><th></th></tr></thead><tbody id="profile-body"><tr><td colspan="6" class="empty">正在加载账号...</td></tr></tbody></table></article>
    <dialog id="partner-picker-dialog" class="dialog"><form method="dialog"><header><h2>选择绑定伙伴</h2><button class="icon-button" value="cancel" aria-label="关闭">x</button></header><div class="toolbar partner-picker-tools"><select id="partner-picker-brand"><option value="">全部品牌</option></select><input id="partner-picker-search" placeholder="搜索姓名或部门" /><span class="sub" id="partner-picker-count"></span></div><div class="partner-picker-list" id="partner-picker-list"></div><footer><button value="cancel" class="button secondary">取消</button></footer></form></dialog>
    <dialog id="person-dialog" class="dialog"><form id="person-form"><header><h2>新增人员并发送邀请</h2><button class="icon-button" type="button" data-close-person aria-label="关闭">x</button></header><p class="sub">系统会创建账号、设置角色和绑定关系，再发送“设置密码”邮件。</p><div class="form-grid"><label>姓名<input id="person-name" required maxlength="40" placeholder="例如：曹沁" /></label><label>公司邮箱<input id="person-email" required type="email" placeholder="name@dfwsgroup.com" /></label><label>角色<select id="person-role">${roles.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>伙伴档案<select id="person-bind-mode"><option value="existing">绑定已有伙伴记录</option><option value="new">新建伙伴记录并绑定</option><option value="none">暂不绑定伙伴记录</option></select></label></div><div id="person-existing" class="personnel-existing"><label class="sub" for="person-partner">选择已有伙伴</label><select id="person-partner"></select></div><div id="person-new" class="form-grid" hidden><label>品牌<select id="person-brand"></select></label><label>部门<input id="person-department" placeholder="例如：新闻部" /></label></div><p class="personnel-form-note" id="person-form-note">创建后会立即发送设置密码邮件。伙伴角色绑定成功后，只能查看和提交自己的数据。</p><footer><button class="button secondary" type="button" data-close-person>取消</button><button class="button primary" id="person-submit" type="submit">创建并发送邀请</button></footer></form></dialog>
    <dialog id="organization-dialog" class="dialog organization-dialog"><header><div><h2>组织通讯录</h2><p class="sub">部门和人员在系统内维护。选择一个部门后可先预览，再向未开通的伙伴发送邀请。</p></div><button class="icon-button" type="button" data-close-organization aria-label="关闭">x</button></header><div class="organization-layout"><section class="organization-tree-panel"><div class="organization-panel-head"><strong>组织架构</strong><button class="action-link" type="button" id="add-organization-unit">新增部门</button></div><div class="organization-tree" id="organization-tree"><div class="empty">正在读取组织通讯录...</div></div></section><section class="organization-members-panel"><div class="organization-panel-head"><div><strong id="organization-unit-title">选择部门</strong><span class="sub" id="organization-unit-summary"></span></div><div class="organization-panel-actions"><button class="action-link" type="button" id="add-organization-person">新增人员</button><button class="button primary" type="button" id="invite-organization-unit" disabled>预览并发送邀请</button></div></div><div class="organization-member-list" id="organization-member-list"><div class="empty">请选择左侧部门查看人员。</div></div></section></div><footer><button class="button secondary" type="button" data-close-organization>关闭</button></footer></dialog>
    <dialog id="organization-unit-dialog" class="dialog"><form id="organization-unit-form"><header><h2>新增部门</h2><button class="icon-button" type="button" data-close-organization-unit aria-label="关闭">x</button></header><div class="form-grid"><label>部门名称<input id="organization-unit-name" required maxlength="60" /></label><label>上级部门<select id="organization-unit-parent"><option value="">作为一级部门</option></select></label><label>所属品牌（选填）<select id="organization-unit-brand"><option value="">未设置</option><option>迈点</option><option>最佳东方</option><option>乔邦</option><option>先之</option><option>技术中心</option><option>职能</option></select></label></div><footer><button class="button secondary" type="button" data-close-organization-unit>取消</button><button class="button primary" type="submit">保存部门</button></footer></form></dialog>
    <dialog id="organization-person-dialog" class="dialog"><form id="organization-person-form"><header><h2>新增通讯录人员</h2><button class="icon-button" type="button" data-close-organization-person aria-label="关闭">x</button></header><p class="sub">只有已绑定伙伴档案的人员才会进入邀请预览，避免误创建或覆盖历史数据。</p><div class="form-grid"><label>姓名<input id="organization-person-name" required maxlength="40" /></label><label>公司邮箱<input id="organization-person-email" required type="email" /></label><label class="full">归属部门（可多选）<select id="organization-person-units" multiple size="7"></select></label><label class="full">绑定已有伙伴档案<select id="organization-person-partner"><option value="">暂不绑定</option></select></label></div><footer><button class="button secondary" type="button" data-close-organization-person>取消</button><button class="button primary" type="submit">保存人员</button></footer></form></dialog>`;

  let data = null;
  let pickerProfileId = null;
  let organization = null;
  let selectedOrganizationUnitId = null;
  const partnerOption = (partner) => `<option value="${esc(partner.id)}">${esc(partner.owner_name)} · ${esc(partner.brand)} · ${esc(partner.department)}</option>`;
  const orgUnitLabel = (unit) => `${unit.name}${unit.brand ? ` · ${unit.brand}` : ''}`;
  const organizationMembersFor = (unitId, includeChildren = true) => {
    const childIds = new Set([unitId]);
    if (includeChildren) {
      let changed = true;
      while (changed) { changed = false; (organization?.units || []).forEach((unit) => { if (unit.parent_id && childIds.has(unit.parent_id) && !childIds.has(unit.id)) { childIds.add(unit.id); changed = true; } }); }
    }
    const personIds = new Set((organization?.memberships || []).filter((membership) => childIds.has(membership.unit_id)).map((membership) => membership.person_id));
    return (organization?.people || []).filter((person) => personIds.has(person.id));
  };
  const organizationStatus = (person) => {
    const opened = (organization?.profiles || []).some((profile) => String(profile.email || '').toLowerCase() === String(person.email || '').toLowerCase());
    if (opened) return ['已开通', '账号已存在'];
    if (!person.partner_id) return ['待绑定', '请先绑定伙伴档案'];
    const bound = (organization?.profiles || []).some((profile) => profile.partner_id === person.partner_id);
    return bound ? ['已开通', '伙伴已绑定账号'] : ['可邀请', '将发送设置密码邮件'];
  };
  const renderOrganization = () => {
    const units = organization?.units || [];
    const children = new Map();
    units.forEach((unit) => { const key = unit.parent_id || 'root'; children.set(key, [...(children.get(key) || []), unit]); });
    const renderUnit = (unit, depth = 0) => {
      const descendantPeople = organizationMembersFor(unit.id).length;
      const next = (children.get(unit.id) || []).map((child) => renderUnit(child, depth + 1)).join('');
      return `<div class="organization-tree-node"><button class="organization-unit-button ${selectedOrganizationUnitId === unit.id ? 'selected' : ''}" type="button" data-organization-unit="${unit.id}" style="--tree-depth:${depth}"><span>${next ? '▾' : '•'}</span><strong>${esc(unit.name)}</strong><small>${descendantPeople}</small></button>${next}</div>`;
    };
    $('#organization-tree').innerHTML = (children.get('root') || []).map((unit) => renderUnit(unit)).join('') || '<div class="empty">尚未建立组织部门。</div>';
    $('#organization-unit-parent').innerHTML = `<option value="">作为一级部门</option>${units.map((unit) => `<option value="${unit.id}">${esc(orgUnitLabel(unit))}</option>`).join('')}`;
    $('#organization-person-units').innerHTML = units.map((unit) => `<option value="${unit.id}">${esc(orgUnitLabel(unit))}</option>`).join('');
    $('#organization-person-partner').innerHTML = `<option value="">暂不绑定</option>${(organization?.partners || []).map(partnerOption).join('')}`;
    const unit = units.find((item) => item.id === selectedOrganizationUnitId);
    const people = unit ? organizationMembersFor(unit.id) : [];
    $('#organization-unit-title').textContent = unit ? unit.name : '选择部门';
    $('#organization-unit-summary').textContent = unit ? `含下级部门共 ${people.length} 人` : '';
    $('#invite-organization-unit').disabled = !people.length;
    $('#organization-member-list').innerHTML = unit ? people.map((person) => { const [state, note] = organizationStatus(person); return `<article class="organization-person-row"><div><strong>${esc(person.display_name)}</strong><span>${esc(person.email)}</span></div><div><span class="badge ${state === '可邀请' ? 'v3' : state === '待绑定' ? 'v0' : ''}">${state}</span><small>${esc(note)}</small></div></article>`; }).join('') || '<div class="empty">该部门及下级部门暂无人员。</div>' : '<div class="empty">请选择左侧部门查看人员。</div>';
  };
  const loadOrganization = async () => { organization = await window.DfwsCloud.organizationDirectory(); renderOrganization(); };
  const setCreateMode = () => {
    const mode = $('#person-bind-mode').value;
    $('#person-existing').hidden = mode !== 'existing';
    $('#person-new').hidden = mode !== 'new';
    $('#person-form-note').textContent = mode === 'none'
      ? '账号会创建并发送设置密码邮件，但不会获得伙伴端提交权限，后续可在列表中补充绑定。'
      : '创建后会立即发送设置密码邮件。伙伴角色绑定成功后，只能查看和提交自己的数据。';
  };
  const load = async () => {
    try {
      data = await window.DfwsCloud.listProfiles();
      const partnersById = new Map(data.partners.map((partner) => [partner.id, partner]));
      const bindingCounts = new Map();
      data.profiles.forEach((profile) => { if (profile.partner_id) bindingCounts.set(profile.partner_id, (bindingCounts.get(profile.partner_id) || 0) + 1); });
      const brands = [...new Set(data.partners.map((partner) => partner.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const brandOptions = `<option value="">全部品牌</option>${brands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('')}`;
      $('#profile-brand').innerHTML = brandOptions;
      $('#profile-role').innerHTML = `<option value="">全部角色</option>${roles.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}`;
      $('#partner-picker-brand').innerHTML = brandOptions;
      $('#person-partner').innerHTML = `<option value="">请选择伙伴记录</option>${data.partners.map(partnerOption).join('')}`;
      $('#person-brand').innerHTML = brands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('');
      const bound = data.profiles.filter((profile) => profile.partner_id).length;
      const conflicts = [...bindingCounts.values()].filter((count) => count > 1).length;
      $('#permission-kpis').innerHTML = [['账号总数', data.profiles.length, '已进入系统的账号'], ['已绑定', bound, '已关联伙伴记录'], ['待绑定', data.profiles.length - bound, '需补齐伙伴关系'], ['绑定冲突', conflicts, '同一伙伴被多账号绑定']].map(([label, value, hint]) => `<article class="card permission-kpi"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
      const render = () => {
        const query = $('#profile-search').value.trim().toLowerCase();
        const brand = $('#profile-brand').value;
        const role = $('#profile-role').value;
        const binding = $('#profile-binding').value;
        const rows = data.profiles.map((profile) => ({ ...profile, partner: partnersById.get(profile.partner_id) })).filter((profile) => {
          const conflict = profile.partner_id && bindingCounts.get(profile.partner_id) > 1;
          const text = `${profile.display_name || ''}${profile.email || ''}${profile.partner?.owner_name || ''}${profile.partner?.brand || ''}${profile.partner?.department || ''}`.toLowerCase();
          return (!query || text.includes(query)) && (!brand || profile.partner?.brand === brand) && (!role || profile.role === role) && (!binding || (binding === 'bound' && profile.partner_id) || (binding === 'unbound' && !profile.partner_id) || (binding === 'conflict' && conflict));
        });
        $('#profile-count').textContent = `当前显示 ${rows.length} / ${data.profiles.length} 个账号`;
        $('#profile-body').innerHTML = rows.map((profile) => {
          const conflict = profile.partner_id && bindingCounts.get(profile.partner_id) > 1;
          const status = conflict ? '绑定冲突' : profile.partner_id ? '已绑定' : '待绑定';
          const partnerLabel = profile.partner ? `${profile.partner.owner_name} · ${profile.partner.brand} · ${profile.partner.department}` : '未绑定伙伴';
          return `<tr><td><strong>${esc(profile.display_name || '未命名')}</strong><br><span class="sub">${esc(profile.email)}</span></td><td>${profile.partner ? `${esc(profile.partner.brand)}<br><span class="sub">${esc(profile.partner.department)}</span>` : '<span class="sub">未关联</span>'}</td><td><select data-role="${profile.id}">${roles.map(([value, label]) => `<option value="${value}" ${profile.role === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td><input type="hidden" data-partner="${profile.id}" value="${esc(profile.partner_id || '')}" /><span class="partner-binding" data-partner-label="${profile.id}">${esc(partnerLabel)}</span><div class="partner-binding-actions"><button class="action-link" data-pick-partner="${profile.id}">选择伙伴</button>${profile.partner_id ? `<button class="action-link muted-action" data-clear-partner="${profile.id}">取消绑定</button>` : ''}</div></td><td><span class="badge ${conflict ? 'high' : profile.partner_id ? 'v3' : 'v0'}">${status}</span><br><span class="sub">${roleName.get(profile.role) || '未设置角色'}</span></td><td><button class="action-link" data-save-profile="${profile.id}">保存</button><button class="action-link" data-send-password-setup="${profile.id}">重新发送设置密码邮件</button></td></tr>`;
        }).join('') || '<tr><td colspan="6" class="empty">未找到匹配账号</td></tr>';
      };
      const renderPicker = () => {
        const query = $('#partner-picker-search').value.trim().toLowerCase();
        const brand = $('#partner-picker-brand').value;
        const currentId = $(`[data-partner="${pickerProfileId}"]`)?.value || '';
        const list = data.partners.filter((partner) => (!brand || partner.brand === brand) && (!query || `${partner.owner_name}${partner.brand}${partner.department}`.toLowerCase().includes(query)));
        $('#partner-picker-count').textContent = `${list.length} 位伙伴`;
        $('#partner-picker-list').innerHTML = list.map((partner) => `<button type="button" class="partner-picker-item ${partner.id === currentId ? 'selected' : ''}" data-use-partner="${partner.id}"><strong>${esc(partner.owner_name)}</strong><span>${esc(partner.brand)} · ${esc(partner.department)}</span></button>`).join('') || '<div class="empty">未找到匹配伙伴</div>';
      };
      ['profile-search', 'profile-brand', 'profile-role', 'profile-binding'].forEach((id) => $('#'+id).addEventListener(id === 'profile-search' ? 'input' : 'change', render));
      $('#partner-picker-brand').onchange = renderPicker;
      $('#partner-picker-search').oninput = renderPicker;
      view.onclick = async (event) => {
        const pickProfile = event.target.dataset.pickPartner;
        if (pickProfile) { pickerProfileId = pickProfile; const current = partnersById.get($(`[data-partner="${pickProfile}"]`).value); $('#partner-picker-brand').value = current?.brand || ''; $('#partner-picker-search').value = ''; renderPicker(); $('#partner-picker-dialog').showModal(); return; }
        const pickedPartner = event.target.dataset.usePartner;
        if (pickedPartner) { const partner = partnersById.get(pickedPartner); $(`[data-partner="${pickerProfileId}"]`).value = pickedPartner; $(`[data-partner-label="${pickerProfileId}"]`).textContent = `${partner.owner_name} · ${partner.brand} · ${partner.department}`; $('#partner-picker-dialog').close(); return; }
        const clearProfile = event.target.dataset.clearPartner;
        if (clearProfile) { $(`[data-partner="${clearProfile}"]`).value = ''; $(`[data-partner-label="${clearProfile}"]`).textContent = '未绑定伙伴'; return; }
        const passwordSetupProfile = event.target.dataset.sendPasswordSetup;
        if (passwordSetupProfile) {
          const profile = data.profiles.find((item) => item.id === passwordSetupProfile);
          if (!profile || !confirm(`确认向 ${profile.email} 重新发送设置密码邮件？`)) return;
          try { event.target.disabled = true; event.target.textContent = '正在发送...'; const result = await window.DfwsCloud.sendPasswordSetupEmail(passwordSetupProfile); toast(result.message || '设置密码邮件已发送'); }
          catch (error) { toast(error.message || '设置密码邮件发送失败'); }
          finally { event.target.disabled = false; event.target.textContent = '重新发送设置密码邮件'; }
          return;
        }
        const saveProfile = event.target.dataset.saveProfile;
        if (!saveProfile) return;
        try { await window.DfwsCloud.updateProfile(saveProfile, { role: $(`[data-role="${saveProfile}"]`).value, partner_id: $(`[data-partner="${saveProfile}"]`).value || null }); toast('权限已更新，已同步云端数据'); await load(); } catch (error) { toast(error.message || '权限更新失败'); }
      };
      render();
    } catch (error) { $('#profile-body').innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message || '加载失败')}</td></tr>`; }
  };
  $('#add-person').onclick = () => { $('#person-form').reset(); $('#person-bind-mode').value = 'existing'; setCreateMode(); $('#person-dialog').showModal(); };
  $('#organization-directory').onclick = async () => {
    $('#organization-dialog').showModal();
    $('#organization-tree').innerHTML = '<div class="empty">正在读取组织通讯录...</div>';
    try { await loadOrganization(); }
    catch (error) { $('#organization-tree').innerHTML = `<div class="empty">${esc(error.message || '组织通讯录加载失败')}</div>`; }
  };
  $('#refresh-profiles').onclick = load;
  $('#person-bind-mode').onchange = setCreateMode;
  $('#person-partner').onchange = () => {
    const partner = data?.partners.find((item) => item.id === $('#person-partner').value);
    if (partner) $('#person-name').value = partner.owner_name;
  };
  $$('[data-close-person]').forEach((button) => button.onclick = () => $('#person-dialog').close());
  $$('[data-close-organization]').forEach((button) => button.onclick = () => $('#organization-dialog').close());
  $$('[data-close-organization-unit]').forEach((button) => button.onclick = () => $('#organization-unit-dialog').close());
  $$('[data-close-organization-person]').forEach((button) => button.onclick = () => $('#organization-person-dialog').close());
  $('#organization-tree').onclick = (event) => {
    const unitId = event.target.closest('[data-organization-unit]')?.dataset.organizationUnit;
    if (!unitId) return;
    selectedOrganizationUnitId = unitId; renderOrganization();
  };
  $('#add-organization-unit').onclick = () => { $('#organization-unit-form').reset(); $('#organization-unit-parent').value = selectedOrganizationUnitId || ''; $('#organization-unit-dialog').showModal(); };
  $('#add-organization-person').onclick = () => { $('#organization-person-form').reset(); renderOrganization(); if (selectedOrganizationUnitId) $('#organization-person-units').value = selectedOrganizationUnitId; $('#organization-person-dialog').showModal(); };
  $('#organization-unit-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await window.DfwsCloud.saveOrganizationDirectory({ action: 'create_unit', name: $('#organization-unit-name').value.trim(), parentId: $('#organization-unit-parent').value, brand: $('#organization-unit-brand').value });
      $('#organization-unit-dialog').close(); await loadOrganization(); toast('部门已添加到组织通讯录');
    } catch (error) { toast(error.message || '部门保存失败'); }
  };
  $('#organization-person-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await window.DfwsCloud.saveOrganizationDirectory({ action: 'save_person', displayName: $('#organization-person-name').value.trim(), email: $('#organization-person-email').value.trim(), partnerId: $('#organization-person-partner').value, unitIds: [...$('#organization-person-units').selectedOptions].map((item) => item.value) });
      $('#organization-person-dialog').close(); await loadOrganization(); toast('人员已加入组织通讯录');
    } catch (error) { toast(error.message || '人员保存失败'); }
  };
  $('#invite-organization-unit').onclick = async () => {
    const people = organizationMembersFor(selectedOrganizationUnitId).filter((person) => organizationStatus(person)[0] === '可邀请');
    if (!people.length) { toast('该部门没有可安全邀请的人员，请先补齐伙伴绑定。'); return; }
    if (!confirm(`确认向 ${people.length} 位未开通伙伴发送设置密码邮件？已开通、待绑定人员不会发送。`)) return;
    const button = $('#invite-organization-unit');
    try {
      button.disabled = true; button.textContent = '正在发送...';
      const result = await window.DfwsCloud.inviteOrganizationMembers(people.map((person) => person.id));
      toast(`邀请完成：已发送 ${result.invited} 人，跳过 ${result.skipped} 人，失败 ${result.failed} 人`);
      await Promise.all([loadOrganization(), load()]);
    } catch (error) { toast(error.message || '批量邀请失败'); }
    finally { button.textContent = '预览并发送邀请'; }
  };
  $('#person-form').onsubmit = async (event) => {
    event.preventDefault();
    const mode = $('#person-bind-mode').value;
    const name = $('#person-name').value.trim();
    const partnerId = mode === 'existing' ? $('#person-partner').value : null;
    if (mode === 'existing' && !partnerId) { toast('请选择要绑定的伙伴记录'); return; }
    const button = $('#person-submit');
    try {
      button.disabled = true; button.textContent = '正在创建...';
      const result = await window.DfwsCloud.inviteMember({ displayName: name, email: $('#person-email').value.trim(), role: $('#person-role').value, partnerId, newPartner: mode === 'new' ? { ownerName: name, brand: $('#person-brand').value, department: $('#person-department').value.trim() } : null });
      $('#person-dialog').close(); toast(result.message || '邀请已发送'); await load();
    } catch (error) { toast(error.message || '新增人员失败'); }
    finally { button.disabled = false; button.textContent = '创建并发送邀请'; }
  };
  load();
}
