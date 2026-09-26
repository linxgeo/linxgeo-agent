/**
 * 授权有效性检测（F-204 / TC-06）：
 *   ① Cookie 前置闸门：partition 里无平台 Cookie / 缺关键 Cookie → 直接 invalid（不发请求，快速且可靠）
 *   ② 用账号对应 partition 里的登录态静默访问创作页入口：
 *      被重定向到登录页 URL → invalid；仍停留在创作页 → DOM 轮询探测（最长 20s）：
 *      出现登录表单/登录引导 → invalid；出现创作台内容 → valid；超时无信号 → invalid（保守判定）。
 *   失效账号标记「需重新授权」，发布前会再次拦截（任务包2 接入发布队列过滤）。
 */
const { BrowserWindow, session } = require('electron');
const { platformByKey, partitionOf, realChromeUA } = require('./platforms');
const logger = require('./logger');

const PROBE_TIMEOUT_MS = 30000; // 硬超时（含页面加载）
const PROBE_POLL_MS = 2000; // DOM 轮询间隔
const PROBE_MAX_POLLS = 10; // 最多轮询 10 次（20s）

/** ① Cookie 前置闸门：返回 true=Cookie 充足可继续探测；false=直接判 invalid */
async function cookieGate(plat) {
  const ses = session.fromPartition(partitionOf(plat.key));
  const all = await ses.cookies.get({});
  const domainCookies = all.filter((c) => plat.cookieDomains.some((d) => (c.domain || '').includes(d)));
  if (domainCookies.length === 0) return { pass: false, reason: 'no-cookie' };
  if (plat.essentialCookies && plat.essentialCookies.length > 0) {
    const names = new Set(domainCookies.map((c) => c.name));
    const missing = plat.essentialCookies.filter((n) => !names.has(n));
    if (missing.length > 0) return { pass: false, reason: 'missing:' + missing.join(',') };
  }
  return { pass: true, cookieCount: domainCookies.length };
}

// DOM 探测脚本：返回 { login: bool, dashboard: bool, detail }
const PROBE_EXPR = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pwdCount = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible).length;
  const txt = document.body ? (document.body.innerText || '') : '';
  const hasLoginCta = /扫码登录|账号登录|立即登录|请先登录|登录后查看/.test(txt);
  const hasDashboard = /写文章|发布文章|创作中心|发布内容|内容管理|素材管理|数据统计/.test(txt);
  return { pwdCount, hasLoginCta, hasDashboard };
})()`;

async function validateAccount(account) {
  const plat = platformByKey(account.platform);
  if (!plat) return 'invalid';

  // ===== ① Cookie 前置闸门 =====
  let gate;
  try { gate = await cookieGate(plat); } catch (e) { gate = { pass: true, reason: 'gate-error:' + e.message }; }
  if (!gate.pass) {
    logger.info(`[validator] ${plat.name} Cookie 闸门未过（${gate.reason}）→ 需重新授权`);
    return 'invalid';
  }
  logger.info(`[validator] ${plat.name} Cookie 闸门通过（${gate.cookieCount} 个域 Cookie），开窗口探测…`);

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        partition: partitionOf(account.platform),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    try { win.webContents.setUserAgent(realChromeUA()); } catch (e) { /* ignore */ }

    let done = false;
    let pollTimer = null;
    let pollCount = 0;
    const finish = (status, why) => {
      if (done) return;
      done = true;
      clearTimeout(hardTimer);
      if (pollTimer) clearTimeout(pollTimer);
      try { if (!win.isDestroyed()) win.destroy(); } catch (e) { /* ignore */ }
      logger.info(`[validator] ${plat.name} 判定=${status}（${why}）`);
      resolve(status);
    };

    // ===== ② DOM 轮询探测（did-finish-load 后开始）=====
    async function pollOnce() {
      if (done || win.isDestroyed()) return;
      pollCount++;
      const url = win.webContents.getURL() || '';
      if (plat.invalidUrl.test(url)) return finish('invalid', `URL 命中失效规则: ${url.slice(0, 90)}`);
      if (!plat.successUrl.test(url)) return finish('invalid', `URL 落点非创作页: ${url.slice(0, 90)}`);
      try {
        const probe = await win.webContents.executeJavaScript(PROBE_EXPR);
        const p = probe || {};
        if (p.pwdCount > 0) return finish('invalid', `可见登录表单（密码框 x${p.pwdCount}）`);
        if (p.hasLoginCta && !p.hasDashboard) return finish('invalid', '登录引导且无创作台内容');
        if (p.hasDashboard) return finish('valid', `创作台内容已渲染（第 ${pollCount} 轮）`);
        logger.info(`[validator] ${plat.name} 第 ${pollCount} 轮无信号，继续…`);
      } catch (e) { /* DOM 探测失败按 URL 结论，继续轮询 */ }
      if (pollCount >= PROBE_MAX_POLLS) return finish('invalid', `探测超时（${PROBE_MAX_POLLS} 轮无有效信号，保守判定）`);
      pollTimer = setTimeout(pollOnce, PROBE_POLL_MS);
    }

    win.webContents.on('did-finish-load', () => {
      if (done) return;
      // 首轮等 3s 给 SPA 渲染，之后每 2s 轮询
      pollTimer = setTimeout(pollOnce, 3000);
    });

    const hardTimer = setTimeout(() => finish('invalid', '硬超时'), PROBE_TIMEOUT_MS);
    win.loadURL(plat.entryUrl).catch((e) => finish('invalid', '页面加载失败: ' + e.message));
    logger.info(`[validator] 检测 ${plat.name} 登录态：${plat.entryUrl}`);
  });
}

// 批量检测（一键检测）：逐个串行，避免同时开多个隐藏窗口
async function validateAll(accounts, onProgress) {
  const results = {};
  for (const acc of accounts) {
    const status = await validateAccount(acc);
    results[acc.id] = status;
    if (onProgress) onProgress(acc, status);
  }
  return results;
}

module.exports = { validateAccount, validateAll };
