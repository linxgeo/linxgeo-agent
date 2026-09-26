// 1) 读 UI 账号卡片 2) 触发头条检测 3) 报告登录态是否有效
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
  const evalJs = async (e, awaitPromise = false) => {
    const r = await new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise } }));
    });
    if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
  };

  // 先刷新渲染层账号列表（触发 accounts:list 重读文件）
  await evalJs(`document.querySelector('[data-tab="accounts"]').click(); true`);
  await evalJs(`window.agent.listAccounts().then(l => { window.__accs = l; return l.length; })`, true);
  await sleep(600);
  const cards = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.account-card')).map(c => c.textContent.replace(/\\s+/g,' ').slice(0,60)))`);
  console.log('UI 卡片:', cards);

  const readTag = `(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('今日头条')); return c ? (c.textContent.includes('检测中') ? 'checking' : c.textContent.includes('需重新授权') ? 'invalid' : 'valid') : 'none'; })()`;
  await evalJs(`(() => { const cs = Array.from(document.querySelectorAll('.account-card')); const c = cs.find(x => x.textContent.includes('今日头条')); if (c) c.querySelector('[data-act="check"]').click(); return 1; })()`);
  console.log('已点检测，等待结果…');
  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    const t = await evalJs(readTag);
    if (t === 'valid' || t === 'invalid') { console.log('RESULT=' + t); process.exit(0); }
  }
  console.log('RESULT=timeout');
  process.exit(1);
})().catch((e) => { console.log('ERR: ' + e.message); process.exit(1); });
