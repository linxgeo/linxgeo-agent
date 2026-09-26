/**
 * 云端 API 客户端（PRD §4）：
 *   login → bind →（heartbeat 30s / accounts register / status / unbind / version）
 * 安全约定：所有请求【不携带】任何平台账号凭证；agent 鉴权 = x-agent-id + x-agent-token 头。
 */
const APP_VERSION = require('../../package.json').version;

class CloudApiError extends Error {
  constructor(message, code) { super(message); this.code = code || 0; }
}

async function postJson(baseUrl, urlPath, { body, headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.code !== 200) {
      throw new CloudApiError(data.message || `请求失败（HTTP ${resp.status}）`, data.code || resp.status);
    }
    return data.data;
  } catch (e) {
    if (e instanceof CloudApiError) throw e;
    if (e.name === 'AbortError') throw new CloudApiError('连接云端超时，请检查网络或服务器地址', 0);
    throw new CloudApiError(`连接云端失败：${e.message}`, 0);
  } finally {
    clearTimeout(t);
  }
}

async function getJson(baseUrl, urlPath, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}${urlPath}`, { headers, signal: ctrl.signal });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.code !== 200) {
      throw new CloudApiError(data.message || `请求失败（HTTP ${resp.status}）`, data.code || resp.status);
    }
    return data.data;
  } catch (e) {
    if (e instanceof CloudApiError) throw e;
    if (e.name === 'AbortError') throw new CloudApiError('连接云端超时', 0);
    throw new CloudApiError(`连接云端失败：${e.message}`, 0);
  } finally {
    clearTimeout(t);
  }
}

// —— 平台账号登录（LINX-IGN 账号，非发布平台账号）——
async function login(baseUrl, username, password) {
  return postJson(baseUrl, '/api/auth/login', { body: { username, password } });
}

// —— 设备绑定（JWT）→ { agent_id, agent_token, user } ——
async function bind(baseUrl, jwt, { deviceName, version = APP_VERSION, agentId = '' }) {
  return postJson(baseUrl, '/api/agent/bind', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { device_name: deviceName, version, agent_id: agentId },
  });
}

function agentHeaders(agentId, agentToken) {
  return { 'x-agent-id': agentId, 'x-agent-token': agentToken };
}

// —— 心跳（30s）——
async function heartbeat(baseUrl, agentId, agentToken, { status = 'online', accountCount = 0 } = {}) {
  return postJson(baseUrl, '/api/agent/heartbeat', {
    headers: agentHeaders(agentId, agentToken),
    body: { status, version: APP_VERSION, account_count: accountCount },
    timeoutMs: 10000,
  });
}

// —— 登记授权账号元信息（只传昵称/平台/时间，零凭证）——
async function registerAccount(baseUrl, agentId, agentToken, { platform, accountNickname, authorizedAt, expireAt }) {
  return postJson(baseUrl, '/api/agent/accounts/register', {
    headers: agentHeaders(agentId, agentToken),
    body: {
      platform,
      account_nickname: accountNickname,
      authorized_at: authorizedAt || '',
      expire_at: expireAt || '',
    },
  });
}

// —— 上报账号有效性 ——
async function reportAccountStatus(baseUrl, agentId, agentToken, { platform, status }) {
  return postJson(baseUrl, '/api/agent/accounts/status', {
    headers: agentHeaders(agentId, agentToken),
    body: { platform, status },
  });
}

// —— 解绑账号（云端清状态；本地登录态由 Agent 删除）——
async function unbindAccount(baseUrl, agentId, agentToken, { platform }) {
  return postJson(baseUrl, '/api/agent/accounts/unbind', {
    headers: agentHeaders(agentId, agentToken),
    body: { platform },
  });
}

// —— 版本检查（任务包3 接真实升级）——
async function checkVersion(baseUrl) {
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
  // macOS 区分架构：arm64 / x64；Windows 统一 x64
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return getJson(baseUrl, `/api/agent/version?platform=${platform}&arch=${arch}`, { timeoutMs: 10000 });
}

// —— 任务包2：拉取待执行任务（pending + 本机 interrupted）——
async function fetchTasks(baseUrl, agentId, agentToken, { limit = 5 } = {}) {
  return getJson(baseUrl, `/api/agent/tasks?limit=${limit}`, { headers: agentHeaders(agentId, agentToken), timeoutMs: 15000 });
}

// —— 任务包2：回传执行结果 ——
async function reportTaskResult(baseUrl, agentId, agentToken, taskId, { status, platformArticleId, publishUrl, failReason }) {
  return postJson(baseUrl, `/api/agent/tasks/${taskId}/result`, {
    headers: agentHeaders(agentId, agentToken),
    body: {
      status,
      platform_article_id: platformArticleId || '',
      publish_url: publishUrl || '',
      fail_reason: failReason || '',
    },
    timeoutMs: 20000,
  });
}

module.exports = { APP_VERSION, CloudApiError, login, bind, heartbeat, registerAccount, reportAccountStatus, unbindAccount, checkVersion, fetchTasks, reportTaskResult };
