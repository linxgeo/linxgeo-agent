// 容器内执行：查 agent_publish_tasks 全部记录
const { db } = require('/app/server/database.js');
const rows = db.prepare('SELECT id, status, agent_claimed_at, fail_reason FROM agent_publish_tasks ORDER BY id').all();
console.log('TASKS:', JSON.stringify(rows, null, 1));
