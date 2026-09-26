/**
 * 本地滚动日志（F-701）：按天分文件，保留最近 14 天；支持导出。
 */
const fs = require('fs');
const path = require('path');

let logDir = '';

function initLogger(userDataPath) {
  logDir = path.join(userDataPath, 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) { /* ignore */ }
}

function todayFile() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return path.join(logDir, `agent-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.log`);
}

function log(level, msg) {
  try {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    fs.appendFileSync(todayFile(), line);
    if (level === 'ERROR' || level === 'WARN') console.log(`[agent] ${line.trim()}`);
  } catch (e) { /* 日志失败不影响主流程 */ }
}

function info(msg) { log('INFO', msg); }
function warn(msg) { log('WARN', msg); }
function error(msg) { log('ERROR', msg); }

// 滚动清理：删除 14 天前的日志
function rotate() {
  try {
    const files = fs.readdirSync(logDir).filter((f) => /^agent-\d{8}\.log$/.test(f)).sort();
    while (files.length > 14) {
      fs.unlinkSync(path.join(logDir, files.shift()));
    }
  } catch (e) { /* ignore */ }
}

// 导出：合并全部日志为一个文本
function exportAll() {
  try {
    const files = fs.readdirSync(logDir).filter((f) => /^agent-\d{8}\.log$/.test(f)).sort();
    return files.map((f) => {
      return `===== ${f} =====\n` + fs.readFileSync(path.join(logDir, f), 'utf8');
    }).join('\n');
  } catch (e) {
    return '(暂无日志)';
  }
}

module.exports = { initLogger, info, warn, error, rotate, exportAll };
