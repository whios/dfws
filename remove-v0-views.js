// The current management scope only uses V1 and V2. Historical V0, V3 and V4
// records remain untouched in cloud data, but are not shown in the UI.
(() => {
  const hiddenLevels = new Set(['V0', 'V3', 'V4']);
  const removeHiddenLevels = () => {
    document.querySelectorAll('select option').forEach((option) => {
      if (hiddenLevels.has(option.value) || hiddenLevels.has(option.textContent.trim())) option.remove();
    });
    document.querySelectorAll('#dashboard .brand-row').forEach((row) => {
      if (hiddenLevels.has(row.querySelector('.badge')?.textContent.trim())) row.remove();
    });
    document.querySelectorAll('#asset-body tr').forEach((row) => {
      if (hiddenLevels.has(row.querySelector('.badge')?.textContent.trim())) row.remove();
    });
    const notes = document.querySelector('#dashboard .level-note');
    if (notes) {
      const summary = notes.querySelector('summary');
      // This runs from a MutationObserver, so avoid writing the same text on
      // every callback. Replacing textContent unconditionally retriggers the
      // observer and can leave the management page in a render loop.
      if (summary && summary.textContent !== 'V1-V2 成果核验等级说明') {
        summary.textContent = 'V1-V2 成果核验等级说明';
      }
      notes.querySelectorAll('div').forEach((item) => { if (hiddenLevels.has(item.querySelector('.badge')?.textContent.trim())) item.remove(); });
    }
  };
  new MutationObserver(removeHiddenLevels).observe(document.querySelector('#dashboard'), { childList: true, subtree: true });
  new MutationObserver(removeHiddenLevels).observe(document.querySelector('#assets'), { childList: true, subtree: true });
  removeHiddenLevels();
})();
