// 单独驱动头条检测并读结果
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString();
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  const send = (m, p = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method: m, params: p })); return new Promise((res, rej) => pending.set(mid, { resolve: res, reject: rej })); };
  const evalJs = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result && r.result.value;
  };
  const n = await evalJs(`(() => { document.querySelector('[data-tab="accounts"]').click(); const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('今日头条')); if (!c) throw new Error('无头条卡片'); c.querySelector('[data-act="check"]').click(); return cs.length; })()`);
  console.log('cards=' + n + '，已点击头条检测，等待 22s…');
  await sleep(22000);
  const tag = await evalJs(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('今日头条')); return c ? (c.textContent.includes('已授权') ? 'valid' : 'invalid') : 'none'; })()`);
  console.log('RESULT=' + tag);
  process.exit(0);
})().catch((e) => { console.log('ERR:' + e.message); process.exit(1); });
