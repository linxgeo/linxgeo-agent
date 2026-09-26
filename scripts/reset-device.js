// 登出设备并重载页面（回到首次引导）
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((resolve, reject) => pending.set(mid, { resolve, reject }));
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result && r.result.value;
  };

  const out = await evalJs(`window.agent.logout()`);
  console.log('LOGOUT:', JSON.stringify(out));
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(5000);
  const state = await evalJs(`JSON.stringify({
    wizardHidden: document.getElementById('wizard').classList.contains('hidden'),
    step1Hidden: document.getElementById('wizardStep1').classList.contains('hidden'),
    platformCards: document.querySelectorAll('.platform-card').length,
  })`);
  console.log('AFTER_RELOAD:', state);
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
