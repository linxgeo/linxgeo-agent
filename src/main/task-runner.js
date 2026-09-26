/**
 * 任务执行引擎（任务包2）：
 *   1. 每 10s 轮询 GET /api/agent/tasks（pending + 本机 interrupted）
 *   2. 幂等防重复：本地执行记录（task_executions.json）；task_id 已有 success 记录 → 直接回传，不执行
 *   3. 节流（本地二次校验）：单账号每小时 ≤1 篇、每天 ≤2 篇，超限拒绝并回传原因
 *   4. 合规预检（TC-19）→ 发布引擎（真实 Chrome）→ 回传结果（成功判定=platform_article_id 有值）
 * 状态机配合云端：pending → running → success/failed；认领超时 3 分钟云端自动转 interrupted 重下发。
 */
const fs = require('fs');
const path = require('path');
const cloudApi = require('./cloud-api');
const { assertPublishable } = require('./compliance');
const publishEngine = require('./publish-engine');
const logger = require('./logger');

const POLL_INTERVAL_MS = 10000; // PRD：每 10s 轮询
const THROTTLE_HOURLY = 1; // 单账号每小时 ≤1
const THROTTLE_DAILY = 2; // 单账号每天 ≤2

let pollTimer = null;
let running = false; // 单任务串行执行中
let ctx = null; // { getDevice, getSettings, dataDir, onEvent }
let execRecords = []; // 本地执行记录（幂等 + 节流数据源）
let recordsFile = '';

function loadRecords() {
  try { execRecords = JSON.parse(fs.readFileSync(recordsFile, 'utf8')); } catch (e) { execRecords = []; }
}
function saveRecords() {
  try { fs.mkdirSync(path.dirname(recordsFile), { recursive: true }); fs.writeFileSync(recordsFile, JSON.stringify(execRecords.slice(-500), null, 2)); } catch (e) { logger.warn(`[runner] 执行记录保存失败：${e.message}`); }
}
function recordOf(taskId) { return execRecords.find((r) => r.task_id === taskId); }
function appendRecord(rec) { execRecords.push(rec); saveRecords(); }

/** 节流：单账号（=平台 partition）近 1 小时 / 当天 已发布篇数 */
function throttleCheck(platform) {
  const now = Date.now();
  const recent = execRecords.filter((r) => r.platform === platform && r.result === 'success');
  const lastHour = recent.filter((r) => now - new Date(r.finished_at).getTime() < 3600000).length;
  if (lastHour >= THROTTLE_HOURLY) {
    return { pass: false, reason: `节流拦截：该账号近 1 小时已发布 ${lastHour} 篇（上限 ${THROTTLE_HOURLY} 篇/小时），请稍后再试` };
  }
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = recent.filter((r) => String(r.finished_at).slice(0, 10) === todayKey).length;
  if (today >= THROTTLE_DAILY) {
    return { pass: false, reason: `节流拦截：该账号今天已发布 ${today} 篇（上限 ${THROTTLE_DAILY} 篇/天）` };
  }
  return { pass: true };
}

function emit(event) {
  // 渲染层事件 + 本地日志
  logger.info(`[runner] ${event.status === 'success' ? '✓' : event.status === 'failed' ? '✗' : '…'} 任务#${event.id} ${event.platform} ${event.status}${event.fail_reason ? '：' + event.fail_reason.slice(0, 80) : ''}`);
  try { if (ctx && ctx.onEvent) ctx.onEvent(event); } catch (e) { /* ignore */ }
}

function deviceReady() {
  const device = ctx.getDevice();
  if (!device || !device.agent_id) return null;
  const token = ctx.unpackDeviceToken(device);
  if (!token) return null;
  return { baseUrl: ctx.getSettings().baseUrl, agentId: device.agent_id, agentToken: token };
}

/** 轮询一次：拉任务 → 逐个处理 */
async function pollOnce() {
  if (running) return; // 串行：上一任务未完成不拉新
  const auth = deviceReady();
  if (!auth) return;
  let tasks = [];
  try {
    const data = await cloudApi.fetchTasks(auth.baseUrl, auth.agentId, auth.agentToken);
    tasks = (data && data.tasks) || [];
  } catch (e) {
    logger.warn(`[runner] 拉取任务失败：${e.message}`); // 断网/服务重启：任务不丢，下轮再拉
    return;
  }
  for (const task of tasks) {
    await handleTask(auth, task);
  }
}

/** 单任务：幂等 → 节流 → 合规 → 执行 → 回传 */
async function handleTask(auth, task) {
  // ① 幂等：本地已有 success 记录 → 不执行，直接回传（TC-03 防重复发布）
  const existed = recordOf(task.id);
  if (existed && existed.result === 'success') {
    logger.info(`[runner] 任务#${task.id} 本地已有成功记录，跳过执行直接回传（幂等）`);
    try {
      await cloudApi.reportTaskResult(auth.baseUrl, auth.agentId, auth.agentToken, task.id, {
        status: 'success', platformArticleId: existed.article_id, publishUrl: existed.publish_url,
      });
    } catch (e) { logger.warn(`[runner] 幂等回传失败：${e.message}`); }
    return;
  }
  if (existed && existed.result === 'failed' && !task.is_retry) {
    logger.info(`[runner] 任务#${task.id} 本地已有失败记录且非重试任务，跳过`);
    return;
  }

  running = true;
  const startedAt = new Date().toISOString();
  appendRecord({ task_id: task.id, platform: task.platform, title: task.title, result: 'started', started_at: startedAt });
  emit({ id: task.id, platform: task.platform, title: task.title, status: 'running' });
  try {
    // ② 节流（本地二次校验）
    const throttle = throttleCheck(task.platform);
    if (!throttle.pass) throw new Error(throttle.reason);

    // ③ 合规预检（TC-19）
    assertPublishable(task);

    // ④ 真实发布
    const result = await publishEngine.runPublishTask(task);

    // ⑤ 立即落本地成功记录（先记后传，防窗口期重复）
    appendRecord({ task_id: task.id, platform: task.platform, title: task.title, result: 'success', article_id: result.platform_article_id, publish_url: result.publish_url, started_at: startedAt, finished_at: new Date().toISOString() });
    await cloudApi.reportTaskResult(auth.baseUrl, auth.agentId, auth.agentToken, task.id, {
      status: 'success', platformArticleId: result.platform_article_id, publishUrl: result.publish_url,
    }).catch((e) => logger.warn(`[runner] 成功结果回传失败（云端待恢复重试）：${e.message}`));
    emit({ id: task.id, platform: task.platform, title: task.title, status: 'success', article_id: result.platform_article_id, publish_url: result.publish_url });
  } catch (e) {
    const reason = e.message || '未知错误';
    appendRecord({ task_id: task.id, platform: task.platform, title: task.title, result: 'failed', fail_reason: reason, started_at: startedAt, finished_at: new Date().toISOString() });
    await cloudApi.reportTaskResult(auth.baseUrl, auth.agentId, auth.agentToken, task.id, {
      status: 'failed', failReason: reason,
    }).catch((e2) => logger.warn(`[runner] 失败结果回传失败：${e2.message}`));
    emit({ id: task.id, platform: task.platform, title: task.title, status: 'failed', fail_reason: reason });
  } finally {
    running = false;
  }
}

function startTaskRunner(options) {
  ctx = options;
  recordsFile = path.join(options.dataDir, 'task_executions.json');
  loadRecords();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { pollOnce().catch((e) => logger.warn(`[runner] 轮询异常：${e.message}`)); }, POLL_INTERVAL_MS);
  logger.info(`[runner] 任务执行引擎启动：轮询 ${POLL_INTERVAL_MS / 1000}s（本地记录 ${execRecords.length} 条）`);
  // 启动即拉一次（断网恢复/开机自动补发，TC-04）
  setTimeout(() => pollOnce().catch(() => {}), 3000);
}

function stopTaskRunner() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** 供 UI 查询：最近执行记录（同任务去重，终态优先；无终态保留 started 表示进行中） */
function listRecentRecords(limit = 50) {
  const byTask = new Map();
  for (const r of execRecords) {
    const prev = byTask.get(r.task_id);
    if (!prev || (prev.result === 'started' && r.result !== 'started')) byTask.set(r.task_id, r);
  }
  return [...byTask.values()].sort((a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at))).slice(0, limit);
}

/** 供 UI 查询：是否正在执行 */
function isBusy() { return running; }

module.exports = { startTaskRunner, stopTaskRunner, listRecentRecords, isBusy };
