// 打开搜狐登录窗口（无 Cookie）→ dump / 与 /mpbp/main/index.html 两处未登录态 → 关闭
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      const c = { ws, id: 0, pending: new Map() };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data.toString());
        if (msg.id && c.pending.has(msg.id)) {
          const p = c.pending.get(msg.id); c.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      };
      c.send = (method, params = {}) => {
        const mid = ++c.id;
        ws.send(JSON.stringify({ id: mid, method, params }));
        return new Promise((res, rej) => c.pending.set(mid, { resolve: res, reject: rej }));
      };
      c.eval = async (e) => {
        const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
        return r.result && r.result.value;
      };
      resolve(c);
    };
    ws.onerror = (e) => reject(new Error('ws 连接失败'));
  });
}

const DUMP_EXPR = `(() => {
  const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, ph: (i.placeholder || '').slice(0, 20), vis: i.getBoundingClientRect().width > 0 }));
  const btns = Array.from(document.querySelectorAll('button, a')).map(b => (b.textContent || '').trim()).filter(t => t && t.length <= 8).slice(0, 25);
  const txt = (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 600);
  return JSON.stringify({ url: location.href, inputs, btns, txt }, null, 1);
})()`;

(async () => {
  const list0 = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const main = list0.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const cdp = await connect(main.webSocketDebuggerUrl);
  await cdp.eval(`window.agent.addAccount('sohu').catch(() => {}); 'opened'`);
  console.log('已触发打开搜狐登录窗口…');

  let target = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1500);
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    target = list.find((t) => /sohu\.com/.test(t.url));
    if (target) break;
  }
  if (!target) { console.log('搜狐窗口未出现'); process.exit(1); }
  console.log('搜狐窗口: ' + target.url);

  await sleep(8000);
  const sohu = await connect(target.webSocketDebuggerUrl);
  console.log('== 首页未登录态 ==\n' + (await sohu.eval(DUMP_EXPR)));

  await sohu.eval(`location.href = 'https://mp.sohu.com/mpbp/main/index.html'; 'nav'`);
  await sleep(9000);
  console.log('== mpbp 未登录态 ==\n' + (await sohu.eval(DUMP_EXPR)));

  // 关闭窗口
  try { await sohu.send('Page.close'); } catch (e) { try { await sohu.eval('window.close(); "ok"'); } catch (e2) {} }
  console.log('DONE');
  process.exit(0);
})().catch((e) => { console.log('ERR:' + e.message); process.exit(1); });
