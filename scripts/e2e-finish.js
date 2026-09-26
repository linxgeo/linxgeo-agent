/**
 * e2e 收尾：完成引导 → 主界面断言（账号卡片/设备信息/在线状态）→ 云端核对
 */
const WebSocket = require('ws');
const log = (m) => console.log('E2E::' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
  }
}

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);

  // 1. 完成引导
  await cdp.eval(`document.getElementById('wizNextBtn').click(); true`);
  await sleep(600);
  const step3 = await cdp.eval(`!document.getElementById('wizardStep3').classList.contains('hidden')`);
  if (!step3) throw new Error('步骤3未出现');
  log('✓ 步骤3（完成）出现');
  await cdp.eval(`document.getElementById('wizFinishBtn').click(); true`);
  await sleep(1500);
  const inMain = await cdp.eval(`!document.getElementById('app').classList.contains('hidden') && document.getElementById('wizard').classList.contains('hidden')`);
  if (!inMain) throw new Error('未进入主界面');
  log('✓ 进入主界面');

  // 2. 账号卡片
  const card = await cdp.eval(`document.querySelector('.account-card') ? document.querySelector('.account-card').innerText.replace(/\\n/g, ' | ') : ''`);
  log('✓ 账号卡片: ' + card);
  if (!card.includes('今日头条')) throw new Error('账号卡片无头条');

  // 3. 设置页设备信息 + 在线状态
  await cdp.eval(`document.querySelector('[data-tab="settings"]').click(); true`);
  await sleep(500);
  const deviceInfo = await cdp.eval(`document.getElementById('deviceInfo').innerText.replace(/\\n/g, ' | ')`);
  log('✓ 设备信息: ' + deviceInfo);
  const online = await cdp.eval(`document.querySelector('.dot-online') !== null`);
  log(online ? '✓ 在线状态：在线' : '⚠️ 在线状态：离线');

  // 4. 发布记录空态
  await cdp.eval(`document.querySelector('[data-tab="records"]').click(); true`);
  await sleep(300);
  const recordsEmpty = await cdp.eval(`document.getElementById('tab-records').textContent.includes('暂无发布记录')`);
  log(recordsEmpty ? '✓ 发布记录空态正常' : '⚠️ 发布记录非空');

  // 5. 云端核对（test 用户）
  const loginResp = await fetch('https://linxgeo.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'agent_e2e_test', password: 'LnxAgent#2026x' }),
  }).then((r) => r.json());
  const jwt = loginResp.data.token;
  const accounts = await fetch('https://linxgeo.com/api/agent/accounts', { headers: { Authorization: `Bearer ${jwt}` } }).then((r) => r.json());
  log('✓ 云端账号元信息: ' + JSON.stringify(accounts.data.accounts));
  const tt = accounts.data.accounts.find((a) => a.platform === 'toutiao');
  if (!tt) throw new Error('云端无头条记录');
  if (tt.account_nickname === '') throw new Error('云端昵称为空');
  const agents = await fetch('https://linxgeo.com/api/agent/agents', { headers: { Authorization: `Bearer ${jwt}` } }).then((r) => r.json());
  const ag = agents.data.agents[0];
  log(`✓ 云端设备: online=${ag.online} version=${ag.version} heartbeat=${ag.last_heartbeat_at}`);
  if (!ag.online) throw new Error('云端设备离线');

  log('ALL_PASS');
  process.exit(0);
})().catch((e) => { console.log('E2E_FAIL: ' + e.message); process.exit(1); });
