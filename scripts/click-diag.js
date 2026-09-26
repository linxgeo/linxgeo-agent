// 点击机制诊断：自定义监听器是否触发 + 原监听器是否执行
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
    if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
  };

  // 当前页面状态（直调 login 已绑定成功，页面可能仍在向导）
  const pre = await evalJs(`JSON.stringify({
    wizardHidden: document.getElementById('wizard').classList.contains('hidden'),
    appHidden: document.getElementById('app').classList.contains('hidden'),
    step1Hidden: document.getElementById('wizardStep1').classList.contains('hidden'),
  })`);
  console.log('PRE:', pre);

  // 点击机制测试
  await evalJs(`(() => {
    window.__clickTest = 0;
    document.getElementById('wizLoginBtn').addEventListener('click', () => { window.__clickTest++; });
    document.getElementById('wizLoginBtn').click();
    return 'ok';
  })()`);
  await sleep(500);
  const t = await evalJs(`JSON.stringify({
    clickTest: window.__clickTest,
    btnText: document.getElementById('wizLoginBtn').textContent,
    btnDisabled: document.getElementById('wizLoginBtn').disabled,
    err: (document.getElementById('wizLoginError')||{}).textContent || '',
  })`);
  console.log('CLICK_TEST:', t);
  await sleep(3000);
  const t2 = await evalJs(`JSON.stringify({
    btnText: document.getElementById('wizLoginBtn').textContent,
    step2Hidden: document.getElementById('wizardStep2').classList.contains('hidden'),
    wizardHidden: document.getElementById('wizard').classList.contains('hidden'),
  })`);
  console.log('AFTER_3S:', t2);

  // Tab 切换测试（bindTabs 是否生效）
  await evalJs(`document.querySelector('[data-tab="settings"]').click(); true`);
  await sleep(300);
  const tab = await evalJs(`JSON.stringify({
    settingsVisible: !document.getElementById('tab-settings').classList.contains('hidden'),
  })`);
  console.log('TAB_TEST:', tab);
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
