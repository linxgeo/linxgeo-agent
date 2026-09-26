// 检查向导表单状态（CDP 只读探针）
const WebSocket = require('ws');

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
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
    if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result && r.result.value;
  }
}

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  if (!main) { console.log('NO_MAIN_WIN', JSON.stringify(list.map((t) => ({ u: t.url, t: t.type })))); return; }
  const cdp = await Cdp.connect(main.webSocketDebuggerUrl);
  const state = await cdp.eval(`JSON.stringify({
    url: location.href,
    err: (document.getElementById('wizLoginError')||{}).textContent || '',
    errHidden: document.getElementById('wizLoginError') ? document.getElementById('wizLoginError').classList.contains('hidden') : null,
    btnText: document.getElementById('wizLoginBtn').textContent,
    btnDisabled: document.getElementById('wizLoginBtn').disabled,
    user: document.getElementById('wizUsername').value,
    step1Hidden: document.getElementById('wizardStep1').classList.contains('hidden'),
    step2Hidden: document.getElementById('wizardStep2').classList.contains('hidden'),
    agentApi: typeof window.agent,
  })`);
  console.log('STATE:', state);
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
