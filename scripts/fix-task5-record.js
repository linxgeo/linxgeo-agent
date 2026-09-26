// 修正任务#5 假成功记录（本地 + 云端），避免污染节流计数
const fs = require('fs');
const ACC = process.env.HOME + '/Library/Application Support/linxgeo-agent/data/task_executions.json';

// 1) 本地记录：#5 success → failed（原因：文章实际只存为草稿，未真实发布）
const recs = JSON.parse(fs.readFileSync(ACC, 'utf8'));
let fixed = 0;
for (const r of recs) {
  if (r.task_id === 5 && r.result === 'success') {
    r.result = 'failed';
    r.fail_reason = '（修正）假成功：文章实际仅存为草稿，未真实发布（已修复发布判据）';
    r.article_id = '';
    fixed++;
  }
}
fs.writeFileSync(ACC, JSON.stringify(recs, null, 2));
console.log('本地记录修正条数:', fixed, '| 当前记录:', recs.map((r) => `#${r.task_id}=${r.result}`).join(', '));
