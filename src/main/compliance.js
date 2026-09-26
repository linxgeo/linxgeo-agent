/**
 * 本地合规预检引擎（任务包2 / TC-19 / F-701~703）：
 *   发布前在本地拦截违规内容：极限词（广告法）/ 联系方式 / 营销话术。
 *   拦截 = 不执行发布，直接回传 failed + fail_reason（内容不离开本地即被拦下）。
 *   规则与云端 forbiddenService v2 对齐（精简版，任务包3 接云端规则下发）。
 */
const logger = require('./logger');

// 极限词（广告法绝对化用语）
const ABSOLUTE_WORDS = [
  '最好', '最佳', '最优', '最先进', '最新', '最高级', '国家级', '世界级', '宇宙级', '全国第一',
  '第一名', 'NO.1', 'TOP1', '顶级', '极品', '第一品牌', '王牌', '尖端', '绝对', '百分之百',
  '史无前例', '绝无仅有', '万能', '祖传', '特效', '无敌', '纯天然', '100%',
];

// 联系方式（微信/电话/QQ/网址引流）
const CONTACT_PATTERNS = [
  { re: /(?:微信|vx|wx|weixin|威信|微\s*信)[号:：\s]*[a-zA-Z0-9_-]{4,20}/i, name: '微信号' },
  { re: /(?:qq|扣扣|企鹅)[号:：\s]*[0-9]{5,12}/i, name: 'QQ号' },
  { re: /(?:电话|手机|热线|咨询|联系)[电话:：\s]*[0-9-]{7,15}/, name: '电话号码' },
  { re: /\b1[3-9]\d{9}\b/, name: '手机号码' },
  { re: /加\s*(我|微|V|v)[信:：]/, name: '加微引流' },
];

// 营销话术（诱导/促销）
const MARKETING_WORDS = [
  '限时优惠', '立即抢购', '仅剩最后', '错过不再', '马上报名', '免费领取', '零风险', '稳赚',
  '躺赚', '日入过万', '月入十万', '招代理', '诚招代理', '加盟赚钱', '点击链接', '私信我',
  '评论区留言', '关注领取', '转发抽奖', '清仓甩卖', '亏本处理',
];

/**
 * 预检：返回 { pass: bool, hits: [{type, word}] }
 */
function precheckContent({ title = '', content = '' } = {}) {
  const text = `${title}\n${content}`;
  const hits = [];
  for (const w of ABSOLUTE_WORDS) {
    if (text.includes(w)) hits.push({ type: 'absolute', word: w });
  }
  for (const p of CONTACT_PATTERNS) {
    if (p.re.test(text)) hits.push({ type: 'contact', word: p.name });
  }
  for (const w of MARKETING_WORDS) {
    if (text.includes(w)) hits.push({ type: 'marketing', word: w });
  }
  return { pass: hits.length === 0, hits };
}

/** 拦截时生成可读原因 */
function failReasonOf(hits) {
  const label = { absolute: '广告法极限词', contact: '联系方式', marketing: '营销话术' };
  const grouped = {};
  for (const h of hits) {
    grouped[h.type] = grouped[h.type] || [];
    grouped[h.type].push(h.word);
  }
  return '本地合规预检拦截：' + Object.entries(grouped)
    .map(([t, ws]) => `${label[t] || t}（${[...new Set(ws)].slice(0, 5).join('、')}）`).join('；');
}

/**
 * 发布前预检入口：pass=true 放行；false 抛出（由 task-runner 捕获回传 failed）。
 */
function assertPublishable(task) {
  const { pass, hits } = precheckContent({ title: task.title, content: task.content });
  if (!pass) {
    logger.warn(`[compliance] 任务#${task.id} 预检拦截：` + failReasonOf(hits));
    const err = new Error(failReasonOf(hits));
    err.complianceBlocked = true;
    throw err;
  }
  logger.info(`[compliance] 任务#${task.id} 预检通过`);
  return true;
}

module.exports = { precheckContent, failReasonOf, assertPublishable };
