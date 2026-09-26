// 打开搜狐登录窗口（同 partition，无 Cookie）并 dump 未登录态 DOM 特征
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list0 = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list0.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const cdp = await (async () => {
    const ws = new WebSocket(main.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = { ws, id: 0, pending: new Map() };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    c.send = (method, params = {}) => {
      const id = ++c.id;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => c.pending.set(id, { resolve, reject }));
    };
    c.eval = async (e) => {
      const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
      return r.result && r.result.value;
    };
    return c;
  })();

  // 触发打开搜狐登录窗口
  await cdp.eval(`window.agent.addAccount('sohu').catch(e => 'ERR:' + e.message); 'opened'`);
  console.log('已触发打开搜狐登录窗口，等待…');

  // 等搜狐窗口出现
  let target = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    target = list.find((t) => /sohu\.com/.test(t.url));
    if (target) break;
  }
  if (!target) { console.log('搜狐窗口未出现'); process.exit(1); }
  console.log('搜狐窗口: ' + target.url);

  // 等 SPA 渲染
  await sleep(8000);

  const ws2 = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej; });
  let id2 = 0;
  const pending2 = new Map();
  ws2.onmessage = (ev) => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending2.has(msg.id)) {
      const p = pending2.get(msg.id); pending2.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  const send2 = (method, params = {}) => {
    const mid = ++id2;
    ws2.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((resolve, reject) => pending2.set(mid, { resolve, reject }));
  };
  const eval2 = async (e) => {
    const r = await send2('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result && r.result.value;
  };

  const dump = await eval2(`(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, ph: i.placeholder || '', vis: i.getBoundingClientRect().width > 0 }));
    const btns = Array.from(document.querySelectorAll('button')).slice(0, 15).map(b => b.textContent.trim().slice(0, 12)).filter(Boolean);
    const txt = (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 500);
    return JSON.stringify({ url: location.href, inputs, btns, txt }, null, 1);
  })()`);
  console.log('DOM 特征：\n' + dump);
  process.exit(0);
})().catch((e) => { console.log('ERR:' + e.message); process.exit(1); });
