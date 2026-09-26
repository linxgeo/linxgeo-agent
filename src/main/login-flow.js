/**
 * 本地账号授权（F-201~F-205）：
 *   点【添加发布账号】→ 打开 Agent 自带浏览器窗口（独立 partition 会话，登录态本地持久化）
 *   → 客户自己在窗口里登录平台 → URL 命中创作页 → 采集 Cookie（safeStorage 加密存本地）
 *   → 云端只登记元信息（昵称/平台/授权时间）。
 */
const { BrowserWindow, session } = require('electron');
const { platformByKey, partitionOf, realChromeUA } = require('./platforms');
const logger = require('./logger');

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000; // 客户可能要短信验证/扫码，给足 15 分钟
const SETTLE_MS = 2500;                   // 命中成功 URL 后等 Cookie 落定

function domainMatches(cookieDomain, suffixes) {
  const d = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
  return suffixes.some((s) => d === s || d.endsWith('.' + s));
}

async function scrapeNickname(win, selectors) {
  try {
    const sels = JSON.stringify(selectors || []);
    const text = await win.webContents.executeJavaScript(`(() => {
      const sels = ${sels};
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          const t = el && el.innerText ? el.innerText.trim() : '';
          if (t && t.length > 0 && t.length <= 30) return t;
        } catch (e) {}
      }
      return '';
    })()`);
    if (text) return String(text).slice(0, 40);
  } catch (e) { /* 页面导航中，忽略 */ }
  return '';
}

/**
 * 打开平台登录窗口，等待客户完成登录。
 * @returns {Promise<{success:boolean, nickname?:string, cookies?:Array, error?:string, expireAt?:string}>}
 */
function openPlatformLogin(platformKey, parentWin) {
  return new Promise((resolve) => {
    const plat = platformByKey(platformKey);
    if (!plat) return resolve({ success: false, error: `未知平台：${platformKey}` });

    const ses = session.fromPartition(partitionOf(platformKey));
    const win = new BrowserWindow({
      width: 1120,
      height: 780,
      parent: parentWin || null,
      title: `登录${plat.name} —— 完成登录后窗口会自动关闭`,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: partitionOf(platformKey),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // 用与真实系统一致的 Chrome UA（Electron 默认 UA 带 Electron 标记，部分平台会拦截）
    try { win.webContents.setUserAgent(realChromeUA()); } catch (e) { /* ignore */ }
    win.setMenuBarVisibility(false);

    let settled = false;
    let successUrlStableCount = 0;
    let lastUrl = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      try { if (!win.isDestroyed()) win.destroy(); } catch (e) { /* ignore */ }
      resolve(result);
    };

    const pollTimer = setInterval(async () => {
      if (win.isDestroyed()) return finish({ success: false, error: '登录窗口已关闭' });
      try {
        const url = win.webContents.getURL() || '';
        if (plat.successUrl.test(url)) {
          // URL 连续两次稳定在创作页（防多级重定向误判）再收 Cookie
          if (url === lastUrl) successUrlStableCount += 1;
          else successUrlStableCount = 0;
          lastUrl = url;
          if (successUrlStableCount >= 2) {
            successUrlStableCount = -999; // 防重复触发
            clearInterval(pollTimer);
            logger.info(`[${plat.key}] 检测到登录成功 URL：${url.slice(0, 80)}，等待 Cookie 落定…`);
            setTimeout(async () => {
              try {
                const all = await ses.cookies.get({});
                const cookies = all.filter((c) => domainMatches(c.domain, plat.cookieDomains));
                const hasEssential = (plat.essentialCookies || []).every((n) => cookies.some((c) => c.name === n));
                if (!cookies.length || !hasEssential) {
                  logger.warn(`[${plat.key}] Cookie 采集不足（${cookies.length} 个，关键字段 ${hasEssential ? '齐' : '缺'}），请重试`);
                  return finish({ success: false, error: '登录态采集失败（Cookie 不完整），请重新添加账号' });
                }
                const nickname = (await scrapeNickname(win, plat.nicknameSelectors)) || `${plat.name}账号`;
                const maxExpire = cookies.reduce((m, c) => Math.max(m, Number(c.expirationDate || 0) * 1000 || 0), 0);
                const expireAt = maxExpire > Date.now() ? new Date(maxExpire).toISOString() : new Date(Date.now() + 30 * 86400e3).toISOString();
                logger.info(`[${plat.key}] 登录态采集成功：${cookies.length} 个 Cookie，昵称="${nickname}"`);
                finish({ success: true, nickname, cookies, expireAt });
              } catch (e) {
                finish({ success: false, error: `登录态采集异常：${e.message}` });
              }
            }, SETTLE_MS);
          }
        } else {
          lastUrl = url;
          successUrlStableCount = 0;
        }
      } catch (e) { /* 页面导航中，忽略 */ }
    }, 1500);

    const timeoutTimer = setTimeout(() => {
      finish({ success: false, error: '登录超时（15 分钟），可重新点击添加账号继续' });
    }, LOGIN_TIMEOUT_MS);

    win.on('closed', () => finish({ success: false, error: '已取消登录' }));
    win.loadURL(plat.loginUrl).catch((e) => finish({ success: false, error: `打开登录页失败：${e.message}` }));
    logger.info(`[${plat.key}] 打开本地登录窗口：${plat.loginUrl}`);
  });
}

/**
 * 清除某平台本地登录态（F-203 解除授权 / F-013 解绑）
 */
async function clearPlatformLogin(platformKey) {
  const plat = platformByKey(platformKey);
  if (!plat) return;
  try {
    const ses = session.fromPartition(partitionOf(platformKey));
    await ses.clearStorageData();
    logger.info(`[${plat.key}] 本地登录态已清除`);
  } catch (e) {
    logger.warn(`[${plat.key}] 清除登录态失败：${e.message}`);
  }
}

module.exports = { openPlatformLogin, clearPlatformLogin };
