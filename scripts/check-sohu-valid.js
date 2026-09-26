// 附加验证：搜狐（partition 疑有真实会话）检测应=valid（验证检测器不误杀有效会话）
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
  const has = await evalJs(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); return cs.some(x => x.textContent.includes('搜狐号')); })()`);
  if (!has) { console.log('搜狐卡片不存在，跳过'); process.exit(0); }
  await evalJs(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('搜狐号')); c.querySelector('[data-act="check"]').click(); return 1; })()`);
  console.log('已点击搜狐检测，轮询结果…');
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const s = await evalJs(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('搜狐号')); return c ? (c.textContent.includes('检测中') ? 'pending' : c.textContent.includes('需重新授权') ? 'invalid' : c.textContent.includes('已授权') ? 'valid' : 'pending') : 'none'; })()`);
    if (s !== 'pending') { console.log('搜狐结果=' + s); process.exit(0); }
  }
  console.log('搜狐结果=timeout');
  process.exit(1);
})().catch((e) => { console.log('ERR:' + e.message); process.exit(1); });
