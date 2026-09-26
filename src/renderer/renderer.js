/**
 * 渲染层逻辑：首次引导三步 + 三页签（发布账号 / 发布记录 / 设置）
 */
const PLATFORM_COLORS = {
  toutiao: '#F04142', xiaohongshu: '#FF2442', baijiahao: '#2932E1',
  sohu: '#F5A623', dayuhao: '#FF6A00', zhihu: '#0084FF', bilibili: '#FB7299',
  douyin: '#111111', wangyihao: '#D43C33', weixin: '#07C160', qiehao: '#12B7F5', shipinhao: '#07C160',
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

function fmtDate(iso) {
  if (!iso) return '-';
  try { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } catch (e) { return iso; }
}
function platformBadge(key, name) {
  const color = PLATFORM_COLORS[key] || '#2563EB';
  return `<div class="p-icon" style="background:${color}">${(name || key).slice(0, 1)}</div>`;
}

// ===== 全局状态 =====
let platforms = [];
let heartbeatState = { online: false };
let wizardAdded = [];

// ===== 初始化 =====
async function init() {
  platforms = await window.agent.listPlatforms();

  const [deviceRes, settingsRes] = await Promise.all([window.agent.getDevice(), window.agent.getSettings()]);
  $('versionTag').textContent = 'v' + deviceRes.version;
  $('wizBaseUrl').value = settingsRes.baseUrl || 'https://linxgeo.com';
  $('baseUrlInput').value = settingsRes.baseUrl || '';
  $('autoLaunchToggle').checked = !!settingsRes.autoLaunchEffective;

  window.agent.onHeartbeatState((st) => { heartbeatState = st; renderOnlineStatus(); });
  window.agent.onAccountAdded(() => { refreshAccounts(); });
  window.agent.onCheckProgress((p) => { markAccountChecking(p.id, p.status); });
  window.agent.onTaskUpdate(() => { refreshRecords(); });

  if (deviceRes.bound) {
    enterMain(deviceRes);
  } else {
    showWizard();
  }
  bindTabs();
  bindAccountsTab();
  bindSettingsTab(deviceRes);
}

// ===== 在线状态 =====
function renderOnlineStatus() {
  const dot = $('onlineDot'), txt = $('onlineText');
  if (heartbeatState.online) {
    dot.className = 'dot dot-online'; dot.title = '在线';
    txt.textContent = '在线';
  } else {
    dot.className = 'dot dot-offline'; dot.title = '离线';
    txt.textContent = '离线 · 任务将排队等待恢复';
  }
}

// ===== 页签 =====
function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
      if (btn.dataset.tab === 'records') refreshRecords();
    });
  });
}

// ===== 发布记录（任务包2）=====
const RECORD_STATUS = {
  started: { text: '发布中…', cls: 'tag tag-checking' },
  success: { text: '发布成功', cls: 'tag tag-valid' },
  failed: { text: '发布失败', cls: 'tag tag-invalid' },
};

async function refreshRecords() {
  try {
    const res = await window.agent.listRecords();
    const records = (res && res.records) || [];
    $('records-busy').classList.toggle('hidden', !res.busy);
    const list = $('records-list');
    list.innerHTML = '';
    $('records-empty').classList.toggle('hidden', records.length > 0);
    records.forEach((r) => {
      const card = el('div', 'account-card' + (r.result === 'failed' ? ' invalid' : ''));
      const st = RECORD_STATUS[r.result] || RECORD_STATUS.started;
      const platformName = (platforms.find((p) => p.key === r.platform) || {}).name || r.platform;
      const time = (() => { try { const d = new Date(r.finished_at || r.started_at); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } catch (e) { return ''; } })();
      card.innerHTML = `
        ${platformBadge(r.platform, platformName)}
        <div class="ac-main">
          <div class="ac-title">${(r.title || '').slice(0, 40) || '(无标题)'} <span style="color:#999;font-size:12px">#${r.task_id}</span></div>
          <div class="ac-sub">${r.platform} · ${time}${r.article_id ? ' · 文章ID ' + r.article_id : ''}</div>
          ${r.fail_reason ? `<div class="ac-sub" style="color:#DC2626">${r.fail_reason.slice(0, 120)}</div>` : ''}
        </div>
        <span class="${st.cls}">${st.text}</span>`;
      list.appendChild(card);
    });
  } catch (e) { /* 静默 */ }
}

function enterMain(deviceRes) {
  $('wizard').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderOnlineStatus();
  renderDeviceInfo(deviceRes);
  refreshAccounts();
}

// ===== 首次引导 =====
function showWizard() {
  $('app').classList.add('hidden');
  $('wizard').classList.remove('hidden');
  renderWizardPlatforms();
  bindWizard();
}

function renderWizardPlatforms() {
  const grid = $('wizPlatformGrid');
  grid.innerHTML = '';
  platforms.forEach((p) => {
    const card = el('button', 'platform-card');
    const added = wizardAdded.some((a) => a.platform === p.key);
    card.innerHTML = `${platformBadge(p.key, p.name)}<div class="p-name">${p.name}</div>` +
      (added ? '<div class="p-added">✓ 已授权</div>' : '');
    card.addEventListener('click', () => addAccountFlow(p.key, true));
    grid.appendChild(card);
  });
}

function bindWizard() {
  $('wizLoginBtn').addEventListener('click', async () => {
    const btn = $('wizLoginBtn');
    const err = $('wizLoginError');
    err.classList.add('hidden');
    btn.disabled = true; btn.textContent = '登录中…';
    try {
      const res = await window.agent.login({
        username: $('wizUsername').value.trim(),
        password: $('wizPassword').value,
        baseUrl: $('wizBaseUrl').value.trim(),
      });
      if (!res.ok) throw new Error(res.message);
      toWizardStep(2);
    } catch (e) {
      err.textContent = e.message || '登录失败，请检查账号密码';
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = '登录并绑定本机';
    }
  });

  $('wizSkipBtn').addEventListener('click', () => toWizardStep(3));
  $('wizNextBtn').addEventListener('click', () => toWizardStep(3));
  $('wizFinishBtn').addEventListener('click', async () => {
    const deviceRes = await window.agent.getDevice();
    enterMain(deviceRes);
    toast(wizardAdded.length ? `设置完成，已授权 ${wizardAdded.length} 个账号` : '设置完成');
  });
}

function toWizardStep(n) {
  $('wizardStepLabel').textContent = `第 ${n} 步 / 共 3 步`;
  [1, 2, 3].forEach((i) => $(`wizardStep${i}`).classList.toggle('hidden', i !== n));
  if (n === 2) {
    // 步骤2里也展示已添加账号
    const list = $('wizAddedList');
    list.innerHTML = wizardAdded.length
      ? wizardAdded.map((a) => `<div class="added-item">✓ ${a.platform_name} · ${a.nickname}</div>`).join('')
      : '';
  }
}

// ===== 添加账号（引导与主界面共用）=====
async function addAccountFlow(platformKey, inWizard) {
  toast('正在打开登录窗口，请在弹出的窗口中完成登录…');
  const res = await window.agent.addAccount(platformKey);
  if (res.ok) {
    toast(`授权成功：${res.account.platform_name}（${res.account.nickname}）`);
    if (inWizard) {
      wizardAdded.push(res.account);
      renderWizardPlatforms();
      toWizardStep(2);
    }
    refreshAccounts();
  } else {
    toast(res.message || '未完成授权', true);
  }
}

// ===== 发布账号页 =====
function bindAccountsTab() {
  $('addAccountBtn').addEventListener('click', showAddAccountDialog);
  $('checkAllBtn').addEventListener('click', checkAll);
}

function showAddAccountDialog() {
  // 简易平台选择弹层（复用 wizard 的卡片样式）
  const overlay = el('div', 'wizard');
  overlay.style.zIndex = '150';
  const card = el('div', 'wizard-card');
  card.style.width = '440px';
  card.innerHTML = '<h1 style="font-size:19px;margin-bottom:6px;">选择发布平台</h1><p class="lead" style="margin-bottom:14px;">点击平台，在弹出的窗口中登录您的账号</p>';
  const grid = el('div', 'platform-grid');
  grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  platforms.forEach((p) => {
    const c = el('button', 'platform-card');
    c.innerHTML = `${platformBadge(p.key, p.name)}<div class="p-name">${p.name}</div>`;
    c.addEventListener('click', async () => {
      overlay.remove();
      await addAccountFlow(p.key, false);
    });
    grid.appendChild(c);
  });
  const cancel = el('button', 'btn-ghost');
  cancel.textContent = '取消'; cancel.style.width = '100%';
  cancel.addEventListener('click', () => overlay.remove());
  card.appendChild(grid);
  card.appendChild(cancel);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function refreshAccounts() {
  const accounts = await window.agent.listAccounts();
  const list = $('accountList');
  const empty = $('accountEmpty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', accounts.length > 0);
  accounts.forEach((acc) => {
    const card = el('div', 'account-card');
    card.dataset.id = acc.id;
    if (acc.status === 'invalid') card.classList.add('invalid');
    const statusTag = acc.status === 'valid'
      ? '<span class="tag tag-valid">已授权</span>'
      : acc.status === 'checking'
        ? '<span class="tag tag-checking">检测中…</span>'
        : '<span class="tag tag-invalid">需重新授权</span>';
    card.innerHTML = `
      <div class="ac-icon" style="background:${PLATFORM_COLORS[acc.platform] || '#2563EB'}">${(acc.platform_name || acc.platform).slice(0, 1)}</div>
      <div class="ac-main">
        <div class="ac-title">${acc.platform_name || acc.platform} · ${acc.nickname || ''} ${statusTag}</div>
        <div class="ac-sub">授权时间：${fmtDate(acc.authorized_at)}　有效期至：${fmtDate(acc.expire_at)}</div>
      </div>
      <div class="ac-actions">
        <button class="btn-ghost" data-act="check">检测</button>
        <button class="btn-danger" data-act="remove">解除授权</button>
      </div>`;
    card.querySelector('[data-act="check"]').addEventListener('click', async () => {
      markAccountChecking(acc.id, 'checking');
      const r = await window.agent.checkAccount(acc.id);
      if (r.ok) {
        toast(r.status === 'valid' ? `${acc.platform_name} 登录态正常` : `${acc.platform_name} 已失效，请重新授权`, r.status !== 'valid');
        refreshAccounts();
      } else toast(r.message || '检测失败', true);
    });
    card.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      if (!confirm(`确定解除 ${acc.platform_name}（${acc.nickname}）的授权吗？\n解除后将删除本机保存的登录信息。`)) return;
      const r = await window.agent.removeAccount(acc.id);
      if (r.ok) { toast('已解除授权'); refreshAccounts(); }
      else toast(r.message || '操作失败', true);
    });
    list.appendChild(card);
  });
}

function markAccountChecking(id, status) {
  // 检测进行中的即时反馈：把状态标签切换为「检测中…」（检测完成后列表整体刷新）
  document.querySelectorAll('.account-card').forEach((c) => {
    if (c.dataset.id !== id) return;
    const tag = c.querySelector('.tag');
    if (!tag) return;
    if (status === 'checking') { tag.className = 'tag tag-checking'; tag.textContent = '检测中…'; }
  });
}

async function checkAll() {
  toast('开始检测全部账号…');
  const r = await window.agent.checkAllAccounts();
  if (r.ok) {
    const invalid = r.results.filter((x) => x.status !== 'valid');
    toast(invalid.length ? `${invalid.length} 个账号需重新授权` : '全部账号登录态正常', invalid.length > 0);
    refreshAccounts();
  } else toast(r.message || '检测失败', true);
}

// ===== 设置页 =====
function bindSettingsTab(deviceRes) {
  $('autoLaunchToggle').addEventListener('change', async (e) => {
    await window.agent.saveSettings({ autoLaunch: e.target.checked });
    toast(e.target.checked ? '已开启开机自启' : '已关闭开机自启');
  });
  $('saveBaseUrlBtn').addEventListener('click', async () => {
    const v = $('baseUrlInput').value.trim();
    if (!/^https?:\/\//.test(v)) return toast('地址应以 https:// 开头', true);
    await window.agent.saveSettings({ baseUrl: v });
    toast('服务器地址已保存');
  });
  $('checkUpdateBtn').addEventListener('click', async () => {
    $('updateStatusText').textContent = '正在检查更新…';
    const r = await window.agent.checkUpdate();
    if (!r.ok) { $('updateStatusText').textContent = `检查失败：${r.message}`; return; }
    if (r.hasUpdate) {
      $('updateStatusText').textContent = `发现新版本 v${r.latest}（当前任务执行引擎将在后续版本开放自动升级）`;
      if (r.url) window.agent.openExternal(r.url);
    } else {
      $('updateStatusText').textContent = `已是最新版本（v${r.latest}）`;
    }
  });
  $('exportLogsBtn').addEventListener('click', async () => {
    const r = await window.agent.exportLogs();
    if (r.ok) toast('日志已导出');
    else if (r.message !== '已取消') toast(r.message || '导出失败', true);
  });
  $('logoutBtn').addEventListener('click', async () => {
    if (!confirm('确定解除本机绑定吗？解绑后将不再接收发布任务（本地登录态保留）。')) return;
    const r = await window.agent.logout();
    if (r.ok) {
      toast('已解除绑定，即将返回引导页');
      setTimeout(() => location.reload(), 800);
    }
  });
}

function renderDeviceInfo(deviceRes) {
  const d = deviceRes.device;
  const kv = $('deviceInfo');
  if (!d) { kv.innerHTML = '<div class="kv"><span class="v">未绑定</span></div>'; return; }
  kv.innerHTML = `
    <div class="kv"><span class="k">设备 ID</span><span class="v">${d.agent_id}</span></div>
    <div class="kv"><span class="k">绑定账号</span><span class="v">${(d.user && (d.user.nickname || d.user.username)) || '-'}</span></div>
    <div class="kv"><span class="k">设备名称</span><span class="v">${d.device_name || '-'}</span></div>
    <div class="kv"><span class="k">服务器</span><span class="v">${d.base_url || '-'}</span></div>`;
}

init();
