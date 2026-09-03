// Periodic effect evaluation is intentionally separate from approval status.
(() => {
  const $ = (selector) => document.querySelector(selector);
  let resources = [];
  let campaigns = [];
  const dateValue = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const ensureDialog = () => {
    if ($('#evaluation-campaign-dialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="evaluation-campaign-dialog" class="dialog"><form id="evaluation-campaign-form"><header><h2>发起应用效果评价</h2><button type="button" class="icon-button" data-close-evaluation-campaign aria-label="关闭">x</button></header><p class="sub">系统只向已打开操作步骤或下载过该成果的伙伴发送站内评价任务。</p><div class="form-grid"><label class="full">选择已发布成果<select id="evaluation-resource" required></select></label><label>评价截止日期<input id="evaluation-deadline" type="date" required /></label></div><p id="evaluation-campaign-message" class="sub"></p><footer><button type="button" class="button secondary" data-close-evaluation-campaign>取消</button><button type="submit" class="button primary">发送评价任务</button></footer></form></dialog>`);
    const dialog = $('#evaluation-campaign-dialog');
    dialog.querySelectorAll('[data-close-evaluation-campaign]').forEach((button) => { button.onclick = () => dialog.close(); });
    $('#evaluation-campaign-form').onsubmit = async (event) => {
      event.preventDefault();
      const resource = resources.find((item) => item.id === $('#evaluation-resource').value);
      const submit = event.currentTarget.querySelector('[type="submit"]');
      try {
        submit.disabled = true;
        await window.DfwsCloud.createSkillEvaluationCampaign(resource, $('#evaluation-deadline').value);
        dialog.close();
        await load();
      } catch (error) { $('#evaluation-campaign-message').textContent = error.message || '评价任务创建失败。'; }
      finally { submit.disabled = false; }
    };
  };
  const openDialog = () => {
    ensureDialog();
    const published = resources.filter((item) => item.status === 'published');
    $('#evaluation-resource').innerHTML = `<option value="">请选择成果</option>${published.map((item) => `<option value="${item.id}">${item.title || '未命名成果'} · ${item.partners?.owner_name || '未关联伙伴'}</option>`).join('')}`;
    $('#evaluation-deadline').value = dateValue(14);
    $('#evaluation-campaign-message').textContent = '';
    $('#evaluation-campaign-dialog').showModal();
  };
  const percent = (count, total) => total ? `${Math.round(count / total * 100)}%` : '-';
  const render = () => {
    const view = $('#skills');
    if (!view || !window.DfwsCloud?.staff()) return;
    let panel = $('#skill-evaluation-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'skill-evaluation-panel';
      panel.className = 'card skill-evaluation-panel';
      panel.innerHTML = `<div class="section-head"><div><h2>阶段性应用效果评价</h2><p>由实际使用伙伴勾选提效、提质或暂无明显效果；不替代成果审核。</p></div><button class="button secondary" id="create-evaluation-campaign">发起评价</button></div><div id="evaluation-campaign-list"></div>`;
      view.querySelector('#skill-library-summary')?.after(panel);
      $('#create-evaluation-campaign').onclick = openDialog;
    }
    const list = $('#evaluation-campaign-list');
    list.innerHTML = campaigns.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>成果</th><th>截止日期</th><th>已通知 / 已评价</th><th>提效认可</th><th>提质认可</th><th>暂无明显效果</th></tr></thead><tbody>${campaigns.map((item) => `<tr><td><strong>${item.resource_title || '未命名成果'}</strong></td><td>${new Date(item.closes_at).toLocaleDateString('zh-CN')}</td><td>${item.target_count} / ${item.response_count}</td><td>${item.efficiency_count} 人 · ${percent(item.efficiency_count, item.response_count)}</td><td>${item.quality_count} 人 · ${percent(item.quality_count, item.response_count)}</td><td>${item.no_effect_count} 人</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">暂未发起评价任务。发布一段时间且已有伙伴使用后，再发起评价。</div>';
  };
  const load = async () => {
    if (!window.DfwsCloud?.staff()) return;
    try {
      const data = await window.DfwsCloud.listSkillResources();
      resources = data.resources || [];
      campaigns = await window.DfwsCloud.listSkillEvaluationCampaigns(resources).catch(() => []);
      render();
    } catch (error) { console.warn('效果评价加载失败', error); }
  };
  // `render()` changes #skills itself. Loading on every child mutation would
  // immediately call `render()` again and lock the page in a render loop.
  const view = $('#skills');
  new MutationObserver(() => {
    if (view.querySelector('#skill-library-summary') && !view.querySelector('#skill-evaluation-panel')) {
      load();
    }
  }).observe(view, { childList: true, subtree: true });
})();
