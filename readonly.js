// 无登录公开模式下阻止旧页面控件修改浏览器状态，避免误以为已保存到云端。
(function () {
  if (!window.DfwsCloud?.readOnly) return;
  const locked = '[data-edit],#add-asset,#save-verify,#save-review,#add-risk,[data-close],#reset-demo,#asset-submit,[data-drill],[data-go]';
  // 公开阶段只保留领导查看所需的总览与汇报入口。
  document.querySelectorAll('.nav-item').forEach((item) => { if (!['dashboard', 'report'].includes(item.dataset.view)) item.hidden = true; });
  document.querySelector('#reset-demo').hidden = true;
  document.querySelector('#save-state').hidden = true;
  document.addEventListener('click', (event) => {
    if (!window.DfwsCloud?.readOnly || !event.target.closest(locked)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const toast = document.querySelector('#toast');
    toast.textContent = '当前为云端只读，禁止修改';
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2200);
  }, true);
  document.addEventListener('submit', (event) => {
    if (window.DfwsCloud?.readOnly) event.preventDefault();
  }, true);
  const state = document.querySelector('#cloud-state');
  new MutationObserver(() => { if (window.DfwsCloud?.readOnly && state.textContent !== '云端只读') state.textContent = '云端只读'; }).observe(state, { childList: true, characterData: true, subtree: true });
})();
