// 直接调用 window.agent.login 测试 IPC 链路
const WebSocket = require('ws');

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
    if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 400));
    return r.result && r.result.value;
  };

  // window.agent 存在性 + login 直调
  const apiKeys = await evalJs(`Object.keys(window.agent || {})`);
  console.log('API_KEYS:', JSON.stringify(apiKeys));
  const res = await evalJs(`window.agent.login({ username: 'agent_e2e_test', password: 'LnxAgent#2026x', baseUrl: 'https://linxgeo.com' })`);
  console.log('LOGIN_RESULT:', JSON.stringify(res));
  const dev = await evalJs(`window.agent.getDevice()`);
  console.log('DEVICE:', JSON.stringify(dev));
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
