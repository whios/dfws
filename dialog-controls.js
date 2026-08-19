// 取消和关闭属于退出动作，必须先于表单必填校验执行。
document.addEventListener('click', (event) => {
  const cancel = event.target.closest('dialog button[value="cancel"]');
  if (!cancel) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancel.closest('dialog')?.close('cancel');
}, true);
