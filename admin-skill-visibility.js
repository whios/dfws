// Keeps administrator-submitted results on the same visibility model as partner submissions.
(() => {
  const scenario = document.querySelector('#admin-skill-scenario');
  const field = scenario?.closest('label');
  if (!field || document.querySelector('#admin-skill-visibility')) return;
  field.insertAdjacentHTML('beforebegin', `<label>可见范围<select id="admin-skill-visibility" required><option value="all_partners">全体伙伴可见</option><option value="brand_only">仅限本品牌伙伴可见</option></select></label><p class="field-hint full">选择“仅限本品牌伙伴可见”后，其他品牌和职能伙伴无法在成果库查看或下载；管理员仍可审核。</p>`);
  const dialog = document.querySelector('#admin-skill-dialog');
  dialog.querySelector('h2').textContent = '管理员代提交成果';
  const evidenceLabel = document.querySelector('#admin-skill-evidence')?.closest('label');
  if (evidenceLabel?.firstChild) evidenceLabel.firstChild.nodeValue = 'AI 对话的详细操作步骤（链接）';
  const guideLabel = document.querySelector('#admin-skill-guide-in-evidence')?.closest('label');
  if (guideLabel?.querySelector('span')) guideLabel.querySelector('span').textContent = '附件或 AI 对话中已包含完整操作步骤，可供同伴照着使用。';
})();
