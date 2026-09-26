/**
 * 生成应用图标（纯 Node，无依赖）：build/icon.png（512 供 electron-builder）、build/tray.png（32）
 * 图形：品牌蓝圆角方块 + 白色对勾风格（简化为双白条），透明背景。
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// PNG CRC32
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 品牌蓝圆角方块 + 白色"对勾"（用两段粗线条模拟）
const BRAND = [37, 99, 235];
function rounded(x, y, s, r) {
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  return Math.hypot(x - cx, y - cy) <= r;
}
function drawIcon(x, y, s) {
  if (!rounded(x, y, s, s * 0.22)) return [0, 0, 0, 0];
  // 对勾：短线（左下→中）+ 长线（中→右上）
  const t = s * 0.09; // 线宽
  const p1 = [s * 0.28, s * 0.52], p2 = [s * 0.45, s * 0.68], p3 = [s * 0.74, s * 0.34];
  const distSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let u = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
  };
  const d = Math.min(distSeg(x, y, p1[0], p1[1], p2[0], p2[1]), distSeg(x, y, p2[0], p2[1], p3[0], p3[1]));
  if (d <= t * 0.55) return [255, 255, 255, 255];
  return [...BRAND, 255];
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), makePng(512, drawIcon));
fs.writeFileSync(path.join(outDir, 'tray.png'), makePng(32, drawIcon));
console.log('icons generated:', path.join(outDir, 'icon.png'), path.join(outDir, 'tray.png'));
