/**
 * 平台配置（任务包1：5 核心平台）
 * 每平台独立配置：登录入口 / 创作页入口 / 登录成功与失效 URL 判定 / Cookie 域 / 昵称选择器。
 * （PRD F-805：每平台独立配置文件，互不影响；此处为登录授权层配置，
 *   发布层配置在任务包2 中以 platforms/<key>/selectors.js 形式接入。）
 */
const os = require('os');

// 与真实系统一致的 Chrome UA（Electron 默认 UA 含 "Electron/" 标记，易被平台识别）
function realChromeUA() {
  const v = '126.0.0.0';
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  }
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}

const PLATFORMS = {
  toutiao: {
    key: 'toutiao',
    name: '今日头条',
    loginUrl: 'https://mp.toutiao.com/',
    entryUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    successUrl: /mp\.toutiao\.com\/(profile_v4|dashboard|main|home)/i,
    invalidUrl: /(mp\.toutiao\.com\/(auth|login)|sso\.toutiao\.com)/i,
    cookieDomains: ['toutiao.com'],
    essentialCookies: ['sessionid'],
    nicknameSelectors: ['.user-info-name', '.account-name', '[class*="user-name"]', '[class*="nickname"]'],
  },
  xiaohongshu: {
    key: 'xiaohongshu',
    name: '小红书',
    loginUrl: 'https://creator.xiaohongshu.com/login',
    entryUrl: 'https://creator.xiaohongshu.com/publish/publish',
    successUrl: /creator\.xiaohongshu\.com\/(publish|home|dashboard)/i,
    invalidUrl: /creator\.xiaohongshu\.com\/login/i,
    cookieDomains: ['xiaohongshu.com'],
    essentialCookies: ['web_session'],
    nicknameSelectors: ['.user-name', '.creator-name', '[class*="nickname"]', '[class*="user-info"]'],
  },
  baijiahao: {
    key: 'baijiahao',
    name: '百家号',
    loginUrl: 'https://baijiahao.baidu.com/builder/rc/home',
    entryUrl: 'https://baijiahao.baidu.com/builder/rc/edit?tab=1',
    successUrl: /baijiahao\.baidu\.com\/builder/i,
    invalidUrl: /(passport\.baidu\.com|baijiahao\.baidu\.com\/builder\/login)/i,
    cookieDomains: ['baidu.com'],
    essentialCookies: ['BDUSS'],
    nicknameSelectors: ['.account-name', '.username', '[class*="nickname"]', '.user-name'],
  },
  sohu: {
    key: 'sohu',
    name: '搜狐号',
    loginUrl: 'https://mp.sohu.com/',
    entryUrl: 'https://mp.sohu.com/mpbp/main/index.html',
    successUrl: /mp\.sohu\.com\/(mpbp|main|dashboard)/i,
    invalidUrl: /(passport\.sohu\.com|mp\.sohu\.com\/.*\/login)/i,
    cookieDomains: ['sohu.com'],
    essentialCookies: [],
    nicknameSelectors: ['.user-name', '.account-name', '[class*="nickname"]'],
  },
  dayuhao: {
    key: 'dayuhao',
    name: '大鱼号',
    loginUrl: 'https://mp.dayu.com/',
    entryUrl: 'https://mp.dayu.com/dashboard/article/write',
    successUrl: /mp\.dayu\.com\/dashboard/i,
    invalidUrl: /(ids\.dayu\.com|\/login)/i,
    cookieDomains: ['dayu.com', 'uc.cn'],
    essentialCookies: [],
    nicknameSelectors: ['.account-name', '.user-name', '[class*="nickname"]'],
  },
};

function platformByKey(key) { return PLATFORMS[key] || null; }
function platformList() { return Object.values(PLATFORMS).map(({ key, name }) => ({ key, name })); }
function partitionOf(key) { return `persist:linxgeo-${key}`; }

module.exports = { PLATFORMS, platformByKey, platformList, partitionOf, realChromeUA };
