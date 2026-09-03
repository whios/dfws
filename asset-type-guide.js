// Adds a concise classification guide without changing ledger data or filters.
(() => {
  const render = () => {
    const view = document.querySelector('#assets');
    if (!view || !view.classList.contains('active') || view.querySelector('.asset-type-guide')) return;

    const toolbar = view.querySelector('.toolbar');
    if (!toolbar) return;

    toolbar.insertAdjacentHTML('beforebegin', `
      <details class="asset-type-guide" open>
        <summary>资产类型怎么区分？</summary>
        <p class="asset-type-guide-intro">按实际交付形态归类，不按名称或复杂程度判断。</p>
        <div class="asset-type-guide-grid">
          <article><span class="badge asset-type-badge">Skill</span><strong>完成一件明确的事</strong><p>适合单一任务，例如生成文案、分析客户信息、整理会议纪要。</p></article>
          <article><span class="badge asset-type-badge">智能体</span><strong>会对话、判断和协作的助手</strong><p>能根据上下文追问、判断下一步，并组合多个能力完成工作。</p></article>
          <article><span class="badge asset-type-badge">工作流</span><strong>按固定步骤自动运行</strong><p>适合稳定、重复的流程，例如提交后自动分类、生成、审批与归档。</p></article>
        </div>
        <p class="asset-type-guide-note">简单判断：会做一件事是 Skill；像助手一样协作是智能体；像流水线按步骤执行是工作流。</p>
      </details>
    `);
  };

  new MutationObserver(render).observe(document.querySelector('#assets'), { childList: true });
  document.querySelector('[data-view="assets"]')?.addEventListener('click', () => setTimeout(render));
})();
