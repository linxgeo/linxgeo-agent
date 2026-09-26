// 重载页面捕获初始化期 console/异常
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      events.push(`[console.${msg.params.type}] ` + (msg.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      events.push('[EXCEPTION] ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      events.push(`[log.${e.level}] ${e.text} ${e.url || ''}`.slice(0, 250));
    }
  };
  const send = (method, params = {}) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((resolve, reject) => pending.set(mid, { resolve, reject }));
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(6000);
  console.log('EVENTS(' + events.length + '):');
  events.forEach((e) => console.log('  ' + e));
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
