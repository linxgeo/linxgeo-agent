// 清理伪造搜狐记录（UI 解除授权，顺带清 partition）
const fs = require('fs');
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
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  const evalJs = async (e) => {
    const r = await new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true } }));
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result && r.result.value;
  };

  await evalJs(`document.querySelector('[data-tab="accounts"]').click(); true`);
  await sleep(400);
  const has = await evalJs(`Array.from(document.querySelectorAll('.account-card')).some(x => x.textContent.includes('搜狐号'))`);
  if (has) {
    await evalJs(`(() => { window.confirm = () => true; const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('搜狐号')); c.querySelector('[data-act="remove"]').click(); return 1; })()`);
    await sleep(2500);
  }
  const store = JSON.parse(fs.readFileSync(process.env.HOME + '/Library/Application Support/linxgeo-agent/data/accounts.json', 'utf8'));
  console.log('清理后账号: ' + store.map((a) => `${a.platform}(${a.nickname})`).join(', '));
  process.exit(0);
})().catch((e) => { console.log('ERR:' + e.message); process.exit(1); });
