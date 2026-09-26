/**
 * 续接 e2e：从向导步骤2（或主界面）添加头条账号（种子 Cookie 注入）
 */
const fs = require('fs');
const WebSocket = require('ws');
const COOKIES = JSON.parse(fs.readFileSync('/tmp/tt-cookies.json', 'utf8'));
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

async function listTargets() {
  return (await fetch('http://127.0.0.1:9222/json/list')).json();
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
  // 主窗口
  const list = await listTargets();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);

  // 找头条入口（向导步骤2 的平台卡片 或 主界面账号页弹层需另开）——优先向导
  const inWizard = await cdp.eval(`!document.getElementById('wizardStep2').classList.contains('hidden')`);
  if (!inWizard) throw new Error('当前不在向导步骤2，请先运行 reset-device + e2e-task1');
  await cdp.eval(`(() => { const c = Array.from(document.querySelectorAll('.platform-card')).find(x => x.textContent.includes('今日头条')); if (!c) throw new Error('无头条卡片'); c.click(); return 1; })()`);
  log('已点击头条卡片');

  // 等登录窗口
  const target = await waitFor(async () => (await listTargets()).find((t) => t.type === 'page' && /toutiao\.com/.test(t.url)), 30000, '登录窗口');
  log('登录窗口: ' + target.url.slice(0, 70));

  // 等 mp.toutiao.com 完成首跳（可能在登录页）
  await sleep(4000);
  const lwin = await Cdp.connect((await listTargets()).find((t) => /toutiao\.com/.test(t.url)).webSocketDebuggerUrl);
  await lwin.send('Network.enable');

  // 注入种子 Cookie
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
  log(`种子 Cookie 注入 ${injected}/${COOKIES.length}`);

  // 导航到创作中心首页（登录态有效则停留；无效则跳登录页）
  await lwin.eval(`location.href = 'https://mp.toutiao.com/profile_v4/home'`);
  await sleep(5000);
  const cur = (await listTargets()).find((t) => /toutiao\.com/.test(t.url));
  log('当前登录窗口 URL: ' + (cur ? cur.url : '(已关闭)'));

  // 等 App 成功检测（主窗口出现 已授权 / added-item）
  await waitFor(() => cdp.eval(`document.body.textContent.includes('已授权') || document.querySelectorAll('.added-item').length > 0`), 60000, 'App 检测登录成功');
  const added = await cdp.eval(`Array.from(document.querySelectorAll('.added-item')).map(e=>e.textContent.trim())`);
  log('✓ 已添加: ' + JSON.stringify(added));
  log('ALL_PASS');
  process.exit(0);
})().catch((e) => { console.log('E2E_FAIL: ' + e.message); process.exit(1); });
