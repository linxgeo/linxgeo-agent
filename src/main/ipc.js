/**
 * IPC 处理层：渲染进程 ⇆ 主进程（账号授权 / 设备绑定 / 设置 / 日志）
 */
const os = require('os');
const { ipcMain, dialog, app, shell } = require('electron');
const store = require('./agent-store');
const cloudApi = require('./cloud-api');
const { openPlatformLogin, clearPlatformLogin } = require('./login-flow');
const { validateAccount } = require('./account-validator');
const { platformByKey, platformList } = require('./platforms');
const logger = require('./logger');
const heartbeat = require('./heartbeat');
const taskRunner = require('./task-runner');

let mainWindow = null;
let busy = false; // 是否正在执行发布任务（任务包2 使用）

function deviceTokenOf(device) { return store.unpackToken(device && device.agent_token); }

function sendToRenderer(channel, payload) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch (e) { /* ignore */ }
}

function cloudBase() { return store.getSettings().baseUrl; }

function registerIpc(win) {
  mainWindow = win;

  // ===== 设备 =====
  ipcMain.handle('device:get', () => {
    const device = store.getDevice();
    const bound = !!(device && device.agent_id);
    return {
      bound,
      version: cloudApi.APP_VERSION,
      device: bound ? { agent_id: device.agent_id, user: device.user, device_name: device.device_name, base_url: device.base_url } : null,
      heartbeat: heartbeat.heartbeatStatus(),
    };
  });

  // 首次引导步骤①：登录平台账号 + 绑定设备
  ipcMain.handle('device:login', async (_e, { username, password, baseUrl }) => {
    if (!username || !password) return { ok: false, message: '请输入账号和密码' };
    const settings = store.getSettings();
    const base = (baseUrl || settings.baseUrl || '').trim();
    if (!/^https?:\/\//.test(base)) return { ok: false, message: '服务器地址格式不正确（应以 https:// 开头）' };
    try {
      // 1) 登录 LINX-IGN 平台账号
      const loginData = await cloudApi.login(base, String(username).trim(), String(password));
      const jwt = loginData.token;
      // 2) 绑定设备（已有 agent_id 则原设备重绑，轮换 token）
      const prev = store.getDevice();
      const deviceName = `${os.hostname() || '我的电脑'}（${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'}）`;
      const bindData = await cloudApi.bind(base, jwt, { deviceName, agentId: prev && prev.agent_id ? prev.agent_id : '' });
      // 3) 保存绑定信息（token 加密存本地）
      store.saveSettings({ baseUrl: base });
      store.saveDevice({
        agent_id: bindData.agent_id,
        agent_token: store.packToken(bindData.agent_token),
        user: bindData.user || { id: loginData.user.id, nickname: loginData.user.nickname },
        device_name: deviceName,
        base_url: base,
        bound_at: new Date().toISOString(),
      });
      heartbeat.startHeartbeat({
        getDevice: store.getDevice,
        getSettings: store.getSettings,
        listAccounts: store.listAccounts,
        unpackDeviceToken: deviceTokenOf,
        onStateChange: (st) => sendToRenderer('heartbeat-state', st),
      });
      logger.info(`设备绑定成功：agent=${bindData.agent_id} user=${bindData.user && bindData.user.nickname}`);
      return { ok: true, device: store.getDevice(), user: bindData.user };
    } catch (e) {
      logger.warn(`设备绑定失败：${e.message}`);
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('device:logout', () => {
    store.clearDevice();
    heartbeat.stopHeartbeat();
    logger.info('设备已解除绑定');
    return { ok: true };
  });

  // ===== 账号 =====
  ipcMain.handle('accounts:list', () => store.publicAccounts());

  ipcMain.handle('accounts:platforms', () => platformList());

  // 添加发布账号（首次引导步骤② / 主界面）
  ipcMain.handle('accounts:add', async (_e, platformKey) => {
    const plat = platformByKey(platformKey);
    if (!plat) return { ok: false, message: `未知平台：${platformKey}` };
    const device = store.getDevice();
    if (!device) return { ok: false, message: '请先完成平台账号登录（设备未绑定）' };

    // 打开本地登录窗口，等客户完成登录
    const result = await openPlatformLogin(platformKey, mainWindow);
    if (!result.success) return { ok: false, message: result.error || '未完成登录' };

    // 登录态加密存本地（绝不上传）
    const saved = store.upsertAccount({
      platform: platformKey,
      platform_name: plat.name,
      nickname: result.nickname,
      status: 'valid',
      authorized_at: new Date().toISOString(),
      expire_at: result.expireAt,
      cookies: store.packCookies(result.cookies),
    });
    // 云端只登记元信息
    try {
      await cloudApi.registerAccount(cloudBase(), device.agent_id, deviceTokenOf(device), {
        platform: platformKey,
        accountNickname: result.nickname,
        authorizedAt: saved.authorized_at,
        expireAt: saved.expire_at,
      });
    } catch (e) {
      logger.warn(`云端账号登记失败（不影响本地使用）：${e.message}`);
    }
    sendToRenderer('account-added', { ...saved, cookies: undefined });
    const { cookies, ...pub } = saved;
    return { ok: true, account: pub };
  });

  // 解除授权：本地登录态删除 + 云端清状态
  ipcMain.handle('accounts:remove', async (_e, accountId) => {
    const list = store.listAccounts();
    const acc = list.find((a) => a.id === accountId);
    if (!acc) return { ok: false, message: '账号不存在' };
    const device = store.getDevice();
    store.removeAccountById(accountId);
    await clearPlatformLogin(acc.platform);
    if (device) {
      try {
        await cloudApi.unbindAccount(cloudBase(), device.agent_id, deviceTokenOf(device), { platform: acc.platform });
      } catch (e) { logger.warn(`云端解绑上报失败：${e.message}`); }
    }
    logger.info(`已解除授权：${acc.platform_name}（本地登录态已清除）`);
    return { ok: true };
  });

  // 单账号检测（F-013 / F-204 / TC-06）
  ipcMain.handle('accounts:check', async (_e, accountId) => {
    const list = store.listAccounts();
    const acc = list.find((a) => a.id === accountId);
    if (!acc) return { ok: false, message: '账号不存在' };
    const status = await validateAccount(acc);
    store.updateAccountStatus(accountId, status);
    const device = store.getDevice();
    if (device) {
      try {
        await cloudApi.reportAccountStatus(cloudBase(), device.agent_id, deviceTokenOf(device), { platform: acc.platform, status });
      } catch (e) { logger.warn(`检测结果上报失败：${e.message}`); }
    }
    logger.info(`检测结果：${acc.platform_name} → ${status === 'valid' ? '有效' : '需重新授权'}`);
    return { ok: true, status };
  });

  // 一键检测（F-014）：Agent 已绑定的全部账号
  ipcMain.handle('accounts:checkAll', async () => {
    const list = store.listAccounts();
    const results = [];
    for (const acc of list) {
      const status = await validateAccount(acc);
      store.updateAccountStatus(acc.id, status);
      results.push({ id: acc.id, platform: acc.platform, platform_name: acc.platform_name, status });
      sendToRenderer('account-check-progress', { id: acc.id, status });
    }
    const device = store.getDevice();
    if (device) {
      for (const r of results) {
        try {
          await cloudApi.reportAccountStatus(cloudBase(), device.agent_id, deviceTokenOf(device), { platform: r.platform, status: r.status });
        } catch (e) { /* 单个上报失败忽略 */ }
      }
    }
    return { ok: true, results };
  });

  // ===== 发布记录（任务包2）=====
  ipcMain.handle('tasks:records', () => ({ ok: true, records: taskRunner.listRecentRecords(), busy: taskRunner.isBusy() }));

  // ===== 设置 =====
  ipcMain.handle('settings:get', () => {
    const s = store.getSettings();
    return { ...s, autoLaunchEffective: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('settings:save', (_e, patch) => {
    const s = store.saveSettings(patch || {});
    if (typeof patch.autoLaunch === 'boolean') {
      try { app.setLoginItemSettings({ openAtLogin: patch.autoLaunch }); } catch (e) { logger.warn(`设置开机自启失败：${e.message}`); }
    }
    return { ok: true, settings: s };
  });

  // ===== 日志 / 升级 =====
  ipcMain.handle('logs:export', async () => {
    const win = mainWindow;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出日志',
      defaultPath: `linxgeo-agent-logs-${Date.now()}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, message: '已取消' };
    try {
      require('fs').writeFileSync(filePath, logger.exportAll(), 'utf8');
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, message: `导出失败：${e.message}` };
    }
  });

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const v = await cloudApi.checkVersion(cloudBase());
      const hasUpdate = v.latest && v.latest !== cloudApi.APP_VERSION;
      return { ok: true, latest: v.latest, hasUpdate, releaseNote: v.release_note || '', force: !!v.force, url: v.url || '' };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url));
    return { ok: true };
  });
}

module.exports = { registerIpc, sendToRenderer };
