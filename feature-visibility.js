// 暂时下架不删除数据：仅移除入口，并阻止从总览跳转到风险整改。
(() => {
  const disabledViews = new Set(['reviews', 'risks', 'report']);
  document.querySelectorAll('#nav [data-view]').forEach((item) => {
    if (disabledViews.has(item.dataset.view)) item.remove();
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-view], [data-go], [data-drill]');
    if (!target) return;
    if (disabledViews.has(target.dataset.view) || target.dataset.go === 'risks' || target.dataset.drill === 'high') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  const hideRiskContent = () => {
    document.querySelector('[data-drill="high"]')?.remove();
    document.querySelectorAll('#dashboard .section-head').forEach((head) => {
      if (head.querySelector('h2')?.textContent.trim() === '待整改') {
        const card = head.closest('article');
        card?.parentElement?.classList.add('dashboard-single-column');
        card?.remove();
      }
    });
  };
  new MutationObserver(hideRiskContent).observe(document.querySelector('#dashboard'), { childList: true, subtree: true });
  hideRiskContent();
})();
