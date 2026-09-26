/**
 * 云擎发布助手 —— Electron 主入口（任务包1）
 * 托盘常驻 + 主窗口三页签 + 首次引导 + 本地账号授权。
 * （任务包2 将接入：任务拉取/执行/回传/幂等；任务包3 将接入：自动升级。）
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const store = require('./agent-store');
const { registerIpc, sendToRenderer } = require('./ipc');
const heartbeat = require('./heartbeat');
const taskRunner = require('./task-runner');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// 单实例：第二次启动唤起已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '云擎发布助手',
    backgroundColor: '#F5F7FB',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('ready-to-show', () => mainWindow.show());
  // 关闭主窗口不退出进程（F-103）：托盘常驻
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // 禁止主窗口导航到外部站点（登录窗口不受影响，单独创建）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    // 兜底：1x1 蓝点（build/icon 缺失时不至于崩）
    image = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  }
  image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('云擎发布助手');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.focus();
      else mainWindow.show();
    }
  });
}

app.whenReady().then(() => {
  // 初始化日志/存储
  logger.initLogger(app.getPath('userData'));
  store.initStore(app.getPath('userData'));
  logger.rotate();
  logger.info(`云擎发布助手启动：v${require('../../package.json').version} platform=${process.platform}`);

  createMainWindow();
  createTray();
  registerIpc(mainWindow);

  // 已绑定 → 直接恢复心跳；未绑定 → 首次引导流程由渲染层驱动
  const device = store.getDevice();
  if (device && device.agent_id) {
    heartbeat.startHeartbeat({
      getDevice: store.getDevice,
      getSettings: store.getSettings,
      listAccounts: store.listAccounts,
      unpackDeviceToken: (d) => store.unpackToken(d && d.agent_token),
      onStateChange: (st) => sendToRenderer('heartbeat-state', st),
    });
  }

  // 任务包2：任务执行引擎（每 10s 轮询；未绑定时自动空转，绑定后立即生效）
  taskRunner.startTaskRunner({
    getDevice: store.getDevice,
    getSettings: store.getSettings,
    unpackDeviceToken: (d) => store.unpackToken(d && d.agent_token),
    dataDir: path.join(app.getPath('userData'), 'data'),
    onEvent: (e) => sendToRenderer('task-update', e),
  });

  // 开机自启默认开启（F-101）
  try {
    const settings = store.getSettings();
    if (settings.autoLaunch) app.setLoginItemSettings({ openAtLogin: true });
  } catch (e) { logger.warn(`设置开机自启失败：${e.message}`); }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('before-quit', () => { isQuitting = true; taskRunner.stopTaskRunner(); });
app.on('window-all-closed', () => {
  // 托盘常驻：不因窗口全部关闭而退出（macOS 同理）
});
