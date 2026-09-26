/**
 * 关键假设验证：用 Electron partition 窗口（与登录同一浏览器环境）填文，
 * 观察头条 autosave 是否仍返回 7050。
 * 若 autosave 正常（返回有效 pgc_id）→ 确认 7050 根因是「Playwright 跨设备指纹」，
 * 发布通道应改为 Electron BrowserWindow。
 * 运行前请退出主 App。
 * 用法：npx electron scripts/verify-electron-publish-path.js
 */
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.setPath('userData', path.join(process.env.HOME, 'Library/Application Support/linxgeo-agent'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TITLE = '冬季门窗保养的五个实用建议';
const CONTENT = '入冬后气温下降，门窗的密封性能直接关系到室内保温效果与采暖能耗。以下是五个实用的保养建议。'

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:linxgeo-toutiao');
  const win = new BrowserWindow({
    show: true, width: 1280, height: 860,
    webPreferences: { partition: 'persist:linxgeo-toutiao', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

  // 用 webRequest 监听接口 URL（拿不到 body，但能确认请求是否发出）
  const hitUrls = [];
  ses.webRequest.onCompleted({ urls: ['*://mp.toutiao.com/*'] }, (details) => {
    if (/article\/(publish|edit)/.test(details.url)) hitUrls.push(`${details.method} ${details.url.split('?')[0]} ${details.statusCode}`);
  });

  console.log('VERIFY:: 打开发布页…');
  await win.loadURL('https://mp.toutiao.com/profile_v4/graphic/publish').catch((e) => console.log('loadERR ' + e.message));
  await sleep(9000);
  console.log('VERIFY:: 落点 ' + win.webContents.getURL().slice(0, 90));

  // 关草稿恢复条（与适配器同逻辑）
  const closed = await win.webContents.executeJavaScript(`(() => {
    const cs = Array.from(document.querySelectorAll('div'));
    for (const c of cs) {
      if (c.children.length > 6 || c.children.length === 0) continue;
      if (/继续编辑|更多草稿/.test(c.textContent || '')) { const b = c.querySelector('[class*="close"]'); if (b) { b.click(); return true; } }
    }
    return false;
  })()`).catch(() => false);
  console.log('VERIFY:: 草稿条关闭=' + closed);
  await sleep(2500);

  // 填标题（原生 setter + input 事件）
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('textarea[placeholder*="标题"]') || document.querySelector('textarea');
    if (!el) return 'no-title';
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(TITLE)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`).then((r) => console.log('VERIFY:: 标题填充=' + r));

  // 填正文（execCommand insertText，触发 input 事件供 ProseMirror 接收）
  await win.webContents.executeJavaScript(`(() => {
    const ed = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    if (!ed) return 'no-editor';
    ed.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(CONTENT)});
    return 'ok:' + (ed.innerText || '').length;
  })()`).then((r) => console.log('VERIFY:: 正文填充=' + r));

  console.log('VERIFY:: 等 autosave…');
  await sleep(12000);

  console.log('VERIFY:: 接口命中 ' + hitUrls.length + ' 条：');
  for (const u of hitUrls) console.log('  - ' + u);

  // 页面保存状态提示（头条编辑页有「保存中/已保存/保存失败」提示）
  const state = await win.webContents.executeJavaScript(`(() => {
    const txt = document.body ? (document.body.innerText || '') : '';
    const saveHints = [];
    for (const m of txt.matchAll(/(保存中|已保存|保存失败|自动保存|草稿已保存)/g)) saveHints.push(m[1]);
    const titleEl = document.querySelector('textarea[placeholder*="标题"]') || document.querySelector('textarea');
    const ed = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    const notices = Array.from(document.querySelectorAll('[class*="message"],[class*="toast"],[class*="tip"],[class*="error"]'))
      .map(e => (e.innerText || '').trim()).filter(t => t && t.length <= 80).slice(0, 6);
    return JSON.stringify({ saveHints: [...new Set(saveHints)], titleVal: titleEl ? (titleEl.value || '').slice(0, 30) : '(无标题框)', editorLen: ed ? (ed.innerText || '').length : -1, notices });
  })()`).catch((e) => 'ERR ' + e.message);
  console.log('VERIFY:: 页面状态 = ' + state);

  const fs = require('fs');
  const shot = '/tmp/verify-electron-publish.png';
  await win.capturePage().then((img) => fs.writeFileSync(shot, img.toPNG())).catch(() => {});
  console.log('VERIFY:: 截图 = ' + shot);

  await sleep(3000);
  app.quit();
});
