# 云擎发布助手（LINX-IGN 本地发布 Agent）

客户本地电脑安装的桌面发布 Agent（Electron）。平台账号登录态**只存本地**（safeStorage 加密），云端只登记账号元信息（昵称/平台/授权时间），绝不上传 Cookie/Token/密码。

## 开发

```bash
npm install          # 安装 Electron
npm run gen:icons    # 生成应用图标（build/icon.png、tray.png）
npm start            # 本地运行（macOS/Windows 均可）
```

## 打包

```bash
npm run dist:win     # Windows NSIS 安装包：dist/linxgeo-agent-setup-<version>.exe
npm run dist:mac     # macOS 免安装目录（本地验证用）
```

## 架构

```
src/
├── main/                 # 主进程（Node）
│   ├── index.js          # 入口：主窗口/托盘/单实例/开机自启
│   ├── ipc.js            # IPC：账号授权/设备绑定/设置/日志
│   ├── platforms.js      # 5 平台配置（登录入口/成功判定/Cookie 域）
│   ├── login-flow.js     # 本地内置浏览器登录窗口 + Cookie 采集
│   ├── account-validator.js  # 登录态有效性检测（失效→需重新授权）
│   ├── agent-store.js    # 本地存储（safeStorage 加密，原子写）
│   ├── cloud-api.js      # 云端 API 客户端（x-agent-id + x-agent-token）
│   ├── heartbeat.js      # 30s 心跳
│   └── logger.js         # 滚动日志（保留 14 天，可导出）
├── preload/index.js      # contextBridge 最小 API 面
└── renderer/             # 界面（发布账号/发布记录/设置 + 首次引导三步）
```

## 云端接口（server/routes/agentApi.js，挂载 /api/agent）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /bind | 设备绑定（用户 JWT）→ 签发 agentId + token |
| POST | /heartbeat | 心跳 30s（agent 鉴权） |
| POST | /accounts/register | 登记账号元信息（零凭证，凭证字段黑名单拦截） |
| POST | /accounts/status | 上报有效性检测结果 |
| POST | /accounts/unbind | 解绑（云端清状态） |
| GET | /accounts | 查询账号元信息（agent / 用户双鉴权） |
| GET | /agents | 用户名下设备列表 + 在线状态 |
| GET | /version | 版本检查（任务包3 接真实升级） |

## 安全红线

1. 登录态不出本地：Cookie 加密存本地 `userData/data/accounts.json`；
2. 云端 `agent_accounts` 表无任何凭证列，接口层凭证字段黑名单直接 400；
3. Agent 鉴权：`x-agent-id` + `x-agent-token`（sha256 存储、常数时间比较）。
