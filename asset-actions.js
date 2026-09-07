// 资产台账只展示成果发布状态；发布、退回、下架均在成果审核与发布中处理。
(() => {
  const baseAssetsView = window.assets;
  if (typeof baseAssetsView !== 'function') return;

  window.assets = function assetsWithUnifiedPublicationStatus() {
    baseAssetsView();
    const view = document.querySelector('#assets');
    if (!view) return;

    const title = view.querySelector('.scope-banner strong');
    if (title?.textContent.trim() === '全部资产台账') title.textContent = '资产台账';
    const copy = view.querySelector('.scope-banner span');
    if (copy) copy.textContent = '已关联成果的发布状态与“成果审核与发布”实时同步；V1/V2 仅表示资产可用性，不影响是否发布。';

    const heading = [...view.querySelectorAll('th')].find((cell) => cell.textContent.trim() === '状态');
    if (heading) heading.textContent = '发布状态';
    const levelHeading = [...view.querySelectorAll('th')].find((cell) => cell.textContent.trim() === '等级');
    if (levelHeading) levelHeading.textContent = '可用等级';

    const decorateRows = () => {
      const body = view.querySelector('#asset-body');
      if (!body) return;
      const brand = view.querySelector('#brand-filter')?.value || '全部';
      const type = view.querySelector('#type-filter')?.value || '全部';
      const level = view.querySelector('#level-filter')?.value || '全部';
      const query = (view.querySelector('#asset-search')?.value || '').toLowerCase();
      let visible = state.assets.filter((asset) => (brand === '全部' || asset.brand === brand) && (type === '全部' || asset.type === type) && (level === '全部' || asset.level === level) && JSON.stringify(asset).toLowerCase().includes(query));
      if (assetScope === 'l3') visible = visible.filter((asset) => asset.level === 'V3' || asset.level === 'V4');
      if (assetScope === 'verified') visible = visible.filter((asset) => asset.level !== 'V0');

      [...body.querySelectorAll('tr')].forEach((row, index) => {
        const asset = visible[index];
        if (!asset?.resourceId) return;
        const statusCell = row.cells[8];
        if (statusCell && row.dataset.unifiedStatus !== asset.status) {
          row.dataset.unifiedStatus = asset.status;
          statusCell.innerHTML = `<span class="badge ${asset.sourceStatus === 'published' ? 'v3' : asset.sourceStatus === 'rejected' ? 'high' : asset.sourceStatus === 'archived' ? 'v0' : 'v1'}">${esc(asset.status)}</span><br><span class="sub">同步自成果审核</span>`;
        }
        const actions = row.querySelector('.asset-actions');
        if (!actions || row.dataset.unifiedActions === asset.id) return;
        row.dataset.unifiedActions = asset.id;
        actions.innerHTML = window.DfwsCloud?.staff?.()
          ? `<button class="action-link" data-view-source="${asset.resourceId}">查看成果</button><button class="action-link" data-unpublish-skill="${asset.resourceId}">下架</button><button class="action-link danger-action" data-delete-skill="${asset.resourceId}">删除</button>`
          : '<span class="sub">发布状态由成果审核同步</span>';
      });
    };

    const body = view.querySelector('#asset-body');
    const observer = new MutationObserver(decorateRows);
    if (body) observer.observe(body, { childList: true });
    decorateRows();

    if (view.dataset.unifiedPublicationActionsBound === 'true') return;
    view.dataset.unifiedPublicationActionsBound = 'true';
    view.addEventListener('click', async (event) => {
      const sourceId = event.target.dataset.viewSource;
      if (sourceId) {
        window.DfwsSkillFilters = { resourceId: sourceId };
        document.querySelector('[data-view="skills"]')?.click();
        return;
      }
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
          dashboard(); window.assets(); report();
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
      if (!asset || !confirm(`确认下架“${asset.name}”吗？伙伴端将不再展示和下载，资产台账会同步显示“已下架”。`)) return;
      try {
        event.target.disabled = true;
        event.target.textContent = '正在下架...';
        await window.DfwsCloud.reviewSkill(resourceId, { status: 'archived', reviewNote: asset.review || null });
        const remote = await window.DfwsCloud.refreshState();
        if (!remote) throw new Error('下架已提交，但未能刷新云端台账。');
        state = { ...state, ...remote };
        localStorage.setItem(key, JSON.stringify(state));
        dashboard(); window.assets(); report();
        toast('成果已下架，资产台账状态已同步');
      } catch (error) {
        event.target.disabled = false;
        event.target.textContent = '下架';
        toast(error.message || '下架失败，请稍后重试');
      }
    });
  };
})();
