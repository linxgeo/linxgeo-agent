// 容器内执行：插入认领时间 5 分钟前的僵尸 running 任务（验证 interrupted 状态机）
const { db } = require('/app/server/database.js');
const p = (n) => String(n).padStart(2, '0');
const fmt = (d) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
const old = fmt(new Date(Date.now() - 5 * 60 * 1000));
const now = fmt(new Date());
db.prepare('INSERT INTO agent_publish_tasks (agent_id, user_id, platform, title, content, status, agent_claimed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run('ag_b3104d87a1f38a045c43', 67, 'toutiao', '僵尸任务状态机测试（自动清理）', 'interrupted 状态机验证测试内容，含极限词最好的以便被合规拦截，无需真实发布。', 'running', old, old, now);
const rows = db.prepare('SELECT id, status, agent_claimed_at FROM agent_publish_tasks ORDER BY id DESC LIMIT 1').all();
console.log('INSERTED:', JSON.stringify(rows));
