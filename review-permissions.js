// 三方点评按登录角色写入；捕获阶段拦截旧页面的全量保存逻辑。
(function () {
  const allowed = { partner: 'self', manager: 'manager', ai_officer: 'officer' };
  function apply() {
    const role = window.DfwsCloud?.role;
    if (!document.querySelector('#reviews.active')) return;
    [['self', 'self-level'], ['manager', 'manager-level'], ['officer', 'officer-level']].forEach(([prefix, level]) => {
      const enabled = allowed[role] === prefix;
      const text = document.querySelector(`#${prefix}-review`);
      const select = document.querySelector(`#${level}`);
      if (text && text.disabled === enabled) text.disabled = !enabled;
      if (select && select.disabled === enabled) select.disabled = !enabled;
    });
    const save = document.querySelector('#save-review');
    if (save) {
      const enabled = Boolean(allowed[role]);
      const label = enabled ? '保存我的点评' : '当前角色只读';
      if (save.disabled === enabled) save.disabled = !enabled;
      // textContent 会触发 childList；只有实际变化时才写入，避免观察器自我循环。
      if (save.textContent !== label) save.textContent = label;
    }
  }
  const requestApply = () => requestAnimationFrame(apply);
  document.addEventListener('click', async (event) => {
    if (event.target.closest('[data-view="reviews"],#run-review-search')) requestApply();
    const button = event.target.closest('#save-review');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const role = window.DfwsCloud?.role;
    if (!allowed[role]) return;
    const owner = document.querySelector('#review-partner')?.value;
    const values = { self: document.querySelector('#self-review').value, selfLevel: document.querySelector('#self-level').value, manager: document.querySelector('#manager-review').value, managerLevel: document.querySelector('#manager-level').value, officer: document.querySelector('#officer-review').value, officerLevel: document.querySelector('#officer-level').value };
    try { await window.DfwsCloud.saveReview(owner, values); window.location.reload(); } catch (error) { const toast = document.querySelector('#toast'); toast.textContent = error.message || '点评保存失败'; toast.classList.add('show'); window.setTimeout(() => toast.classList.remove('show'), 2200); }
  }, true);
  document.addEventListener('change', (event) => {
    if (event.target.closest('#review-partner')) requestApply();
  });
  document.addEventListener('input', (event) => {
    if (event.target.closest('#review-search')) requestApply();
  });
  apply();
})();
