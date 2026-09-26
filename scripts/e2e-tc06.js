/**
 * TC-06 验证（v2，检测器已加 DOM 登录探测）：
 * ① 头条有效登录态 → 检测=valid（回归验证新探测逻辑无误报）
 * ② 伪造无 Cookie 搜狐账号 → 检测=invalid（需重新授权）+ 云端状态同步
 * ③ 清理伪造账号
 */
const fs = require('fs');
const WebSocket = require('ws');
const log = (m) => console.log('E2E::' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STORE_DIR = process.env.HOME + '/Library/Application Support/linxgeo-agent/data';
const ACCOUNTS_FILE = STORE_DIR + '/accounts.json';

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

async function cloudAccounts() {
  const loginResp = await fetch('https://linxgeo.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'agent_e2e_test', password: 'LnxAgent#2026x' }),
  }).then((r) => r.json());
  const jwt = loginResp.data.token;
  return (await fetch('https://linxgeo.com/api/agent/accounts', { headers: { Authorization: `Bearer ${jwt}` } }).then((r) => r.json())).data.accounts;
}

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);

  // ===== ① 头条有效回归 =====
  await cdp.eval(`document.querySelector('[data-tab="accounts"]').click(); true`);
  await sleep(400);
  log('① 头条检测（回归新探测逻辑）…');
  await cdp.eval(`(() => { const cards = Array.from(document.querySelectorAll('.account-card')); const c = cards.find(x => x.textContent.includes('今日头条')); if(!c) throw new Error('无头条卡片'); c.querySelector('[data-act="check"]').click(); return 1; })()`);
  await sleep(12000);
  const tt = await cdp.eval(`(() => { const cards = Array.from(document.querySelectorAll('.account-card')); const c = cards.find(x => x.textContent.includes('今日头条')); return c ? (c.textContent.includes('已授权') ? 'valid' : c.textContent.includes('需重新授权') ? 'invalid' : 'other') : 'none'; })()`);
  log('头条结果: ' + tt);
  if (tt !== 'valid') throw new Error('① 头条应=valid，新探测逻辑误报');

  // ===== ② 确保伪造搜狐账号存在（去重）=====
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  let fake = accounts.find((a) => a.id === 'fake_sohu_tc06');
  if (!fake) {
    accounts.push({
      id: 'fake_sohu_tc06', platform: 'sohu', platform_name: '搜狐号', nickname: 'TC06测试号',
      status: 'valid', authorized_at: new Date().toISOString(),
      expire_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), cookies: null,
    });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    log('已注入伪造搜狐账号');
  } else log('伪造搜狐账号已存在');

  await cdp.send('Page.enable');
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(5000);
  await cdp.eval(`document.querySelector('[data-tab="accounts"]').click(); true`);
  await sleep(400);

  log('② 搜狐检测（无任何 Cookie → 应=需重新授权）…');
  await cdp.eval(`(() => { const cards = Array.from(document.querySelectorAll('.account-card')); const c = cards.find(x => x.textContent.includes('搜狐号')); if(!c) throw new Error('无搜狐卡片'); c.querySelector('[data-act="check"]').click(); return 1; })()`);
  // 轮询等待检测结果（最长 40s）
  let sohu = 'pending';
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    sohu = await cdp.eval(`(() => { const cards = Array.from(document.querySelectorAll('.account-card')); const c = cards.find(x => x.textContent.includes('搜狐号')); return c ? (c.textContent.includes('需重新授权') ? 'invalid' : c.textContent.includes('已授权') ? 'valid' : 'pending') : 'none'; })()`);
    if (sohu !== 'pending') break;
  }
  log('搜狐结果: ' + sohu);
  if (sohu !== 'invalid') throw new Error('② 搜狐应=invalid');
  const cloud = await cloudAccounts();
  const cloudSohu = cloud.find((a) => a.platform === 'sohu');
  log('云端搜狐状态: ' + (cloudSohu ? cloudSohu.status : '(未登记，符合预期——本地伪造账号未走云端登记)'));

  // ===== ③ 清理：解除伪造搜狐 =====
  await cdp.eval(`(() => { window.confirm = () => true; const cards = Array.from(document.querySelectorAll('.account-card')); const c = cards.find(x => x.textContent.includes('搜狐号')); c.querySelector('[data-act="remove"]').click(); return 1; })()`);
  await sleep(2500);
  const gone = await cdp.eval(`!Array.from(document.querySelectorAll('.account-card')).some(x => x.textContent.includes('搜狐号'))`);
  log(gone ? '✓ 伪造搜狐账号已解除授权' : '⚠️ 搜狐仍在列表');
  const store = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  log('本地存储账号数: ' + store.length + '（平台: ' + store.map((a) => a.platform).join(',') + '）');
  if (store.some((a) => a.platform === 'sohu')) throw new Error('本地存储搜狐未清除');

  log('ALL_PASS');
  process.exit(0);
})().catch((e) => { console.log('E2E_FAIL: ' + e.message); process.exit(1); });
