/**
 * 发布引擎（任务包2 / F-801~F-806）：
 *   用 Electron BrowserWindow + 平台专属 partition 直接发布。
 *
 *   ⚠️ 架构决策（2026-09-25 实测结论）：不使用 Playwright 等外部浏览器。
 *   头条对「Cookie 跨浏览器环境使用」有强风控：即使把 Cookie + localStorage 全量注入
 *   Playwright 启动的 Chrome，autosave 仍返回 code 7050「保存失败」；
 *   而用登录时的同一 Electron partition 窗口，autosave 立即成功（页面提示「草稿已保存」）。
 *   因此发布必须复用本地登录环境（partition），这也正是「本地发布」的产品定位。
 *
 *   成功判定唯一标准：platform_article_id 有值（由适配器通过平台状态校验取得）。
 */
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { platformByKey, partitionOf, realChromeUA } = require('./platforms');
const logger = require('./logger');

// 平台适配器注册表（任务包2 核心五平台；每个独立文件）
const ADAPTERS = {
  toutiao: require('./publish/toutiao'),
};

const TASK_HARD_TIMEOUT_MS = 300000; // 单任务整体超时（5 分钟）

/** 构建适配器运行上下文（封装 Electron webContents 常用操作） */
function buildContext(win, platformKey) {
  const wc = win.webContents;
  const shotsDir = path.join(app.getPath('userData'), 'screenshots');
  return {
    win,
    wc,
    platform: platformKey,
    url: () => { try { return wc.getURL() || ''; } catch (e) { return ''; } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    evalJs: (expr) => wc.executeJavaScript(expr).catch(() => null),
    async goto(url, settleMs = 2500) {
      await wc.loadURL(url).catch((e) => { throw new Error(`打开页面失败：${e.message}`); });
      await new Promise((r) => setTimeout(r, settleMs));
      return wc.getURL();
    },
    async snapshot(tag) {
      try {
        fs.mkdirSync(shotsDir, { recursive: true });
        const file = path.join(shotsDir, `${tag}-${Date.now()}.png`);
        const img = await wc.capturePage();
        fs.writeFileSync(file, img.toPNG());
        return fs.existsSync(file) && fs.statSync(file).size > 0 ? file : '';
      } catch (e) { return ''; }
    },
  };
}

/**
 * 执行发布任务：返回 { platform_article_id, publish_url }
 * 失败抛 Error（fail_reason = e.message）
 */
async function runPublishTask(task) {
  const plat = platformByKey(task.platform);
  if (!plat) throw new Error(`未知平台：${task.platform}`);
  const adapter = ADAPTERS[task.platform];
  if (!adapter) throw new Error(`平台 ${plat.name} 适配开发中（任务包2/4）`);

  // 登录态预检（partition = 平台专属，与授权的浏览器环境完全一致）
  const ses = session.fromPartition(partitionOf(task.platform));
  const all = await ses.cookies.get({});
  const domainCookies = all.filter((c) => plat.cookieDomains.some((d) => String(c.domain || '').includes(d)));
  if (domainCookies.length === 0) throw new Error(`本地无 ${plat.name} 登录态，请先在「发布账号」页完成授权`);
  logger.info(`[publish] 任务#${task.id} ${plat.name}：partition 登录态 ${domainCookies.length} 个 Cookie，创建发布窗口…`);

  const win = new BrowserWindow({
    show: false, // 后台静默发布（禁用渲染节流，保证 DOM 事件正常）
    width: 1440,
    height: 900,
    webPreferences: {
      partition: partitionOf(task.platform),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      images: true,
    },
  });
  try { win.webContents.setUserAgent(realChromeUA()); } catch (e) { /* ignore */ }

  const ctx = buildContext(win, task.platform);
  let hardTimer = null;
  const hardTimeout = new Promise((_, reject) => {
    hardTimer = setTimeout(() => reject(new Error(`发布整体超时（${TASK_HARD_TIMEOUT_MS / 1000}s）`)), TASK_HARD_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([adapter.publish(ctx, task, { logger }), hardTimeout]);
    if (!result || !result.platform_article_id) {
      throw new Error('发布流程完成但未取到平台文章ID（platform_article_id），按失败处理');
    }
    logger.info(`[publish] 任务#${task.id} ${plat.name} 发布成功：article=${result.platform_article_id}`);
    return { platform_article_id: String(result.platform_article_id), publish_url: result.publish_url || '' };
  } finally {
    clearTimeout(hardTimer);
    try { if (!win.isDestroyed()) win.destroy(); } catch (e) { /* ignore */ }
  }
}

module.exports = { runPublishTask, ADAPTERS };
