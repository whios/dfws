// 来源成果下架后，由数据库触发器同步资产状态，前端只在同步成功后刷新云端状态。
(() => {
  const baseAssetsView = window.assets;
  if (typeof baseAssetsView !== 'function') return;

  window.assets = function assetsWithPublishedSkillActions() {
    baseAssetsView();
    const view = document.querySelector('#assets');
    const formGrid = document.querySelector('#asset-form .form-grid');
    if (formGrid && !formGrid.querySelector('[name="status"]')) {
      const evidenceField = formGrid.querySelector('[name="evidence"]')?.closest('label');
      evidenceField?.insertAdjacentHTML('beforebegin', '<label>核验状态<select name="status"><option>待核验</option><option>通过</option><option>需优化</option><option>补充证据</option><option>停用</option><option>已下架</option></select></label>');
    }
    const decorateLinkedAssets = () => {
      const body = document.querySelector('#asset-body');
      if (!body) return;
      body.querySelectorAll('[data-edit]').forEach((button) => { button.textContent = '核验 / 编辑'; });
      const brand = document.querySelector('#brand-filter').value;
      const type = document.querySelector('#type-filter').value;
      const level = document.querySelector('#level-filter').value;
      const query = document.querySelector('#asset-search').value.toLowerCase();
      let visible = state.assets.filter((asset) => (brand === '全部' || asset.brand === brand) && (type === '全部' || asset.type === type) && (level === '全部' || asset.level === level) && JSON.stringify(asset).toLowerCase().includes(query));
      if (assetScope === 'l3') visible = visible.filter((asset) => asset.level === 'V3' || asset.level === 'V4');
      if (assetScope === 'verified') visible = visible.filter((asset) => asset.level !== 'V0');
      [...body.querySelectorAll('tr')].forEach((row, index) => {
        const asset = visible[index];
        if (!asset?.resourceId) return;
        if (asset.status === '已下架') { row.hidden = true; return; }
        if (row.dataset.assetId === asset.id) return;
        row.dataset.assetId = asset.id;
        const actions = row.querySelector('.asset-actions');
        if (!actions) return;
        actions.innerHTML = window.DfwsCloud?.staff?.()
          ? `<button class="action-link" data-edit="${asset.id}">核验 / 编辑</button><button class="action-link" data-unpublish-skill="${asset.resourceId}">下架</button><button class="action-link danger-action" data-delete-skill="${asset.resourceId}">删除</button>`
          : '<span class="sub">成果自动入账</span>';
      });
    };

    const body = document.querySelector('#asset-body');
    const observer = new MutationObserver(decorateLinkedAssets);
    if (body) observer.observe(body, { childList: true });
    decorateLinkedAssets();

    if (view.dataset.publishedAssetActionsBound === 'true') return;
    view.dataset.publishedAssetActionsBound = 'true';
    view.addEventListener('click', async (event) => {
      const deleteResourceId = event.target.dataset.deleteSkill;
      if (deleteResourceId) {
        const asset = state.assets.find((item) => item.resourceId === deleteResourceId);
        if (!asset || !confirm(`确认永久删除“${asset.name}”吗？关联成果、资产台账、下载明细和文件都会删除，无法恢复。`)) return;
        try {
          event.target.disabled = true;
          event.target.textContent = '正在删除...';
          const result = await window.DfwsCloud.deleteSkillResource(deleteResourceId);
          const remote = await window.DfwsCloud.refreshState();
          if (!remote) throw new Error('删除已提交，但未能刷新云端台账。');
          state = { ...state, ...remote };
          localStorage.setItem(key, JSON.stringify(state));
          dashboard(); window.assets(); verify(); report();
          toast(result.fileCleanupPending ? '成果与资产已删除；文件清理将由管理员复核' : '成果与关联资产已删除');
        } catch (error) {
          event.target.disabled = false;
          event.target.textContent = '删除';
          toast(error.message || '删除失败，请稍后重试');
        }
        return;
      }
      const resourceId = event.target.dataset.unpublishSkill;
      if (!resourceId) return;
      const asset = state.assets.find((item) => item.resourceId === resourceId);
      if (!asset || !confirm(`确认下架“${asset.name}”吗？伙伴端将不再展示和下载，资产台账将同步移出默认视图。`)) return;
      try {
        event.target.disabled = true;
        event.target.textContent = '正在下架...';
        await window.DfwsCloud.reviewSkill(resourceId, { status: 'archived', reviewNote: asset.review || null });
        const remote = await window.DfwsCloud.refreshState();
        if (!remote) throw new Error('下架已提交，但未能刷新云端台账。');
        state = { ...state, ...remote };
        localStorage.setItem(key, JSON.stringify(state));
        dashboard(); window.assets(); verify(); report();
        toast('成果已下架，云端台账已同步更新');
      } catch (error) {
        event.target.disabled = false;
        event.target.textContent = '下架成果';
        toast(error.message || '下架失败，请稍后重试');
      }
    });
  };
})();
