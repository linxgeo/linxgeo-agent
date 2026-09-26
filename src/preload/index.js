/**
 * preload：以 contextBridge 暴露最小 API 面（无 Node 暴露、无远程内容）
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  getDevice: () => ipcRenderer.invoke('device:get'),
  login: (payload) => ipcRenderer.invoke('device:login', payload),
  logout: () => ipcRenderer.invoke('device:logout'),

  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  listPlatforms: () => ipcRenderer.invoke('accounts:platforms'),
  addAccount: (platformKey) => ipcRenderer.invoke('accounts:add', platformKey),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  checkAccount: (id) => ipcRenderer.invoke('accounts:check', id),
  checkAllAccounts: () => ipcRenderer.invoke('accounts:checkAll'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  listRecords: () => ipcRenderer.invoke('tasks:records'),

  onHeartbeatState: (cb) => ipcRenderer.on('heartbeat-state', (_e, st) => cb(st)),
  onAccountAdded: (cb) => ipcRenderer.on('account-added', (_e, acc) => cb(acc)),
  onCheckProgress: (cb) => ipcRenderer.on('account-check-progress', (_e, p) => cb(p)),
  onTaskUpdate: (cb) => ipcRenderer.on('task-update', (_e, t) => cb(t)),
});
