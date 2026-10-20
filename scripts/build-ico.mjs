// 把多个 PNG 打包成一个多分辨率 ICO（PNG payload 形式，Vista+ 支持）
import fs from 'node:fs';
import path from 'node:path';

const assets = path.resolve('assets');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map((s) => ({
  size: s,
  data: fs.readFileSync(path.join(assets, s === 256 ? 'icon.png' : `icon-${s}.png`)),
}));

const N = entries.length;
const HEADER_LEN = 6 + N * 16;

// 计算每个 PNG 的偏移
let offset = HEADER_LEN;
const offsets = entries.map((e) => {
  const o = offset;
  offset += e.data.length;
  return o;
});

// ICONDIR
const buf = Buffer.alloc(offset);
buf.writeUInt16LE(0, 0);     // reserved
buf.writeUInt16LE(1, 2);     // type (1 = ICO)
buf.writeUInt16LE(N, 4);     // count

// ICONDIRENTRY[N]
for (let i = 0; i < N; i++) {
  const e = entries[i];
  const base = 6 + i * 16;
  buf.writeUInt8(e.size >= 256 ? 0 : e.size, base + 0);    // width (0 = 256)
  buf.writeUInt8(e.size >= 256 ? 0 : e.size, base + 1);    // height
  buf.writeUInt8(0, base + 2);                              // colors
  buf.writeUInt8(0, base + 3);                              // reserved
  buf.writeUInt16LE(1, base + 4);                           // planes
  buf.writeUInt16LE(32, base + 6);                          // bit count
  buf.writeUInt32LE(e.data.length, base + 8);               // bytes
  buf.writeUInt32LE(offsets[i], base + 12);                 // offset
}

// PNG payloads
for (let i = 0; i < N; i++) {
  entries[i].data.copy(buf, offsets[i]);
}

const out = path.join(assets, 'icon.ico');
fs.writeFileSync(out, buf);
console.log(`wrote ${out} (${buf.length} bytes, ${N} sizes)`);
