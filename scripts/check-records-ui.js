// 验证发布记录页签渲染（任务#1 违规拦截 + 任务#2 登录态失效）
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
  };

  await evalJs(`document.querySelector('[data-tab="records"]').click(); true`);
  await sleep(800);
  const state = await evalJs(`(() => {
    const cards = Array.from(document.querySelectorAll('#records-list .account-card'));
    return JSON.stringify({
      count: cards.length,
      empty: document.getElementById('records-empty').classList.contains('hidden'),
      texts: cards.map(c => c.textContent.replace(/\\s+/g, ' ').slice(0, 90)),
    });
  })()`);
  console.log('records 页签状态：', state);
  const parsed = JSON.parse(state);
  if (parsed.count < 2 || !parsed.empty) throw new Error('记录卡未渲染');
  const all = parsed.texts.join('');
  if (!all.includes('发布失败') || !all.includes('合规预检拦截') || !all.includes('登录态已失效')) throw new Error('失败原因未显示');
  console.log('RECORDS_UI_PASS');
  process.exit(0);
})().catch((e) => { console.log('ERR:' + e.message); process.exit(1); });
