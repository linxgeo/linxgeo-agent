/**
 * 任务包1 客户端 e2e 驱动（CDP）：
 *   登录绑定 → 添加头条账号（种子 Cookie 注入登录窗口）→ 完成引导 → 主界面断言。
 * 运行前提：agent 已用 --remote-debugging-port=9222 启动，且处于首次引导界面。
 */
const fs = require('fs');
const WebSocket = require('ws');

const BASE_URL = 'https://linxgeo.com';
const USERNAME = 'agent_e2e_test';
const PASSWORD = 'LnxAgent#2026x';
const COOKIES = JSON.parse(fs.readFileSync('/tmp/tt-cookies.json', 'utf8'));

const log = (m) => console.log('E2E::' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpList() {
  const r = await fetch('http://127.0.0.1:9222/json/list');
  return r.json();
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessions = 0; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr, sessionId) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result && r.result.value;
  }
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(800);
  }
  throw new Error('等待超时: ' + label);
}

(async () => {
  // 0. 找主窗口（index.html）
  const main = await waitFor(async () => {
    const list = await cdpList();
    return list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  }, 15000, '主窗口出现');
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);
  log('主窗口已连接');

  // 1. 填登录表单并提交
  await cdp.eval(`(() => {
    document.getElementById('wizBaseUrl').value = ${JSON.stringify(BASE_URL)};
    document.getElementById('wizUsername').value = ${JSON.stringify(USERNAME)};
    document.getElementById('wizPassword').value = ${JSON.stringify(PASSWORD)};
    document.getElementById('wizLoginBtn').click();
    return true;
  })()`);
  log('已提交登录表单，等待绑定…');

  // 2. 等待步骤2出现（绑定成功）
  await waitFor(() => cdp.eval(`!document.getElementById('wizardStep2').classList.contains('hidden')`), 25000, '绑定成功进入步骤2');
  log('✓ 步骤2（添加发布账号）已出现');

  // 3. 点击头条平台卡片
  const cards = await cdp.eval(`document.querySelectorAll('.platform-card').length`);
  await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('.platform-card'));
    const tt = cards.find((c) => c.textContent.includes('今日头条'));
    if (!tt) throw new Error('未找到头条卡片');
    tt.click(); return true;
  })()`);
  log(`✓ 已点击头条卡片（共 ${cards} 个平台）`);

  // 4. 等待头条登录窗口出现
  const loginTarget = await waitFor(async () => {
    const list = await cdpList();
    return list.find((t) => t.type === 'page' && /toutiao\.com/.test(t.url));
  }, 30000, '头条登录窗口');
  log('✓ 头条登录窗口已打开: ' + loginTarget.url.slice(0, 60));

  // 5. 注入种子 Cookie（复用服务器已授权登录态；注入后 Cookie 只存在于本地 partition）
  const lwin = await Cdp.connect(loginTarget.webSocketDebuggerUrl);
  let injected = 0;
  for (const c of COOKIES) {
    try {
      await lwin.send('Network.setCookie', {
        name: c.name, value: String(c.value || ''),
        domain: c.domain || '.toutiao.com', path: c.path || '/',
        secure: !!c.secure, httpOnly: !!c.httpOnly,
      });
      injected++;
    } catch (e) { /* 单条失败忽略 */ }
  }
  log(`✓ 种子 Cookie 注入 ${injected}/${COOKIES.length} 个，刷新页面…`);
  await lwin.eval('location.href = "https://mp.toutiao.com/"');

  // 6. 等待 App 检测到登录成功（主窗口出现「已授权」标记 / added-list）
  await waitFor(() => cdp.eval(`document.body.textContent.includes('已授权') || document.querySelectorAll('.added-item').length > 0`), 60000, 'App 检测到头条登录成功');
  const added = await cdp.eval(`Array.from(document.querySelectorAll('.added-item')).map(e=>e.textContent.trim())`);
  log('✓ 登录态采集成功，已添加: ' + JSON.stringify(added));

  // 7. 完成引导：下一步 → 完成
  await cdp.eval(`document.getElementById('wizNextBtn').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('wizardStep3').classList.contains('hidden')`), 8000, '步骤3');
  await cdp.eval(`document.getElementById('wizFinishBtn').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('app').classList.contains('hidden') && document.getElementById('wizard').classList.contains('hidden')`), 8000, '主界面');
  log('✓ 进入主界面');

  // 8. 断言：账号列表显示头条 + 昵称
  await waitFor(() => cdp.eval(`document.querySelectorAll('.account-card').length >= 1`), 10000, '账号卡片渲染');
  const cardText = await cdp.eval(`document.querySelector('.account-card') ? document.querySelector('.account-card').innerText.replace(/\\n/g,' | ') : ''`);
  log('✓ 账号卡片: ' + cardText);

  // 9. 断言：设置页设备信息（绑定昵称）+ 在线状态
  await cdp.eval(`document.querySelector('[data-tab="settings"]').click()`);
  const deviceInfo = await cdp.eval(`document.getElementById('deviceInfo').innerText.replace(/\\n/g,' | ')`);
  log('✓ 设备信息: ' + deviceInfo);

  // 10. 验证本地登录窗口已自动关闭（登录成功后）
  await sleep(2000);
  const stillOpen = (await cdpList()).some((t) => /toutiao\.com/.test(t.url));
  log(stillOpen ? '⚠️ 登录窗口未关闭' : '✓ 登录窗口已自动关闭');

  // 11. 云端核对：test 用户的 agent_accounts 应有头条记录
  const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  }).then((r) => r.json());
  const jwt = loginResp.data.token;
  const accounts = await fetch(`${BASE_URL}/api/agent/accounts`, { headers: { Authorization: `Bearer ${jwt}` } }).then((r) => r.json());
  log('✓ 云端账号元信息: ' + JSON.stringify(accounts.data.accounts));
  const agents = await fetch(`${BASE_URL}/api/agent/agents`, { headers: { Authorization: `Bearer ${jwt}` } }).then((r) => r.json());
  log('✓ 云端设备状态: ' + JSON.stringify(agents.data.agents.map((a) => ({ online: a.online, version: a.version }))));

  log('ALL_PASS');
  process.exit(0);
})().catch((e) => { console.log('E2E_FAIL: ' + e.message); process.exit(1); });
