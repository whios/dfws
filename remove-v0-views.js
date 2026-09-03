// V0 described an unverified declaration and is no longer part of the managed
// asset maturity view. Historical records remain untouched in cloud data.
(() => {
  const removeV0 = () => {
    document.querySelectorAll('select option[value="V0"]').forEach((option) => option.remove());
    document.querySelectorAll('#dashboard .brand-row').forEach((row) => {
      if (row.querySelector('.badge.v0')?.textContent.trim() === 'V0') row.remove();
    });
    const notes = document.querySelector('#dashboard .level-note');
    if (notes) {
      const summary = notes.querySelector('summary');
      // This runs from a MutationObserver, so avoid writing the same text on
      // every callback. Replacing textContent unconditionally retriggers the
      // observer and can leave the management page in a render loop.
      if (summary && summary.textContent !== 'V1-V4 成果成熟度说明') {
        summary.textContent = 'V1-V4 成果成熟度说明';
      }
      notes.querySelectorAll('div').forEach((item) => { if (item.querySelector('.badge.v0')) item.remove(); });
    }
  };
  new MutationObserver(removeV0).observe(document.querySelector('#dashboard'), { childList: true, subtree: true });
  new MutationObserver(removeV0).observe(document.querySelector('#assets'), { childList: true, subtree: true });
  removeV0();
})();
