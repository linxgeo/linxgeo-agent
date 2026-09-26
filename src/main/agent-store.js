/**
 * 本地存储（F-202 / F-402）：
 *   device.json    —— 设备绑定信息（agent_id + agentToken，token 经 safeStorage 加密）
 *   accounts.json  —— 已授权账号元信息 + 登录态（Cookie JSON 经 safeStorage 加密为 blob）
 *   settings.json  —— 用户设置
 *
 * ⚠️ 红线：登录态（Cookie）只存在本文件（加密 blob），绝不出本地（PRD §5）。
 * 写入采用 tmp + rename 原子操作，避免断电损坏。
 */
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

let dataDir = '';

function initStore(userDataPath) {
  dataDir = path.join(userDataPath, 'data');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) { /* ignore */ }
}

function encAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; }
}
function encrypt(plain) {
  try {
    if (encAvailable()) return { enc: true, blob: safeStorage.encryptString(plain).toString('base64') };
  } catch (e) { /* 落到明文兜底 */ }
  return { enc: false, blob: Buffer.from(plain, 'utf8').toString('base64') };
}
function decrypt(record) {
  if (!record) return '';
  try {
    if (record.enc) return safeStorage.decryptString(Buffer.from(record.blob, 'base64'));
    return Buffer.from(record.blob, 'base64').toString('utf8');
  } catch (e) { return ''; }
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch (e) { return fallback; }
}
function writeJson(name, obj) {
  const tmp = path.join(dataDir, name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, path.join(dataDir, name));
}

// ===== 设备绑定 =====
function getDevice() { return readJson('device.json', null); }
function saveDevice(device) { writeJson('device.json', device); }
function clearDevice() { try { fs.unlinkSync(path.join(dataDir, 'device.json')); } catch (e) { /* ignore */ } }

// token 存取（加解密在 store 层封装）
function packToken(token) { return encrypt(token); }
function unpackToken(record) { return record ? decrypt(record) : ''; }

// ===== 账号（元信息 + 加密 Cookie）=====
function listAccounts() { return readJson('accounts.json', []); }
function saveAccounts(list) { writeJson('accounts.json', list); }

function upsertAccount(account) {
  const list = listAccounts();
  const idx = list.findIndex((a) => a.platform === account.platform);
  if (idx >= 0) list[idx] = { ...list[idx], ...account, updated_at: new Date().toISOString() };
  else list.push({ id: Date.now() + '_' + Math.floor(Math.random() * 1e4), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...account });
  saveAccounts(list);
  return idx >= 0 ? list[idx] : list[list.length - 1];
}

function removeAccountById(id) {
  const list = listAccounts();
  const next = list.filter((a) => a.id !== id);
  saveAccounts(next);
  return list.length !== next.length;
}

function removeAccountByPlatform(platformKey) {
  const list = listAccounts();
  const next = list.filter((a) => a.platform !== platformKey);
  saveAccounts(next);
  return list.length !== next.length;
}

function updateAccountStatus(id, status) {
  const list = listAccounts();
  const a = list.find((x) => x.id === id);
  if (a) { a.status = status; a.last_checked_at = new Date().toISOString(); saveAccounts(list); }
  return a || null;
}

// Cookie 存取
function packCookies(cookieJson) { return encrypt(JSON.stringify(cookieJson)); }
function unpackCookies(record) {
  const s = decrypt(record);
  if (!s) return [];
  try { return JSON.parse(s); } catch (e) { return []; }
}
function getCookiesOf(account) { return account && account.cookies ? unpackCookies(account.cookies) : []; }

// 对外列表：剥离加密 blob
function publicAccounts() {
  return listAccounts().map(({ cookies, ...rest }) => rest);
}

// ===== 设置 =====
const DEFAULT_SETTINGS = {
  baseUrl: 'https://linxgeo.com',
  autoLaunch: true,
};
function getSettings() { return { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) }; }
function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
}

module.exports = {
  initStore, dataDir,
  getDevice, saveDevice, clearDevice, packToken, unpackToken,
  listAccounts, upsertAccount, removeAccountById, removeAccountByPlatform, updateAccountStatus,
  packCookies, unpackCookies, getCookiesOf, publicAccounts,
  getSettings, saveSettings,
};
