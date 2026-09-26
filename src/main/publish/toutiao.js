/**
 * 今日头条适配器（任务包2）—— Electron 通道版
 *
 * 为什么不走 Playwright：实测头条对「Cookie 跨浏览器环境使用」有强风控，
 * 注入 Cookie + localStorage 到外部 Chrome 后 autosave 仍返回 7050「保存失败」；
 * 而用登录时的同一 Electron partition 窗口 autosave 立即成功（页面提示「草稿已保存」）。
 *
 * 已验证的机械链路（服务器侧 Playwright e2e #183/#186 经验移植）：
 *   ① 填文前关闭草稿恢复条  ② 标题原生 value setter + input/change 事件
 *   ③ 正文清空后 execCommand insertText  ④ 等 autosave 出现「已保存」才继续
 *   ⑤ 选封面「单图」radio（头条 requires_cover=0，不传图，严禁点「+」开素材弹窗）
 *   ⑥ 点「发表」→ 处理发布设置弹层  ⑦ 状态校验（内容管理页确认已发布/审核中）
 * 通用规则 F-801~F-806：语义化选择器、轮询等待、异常重试、失败留截图。
 */

const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish';
const ARTICLES_URL = 'https://mp.toutiao.com/profile_v4/graphic/articles';
const LOGIN_URL_RE = /mp\.toutiao\.com\/(auth|login)|sso\.toutiao\.com/;

/** 读取当前页面 body 文本（隐藏窗口下 innerText 可能为空，用 textContent 兜底） */
async function bodyText(ctx) {
  return (await ctx.evalJs(`(() => {
    const b = document.body;
    if (!b) return '';
    return b.innerText || b.textContent || '';
  })()`)) || '';
}

/** 抓取页面提示/报错文案（仅保留疑似错误/状态类，避免把页面常规文本写进日志） */
const NOTICE_RE = /失败|错误|异常|违规|限制|禁止|重试|不允许|未通过|保存中|已保存|请先|请检查|请重试/;
async function collectNotices(ctx) {
  const raw = await ctx.evalJs(`(() => {
    const sels = '[class*="message"],[class*="toast"],[class*="tip"],[class*="error"],[class*="warn"],[class*="alert"]';
    return JSON.stringify(Array.from(document.querySelectorAll(sels))
      .map(e => (((e.innerText || '') || (e.textContent || '')).trim()).replace(/\\s+/g, ' '))
      .filter(t => t && t.length >= 2 && t.length <= 90)
      .slice(0, 10));
  })()`);
  try {
    return JSON.parse(raw || '[]').filter((t) => NOTICE_RE.test(t)).slice(0, 6);
  } catch (e) { return []; }
}

async function publish(ctx, task, { logger: log } = {}) {
  const info = (m) => (log ? log.info(`[toutiao] ${m}`) : console.log(`[toutiao] ${m}`));
  const notices = new Set();
  let shotPath = '';
  try {
    return await doPublish(ctx, task, info, notices);
  } catch (e) {
    shotPath = await ctx.snapshot('toutiao-fail');
    const extra = [
      notices.size ? `页面提示：${[...notices].join(' | ')}` : '',
      shotPath ? `截图：${shotPath}` : '',
      `落点：${ctx.url().slice(0, 90)}`,
    ].filter(Boolean).join('；');
    throw new Error(extra ? `${e.message}（${extra}）` : e.message);
  }
}

async function doPublish(ctx, task, info, notices) {
  // ===== 1. 打开发布页 =====
  info(`打开发布页：${PUBLISH_URL}`);
  const landed = await ctx.goto(PUBLISH_URL, 4000);
  if (LOGIN_URL_RE.test(landed)) throw new Error('头条登录态已失效（跳转登录页），请重新授权');
  info(`落点：${String(landed).slice(0, 90)}`);

  // ===== 2. 关闭草稿恢复条（#186）=====
  const closed = await ctx.evalJs(`(() => {
    const cs = Array.from(document.querySelectorAll('div'));
    for (const c of cs) {
      if (c.children.length > 6 || c.children.length === 0) continue;
      if (/继续编辑|更多草稿/.test(c.textContent || '')) {
        const b = c.querySelector('[class*="close"]');
        if (b) { b.click(); return true; }
      }
    }
    return false;
  })()`);
  info(closed ? '已关闭草稿恢复条' : '未出现草稿恢复条');
  await ctx.sleep(2500);

  // ===== 3. 标题（原生 setter + input/change 事件）=====
  const titleRes = await ctx.evalJs(`(() => {
    const el = document.querySelector('textarea[placeholder*="标题"]') || document.querySelector('textarea');
    if (!el) return 'NO_TITLE_INPUT';
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(task.title)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'OK:' + (el.value || '').length;
  })()`);
  if (!titleRes || String(titleRes).startsWith('NO_TITLE')) throw new Error('未找到标题输入框（页面结构可能变化）');
  info(`标题已填（${task.title.length} 字，实测 ${String(titleRes).split(':')[1]} 字）`);

  // 校验标题真实落值（autosave 依赖 input 事件）
  await ctx.sleep(800);
  const titleVal = await ctx.evalJs(`(() => { const el = document.querySelector('textarea[placeholder*="标题"]') || document.querySelector('textarea'); return el ? (el.value || '') : ''; })()`);
  if (!titleVal || !String(titleVal).includes(task.title.slice(0, 4))) {
    throw new Error(`标题未真实落值（当前值：${JSON.stringify(String(titleVal).slice(0, 20))}）`);
  }

  // ===== 4. 正文（清空残留草稿 → execCommand insertText）=====
  const editorRes = await ctx.evalJs(`(() => {
    const ed = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    if (!ed) return 'NO_EDITOR';
    ed.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(task.content)});
    return 'OK:' + ((ed.innerText || '').length);
  })()`);
  if (!editorRes || String(editorRes).startsWith('NO_EDITOR')) throw new Error('未找到正文编辑器（页面结构可能变化）');
  info(`正文已填（${task.content.length} 字，编辑器实测 ${String(editorRes).split(':')[1]} 字）`);

  // ===== 5. 等 autosave 真正落库（关键：7050 会在此暴露）=====
  await waitAutosave(ctx, info);

  // ===== 6. 封面：仅选「单图」radio（严禁点「+」开素材弹窗）=====
  const coverRes = await ctx.evalJs(`(() => {
    const nodes = Array.from(document.querySelectorAll('label, .radio, [class*="cover"] *'));
    for (const n of nodes) {
      const t = ((n.textContent || n.innerText || '')).replace(/\\s+/g, '').trim();
      if ((t === '单图' || t === '单图模式') && t.length <= 4) { n.click(); return 'OK:' + t; }
    }
    return 'SKIP';
  })()`);
  info(coverRes === 'OK' ? '已选封面「单图」radio（不传图）' : '未找到「单图」radio，跳过封面交互');
  await ctx.sleep(800);

  // ===== 7. 点「发表」=====
  // 注意：隐藏窗口下 innerText 可能为空，文案匹配必须用 textContent（Playwright 的 has-text 也是 textContent）
  const clicked = await ctx.evalJs(`(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const btnText = (b) => (b.textContent || b.innerText || '').replace(/\\s+/g, ' ').trim();
    const list = all.map(b => ({ b, t: btnText(b), cls: b.className || '' }));
    // 优先：class 含 publish-btn-last（Playwright 实测头条结构：发表按钮为 publish-btn publish-btn-last）
    let hit = list.find(x => /publish-btn-last/.test(x.cls) && !x.b.disabled);
    // 次选：class 含 publish-btn 且文案不是「预览」
    if (!hit) hit = list.find(x => /publish-btn/.test(x.cls) && !/预览|preview/i.test(x.t) && !x.b.disabled);
    // 兜底：文案精确为「发表」
    if (!hit) hit = list.find(x => x.t === '发表' && !x.b.disabled);
    if (!hit) {
      return 'NO_BTN::' + JSON.stringify(list.map(x => (x.t || '(无文案)').slice(0, 12) + '[' + x.cls.split(' ')[0] + ']').slice(0, 20));
    }
    hit.b.scrollIntoView({ block: 'center' });
    hit.b.click();
    return 'OK:' + (hit.t || hit.cls.split(' ')[0]).slice(0, 14);
  })()`);
  if (!clicked || String(clicked).startsWith('NO_BTN')) {
    const dump = String(clicked || '').split('::')[1] || '';
    throw new Error(`未找到「发表」按钮（页面结构可能变化）；页面按钮清单：${dump.slice(0, 300)}`);
  }
  info(`已点「发表」（按钮：${String(clicked).split(':')[1]}）`);
  await ctx.sleep(4000);
  for (const n of await collectNotices(ctx)) notices.add(n);

  // ===== 8. 处理发布设置弹层 =====
  const confirmed = await handlePublishDialog(ctx, info);
  info(confirmed ? '已点发布弹层确认按钮' : '未出现发布弹层');

  // ===== 9. 等发布完成提示 =====
  const deadline = Date.now() + 60000;
  let done = false;
  while (Date.now() < deadline) {
    const t = await bodyText(ctx);
    if (/发布成功|已提交|提交成功|审核中/.test(t)) { done = true; break; }
    if (/发布失败|保存失败|违规|被限制/.test(t)) break;
    await ctx.sleep(2500);
    for (const n of await collectNotices(ctx)) notices.add(n);
  }
  info(done ? '页面提示发布成功/审核中' : '未捕获发布成功提示，转入状态校验');
  noticesShotLog(await ctx.snapshot('toutiao-after-publish'), info);

  // ===== 10. 状态校验（最终判据）：内容管理页确认 已发布/审核中 =====
  const check = await verifyPublished(ctx, task.title, info);
  if (!check.published) {
    throw new Error(`发布未成功：${check.reason}${publishIdHint(check, notices)}`);
  }
  if (!check.articleId) {
    throw new Error(`状态校验通过（${check.reason}）但未取到文章ID，按失败处理（成功判定必须带 platform_article_id）`);
  }
  return { platform_article_id: String(check.articleId), publish_url: ARTICLES_URL };
}

function noticesShotLog(shot, info) {
  if (shot) info(`过程截图：${shot}`);
}
function publishIdHint(check, notices) {
  return notices.size ? `；页面提示：${[...notices].join(' | ')}` : '';
}

/** 等 autosave 出现「已保存」（失败即抛出，避免后续步骤白等）—— 头条 7050 会在此暴露 */
async function waitAutosave(ctx, info, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = '';
  while (Date.now() < deadline) {
    const raw = await ctx.evalJs(`(() => {
      const b = document.body;
      const t = b ? (b.innerText || b.textContent || '') : '';
      return JSON.stringify({
        saving: /保存中|正在保存/.test(t),
        saved: /草稿已保存|已保存|保存成功/.test(t),
        failed: /保存失败|保存异常|存草稿失败/.test(t),
        hints: (t.match(/[^\\s]{0,4}保存[^\\s]{0,6}/g) || []).slice(0, 4),
      });
    })()`);
    try {
      const st = JSON.parse(raw || '{}');
      lastState = raw || '';
      if (st.failed) throw new Error(`头条自动保存失败（页面提示含「保存失败」，即接口 code 7050 场景），内容未落库`);
      if (st.saved && !st.saving) { info('autosave 已成功（页面提示「已保存」）'); return true; }
    } catch (e) {
      if (/保存失败/.test(e.message)) throw e;
    }
    await ctx.sleep(2000);
  }
  throw new Error(`等待头条自动保存超时（${timeoutMs / 1000}s 内未见「已保存」），内容可能未落库。页面状态：${lastState.slice(0, 160)}`);
}

/** 处理「发布设置」弹层：仅当存在弹层时点其中的确认按钮（避免误点页面其他按钮） */
async function handlePublishDialog(ctx, info) {
  const CONFIRM_TEXTS = ['确认发布', '确认发表', '确定发布', '确定发表', '继续发布', '确认', '确定'];
  for (let round = 0; round < 10; round++) {
    await ctx.sleep(1500);
    const res = await ctx.evalJs(`(() => {
      const texts = ${JSON.stringify(CONFIRM_TEXTS)};
      const dialogs = Array.from(document.querySelectorAll('.byte-modal, [role="dialog"], [class*="modal"], [class*="Modal"], [class*="dialog"]'));
      if (!dialogs.length) return 'NODIALOG';
      for (const d of dialogs) {
        const btns = Array.from(d.querySelectorAll('button'));
        for (const t of texts) {
          const b = btns.find(x => (x.innerText || '').trim().includes(t));
          if (b) { b.click(); return 'OK:' + t; }
        }
      }
      return 'NOCONFIRM';
    })()`);
    if (typeof res === 'string' && res.startsWith('OK:')) { info(`弹层确认已点（「${res.slice(3)}」）`); return true; }
    if (res === 'NODIALOG' && round >= 2) return false; // 4.5s 内无弹层 → 视为直接发布
  }
  return false;
}

/** 发布后状态校验：内容管理页确认文章状态，并尝试提取文章ID */
async function verifyPublished(ctx, title, info) {
  try {
    await ctx.goto(ARTICLES_URL, 6000);
    const txt = (await bodyText(ctx)).replace(/\s+/g, ' ');
    const key = String(title).replace(/\s+/g, '').slice(0, 10);
    const idx = txt.indexOf(key);
    if (idx < 0) {
      const count = (txt.match(/共\s*\d+\s*条内容/) || ['条数未知'])[0];
      return { published: false, reason: `已发布列表未找到标题（${count}），文章可能仍在草稿箱`, articleId: '' };
    }
    const around = txt.slice(Math.max(0, idx - 40), idx + 90);
    const articleId = await findArticleId(ctx, key);
    info(`状态校验：命中片段「${around.slice(0, 60)}」；文章ID=${articleId || '未取到'}`);
    if (/草稿|仅我可见|未通过/.test(around)) return { published: false, reason: `列表状态异常：${around.slice(0, 50)}`, articleId: '' };
    if (/已发布|审核中|已提交/.test(around)) return { published: true, reason: '列表状态=已发布/审核中', articleId };
    return { published: true, reason: '列表命中（状态词未识别）', articleId };
  } catch (e) {
    return { published: false, reason: '状态校验页面打开失败：' + e.message.split('\n')[0].slice(0, 60), articleId: '' };
  }
}

/** 从列表项 DOM/属性中提取文章ID（item_id / article_id / pgc_id，12-22 位数字） */
async function findArticleId(ctx, key) {
  const raw = await ctx.evalJs(`(() => {
    const key = ${JSON.stringify(key)};
    const nodes = Array.from(document.querySelectorAll('div,a,span'));
    const hit = nodes.find(n => (n.innerText || '').replace(/\\s+/g, '').includes(key));
    if (!hit) return '';
    let el = hit;
    for (let i = 0; i < 8 && el; i++) {
      const html = el.outerHTML || '';
      const m = html.match(/(?:item_id|article_id|pgc_id|group_id|itemId)[="':\\s]{1,4}(\\d{12,22})/);
      if (m) return m[1];
      const urlM = html.match(/[?&](?:item_id|article_id|pgc_id)=?(\\d{12,22})/);
      if (urlM) return urlM[1];
      el = el.parentElement;
    }
    return '';
  })()`);
  return raw ? String(raw) : '';
}

module.exports = { publish };
