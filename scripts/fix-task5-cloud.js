// 容器内执行：修正云端任务#5 假成功状态
const { db } = require('/app/server/database.js');
const p = (n) => String(n).padStart(2, '0');
const d = new Date();
const now = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
db.prepare('UPDATE agent_publish_tasks SET status = ?, platform_article_id = ?, fail_reason = ?, updated_at = ? WHERE id = ?')
  .run('failed', '', '（修正）假成功：文章仅存为草稿未真实发布（草稿ID被误判为文章ID，已修复判据）', now, 5);
const rows = db.prepare('SELECT id, status, platform_article_id FROM agent_publish_tasks WHERE id = 5').all();
console.log('FIXED:', JSON.stringify(rows));
