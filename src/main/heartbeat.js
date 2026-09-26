/**
 * 心跳（F-501/F-502）：每 30s 上报在线状态、版本、已授权账号数。
 * 心跳失败（断网）→ 本地标记离线，任务排队（任务包2）。
 */
const cloudApi = require('./cloud-api');
const logger = require('./logger');

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

let timer = null;
let deps = null;
let state = { online: false, lastHeartbeatAt: null, lastError: '' };

async function tick() {
  if (!deps) return;
  try {
    const device = deps.getDevice();
    if (!device) return; // 未绑定不心跳
    const settings = deps.getSettings();
    const token = deps.unpackDeviceToken(device);
    await cloudApi.heartbeat(settings.baseUrl, device.agent_id, token, {
      status: 'online',
      accountCount: deps.listAccounts().length,
    });
    state = { online: true, lastHeartbeatAt: new Date().toISOString(), lastError: '' };
  } catch (e) {
    state = { online: false, lastHeartbeatAt: state.lastHeartbeatAt, lastError: e.message };
    logger.warn(`[heartbeat] 心跳失败：${e.message}`);
  }
  if (deps.onStateChange) {
    try { deps.onStateChange({ ...state }); } catch (e) { /* ignore */ }
  }
}

function startHeartbeat(d) {
  deps = d;
  if (timer) clearInterval(timer);
  tick(); // 立即先跑一次
  timer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (timer) clearInterval(timer);
  timer = null;
  deps = null;
  state = { online: false, lastHeartbeatAt: null, lastError: '' };
}

function heartbeatStatus() { return { ...state }; }

module.exports = { startHeartbeat, stopHeartbeat, heartbeatStatus };
