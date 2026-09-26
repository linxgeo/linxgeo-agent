/**
 * TC-06 最终验收 v2：
 * ① 头条（真实会话被平台风控踢掉，Cookie 仍在）→ 开窗口探测 → URL 重定向登录页 → 需重新授权
 * ② 伪造百家号账号（partition 从未登录，零 Cookie）→ Cookie 前置闸门 → 需重新授权（快速路径，不开窗口）
 * ③ 清理伪造账号，确认本地存储干净
 */
const fs = require('fs');
const WebSocket = require('ws');
const log = (m) => console.log('E2E::' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNTS_FILE = process.env.HOME + '/Library/Application Support/linxgeo-agent/data/accounts.json';

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data.toString());
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
  if (!main) throw new Error('主窗口未找到');
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);

  const readCard = (name) => cdp.eval(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('${name}')); return c ? (c.textContent.includes('检测中') ? 'pending' : c.textContent.includes('需重新授权') ? 'invalid' : c.textContent.includes('已授权') ? 'valid' : 'pending') : 'none'; })()`);
  const clickCheck = (name) => cdp.eval(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('${name}')); if (!c) throw new Error('无 ${name} 卡片'); c.querySelector('[data-act="check"]').click(); return 1; })()`);
  async function waitStatus(name, timeoutMs) {
    for (let i = 0; i < timeoutMs / 2000; i++) {
      await sleep(2000);
      const s = await readCard(name);
      if (s !== 'pending') return s;
    }
    return 'timeout';
  }

  await cdp.eval(`document.querySelector('[data-tab="accounts"]').click(); true`);
  await sleep(400);

  // ===== ① 头条：真实失效会话（URL 重定向路径）=====
  log('① 头条（真实失效会话，走 URL 判定路径）检测…');
  await clickCheck('今日头条');
  const tt = await waitStatus('今日头条', 40000);
  log('头条结果: ' + tt);
  if (tt !== 'invalid') throw new Error('① 头条失效会话应=需重新授权');

  // ===== ② 伪造百家号（零 Cookie，Cookie 闸门路径）=====
  const store = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  if (!store.some((a) => a.id === 'fake_bjh_tc06')) {
    store.push({
      id: 'fake_bjh_tc06', platform: 'baijiahao', platform_name: '百家号', nickname: 'TC06测试号',
      status: 'valid', authorized_at: new Date().toISOString(),
      expire_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), cookies: null,
    });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2));
    log('已注入伪造百家号账号');
  } else log('伪造百家号账号已在存储中');
  await cdp.send('Page.enable');
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(5000);
  await cdp.eval(`document.querySelector('[data-tab="accounts"]').click(); true`);
  await sleep(400);

  log('② 百家号（零 Cookie，走 Cookie 闸门路径）检测…');
  const t0 = Date.now();
  await clickCheck('百家号');
  const bjh = await waitStatus('百家号', 30000);
  log('百家号结果: ' + bjh + `（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，闸门路径应 <5s）`);
  if (bjh !== 'invalid') throw new Error('② 零 Cookie 百家号应=需重新授权');

  // ===== ③ 清理伪造百家号 =====
  await cdp.eval(`(() => { window.confirm = () => true; const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('百家号')); c.querySelector('[data-act="remove"]').click(); return 1; })()`);
  await sleep(2500);
  const finalStore = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const clean = !finalStore.some((a) => a.platform === 'baijiahao');
  log(clean ? '✓ 伪造百家号已清理' : '⚠️ 清理异常');
  if (!clean) throw new Error('本地存储百家号未清除');
  log('本地存储最终账号数: ' + finalStore.length + '（平台: ' + finalStore.map((a) => a.platform).join(',') + '）');

  log('ALL_PASS');
  process.exit(0);
})().catch((e) => { console.log('E2E_FAIL: ' + e.message); process.exit(1); });
