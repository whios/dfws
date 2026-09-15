// Brand administrators receive only cross-brand aggregate counts, never other brands' resource details.
(() => {
  const originalDashboard = window.dashboard;
  if (typeof originalDashboard !== 'function') return;
  window.dashboard = function dashboardWithGlobalReviewProgress() {
    originalDashboard();
    const progress = window.DfwsBrandReviewProgress;
    if (!Array.isArray(progress) || !progress.length) return;
    const dashboard = document.querySelector('#dashboard');
    const head = [...dashboard.querySelectorAll('.section-head')].find((item) => item.querySelector('h2')?.textContent.includes('审核进度'));
    const card = head?.closest('article');
    if (!card) return;
    head.querySelector('h2').textContent = '品牌审核进度';
    head.querySelector('p').textContent = '按全公司实际提交成果计算';
    card.querySelectorAll('.brand-row').forEach((item) => item.remove());
    card.insertAdjacentHTML('beforeend', progress.map((item) => {
      const total = Number(item.total) || 0;
      const reviewed = Number(item.reviewed) || 0;
      return `<div class="brand-row"><strong>${item.brand}</strong><div class="bar"><span style="width:${total ? reviewed / total * 100 : 0}%"></span></div><div class="bar-count">${reviewed} / ${total} 已审核</div></div>`;
    }).join(''));
  };
})();
