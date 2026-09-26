// 复现 accounts:add 保存失败：CDP 调 addAccount('toutiao')，观察 accounts.json 与日志
const fs = require('fs');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACC = process.env.HOME + '/Library/Application Support/linxgeo-agent/data/accounts.json';

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
    if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 400));
    return r.result && r.result.value;
  };

  console.log('调用前 accounts.json:', fs.readFileSync(ACC, 'utf8').replace(/\s+/g, ' '));
  // 直接调用 preload 暴露的 addAccount（模拟用户点「添加发布账号 → 今日头条」）
  console.log('触发 addAccount(toutiao)…（partition 有登录态应秒完成）');
  const ret = await evalJs(`window.agent.addAccount('toutiao').then(r => JSON.stringify(r)).catch(e => 'REJECT: ' + e.message)`, true);
  console.log('IPC 返回:', ret);
  await sleep(1500);
  console.log('调用后 accounts.json:', fs.readFileSync(ACC, 'utf8').replace(/\s+/g, ' ').slice(0, 400));
  process.exit(0);
})().catch((e) => { console.log('ERR: ' + e.message); process.exit(1); });
