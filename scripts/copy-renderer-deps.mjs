// 把渲染进程依赖（纯 JS UMD 包）拷贝到 src/renderer/popup/lib/，
// 让浮窗 HTML 通过 <script src="lib/xxx.js"> 加载，满足 CSP 的 script-src 'self'。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const targets = [
  {
    from: path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'),
    to:   path.join(root, 'src', 'renderer', 'popup', 'lib', 'marked.umd.js'),
  },
];

fs.mkdirSync(path.join(root, 'src', 'renderer', 'popup', 'lib'), { recursive: true });

for (const { from, to } of targets) {
  if (!fs.existsSync(from)) {
    console.error('源文件不存在:', from);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  const size = fs.statSync(to).size;
  console.log(`copied: ${path.relative(root, from)} -> ${path.relative(root, to)} (${size} B)`);
}
