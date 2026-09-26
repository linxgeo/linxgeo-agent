// 实时点击登录并跟踪（CDP）
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch (e) { return; }
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        c.events.push(`[console.${msg.params.type}] ` + (msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        c.events.push('[exception] ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
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
    if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
  }
}

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  // 填表 + 点击
  await cdp.eval(`(() => {
    document.getElementById('wizBaseUrl').value = 'https://linxgeo.com';
    document.getElementById('wizUsername').value = 'agent_e2e_test';
    document.getElementById('wizPassword').value = 'LnxAgent#2026x';
    document.getElementById('wizLoginBtn').click();
    return 'clicked';
  })()`);
  console.log('E2E::clicked');

  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const s = await cdp.eval(`JSON.stringify({
      btnText: document.getElementById('wizLoginBtn').textContent,
      btnDisabled: document.getElementById('wizLoginBtn').disabled,
      err: (document.getElementById('wizLoginError')||{}).textContent || '',
      step2Hidden: document.getElementById('wizardStep2').classList.contains('hidden'),
    })`);
    console.log('t=' + ((i + 1) * 2) + 's ' + s);
    if (!s.includes('"step2Hidden":true')) { console.log('E2E::STEP2_SHOWN'); break; }
  }
  console.log('EVENTS:', JSON.stringify(cdp.events.slice(-8), null, 1));
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
