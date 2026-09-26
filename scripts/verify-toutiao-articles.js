/**
 * 独立验证：用 Agent 的 partition 登录态打开头条「内容管理」，确认文章是否真实发布。
 * 运行前需退出主 App（避免 userData 内 Cookies 库锁冲突）。
 * 用法：npx electron scripts/verify-toutiao-articles.js
 */
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.setPath('userData', path.join(process.env.HOME, 'Library/Application Support/linxgeo-agent'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linxgeo-toutiao');
    const cookies = await ses.cookies.get({});
    console.log('VERIFY:: partition Cookie 数 = ' + cookies.length);
    const win = new BrowserWindow({
      show: false, width: 1400, height: 900,
      webPreferences: { partition: 'persist:linxgeo-toutiao', contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await win.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await win.loadURL('https://mp.toutiao.com/profile_v4/graphic/articles').catch((e) => console.log('loadURL 异常: ' + e.message));
    await sleep(9000);
    const url = win.webContents.getURL();
    console.log('VERIFY:: 落点 URL = ' + url.slice(0, 100));
    const txt = await win.webContents.executeJavaScript('(document.body && document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 1200)').catch((e) => 'ERR ' + e.message);
    console.log('VERIFY:: 页面文本（前 1200 字）:\n' + txt);
    const found = /冬季门窗保养/.test(txt);
    const hasId = /7678035748343398952/.test(txt);
    console.log('VERIFY:: 找到文章标题 = ' + found + '；页面含文章ID = ' + hasId);
  } catch (e) {
    console.log('VERIFY:: 异常 ' + e.message);
  }
  app.quit();
});
