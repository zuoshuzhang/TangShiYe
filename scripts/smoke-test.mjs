/**
 * 冒烟测试：启动打包后的 Electron 应用，10 秒后检查进程是否存活。
 * 关键：必须清掉 ELECTRON_RUN_AS_NODE，否则 electron 以纯 node 模式运行，
 *       require('electron') 会返回 exe 路径字符串而非内建 API，导致假崩溃。
 *
 * 用法: node scripts/smoke-test.mjs [exe绝对路径]
 */
import { spawn, execSync } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import * as path from 'path';

const exe = process.argv[2] ||
  path.resolve('release/win-unpacked/TangShiYe.exe');
const logPath = path.resolve('release/smoke.log');

const log = createWriteStream(logPath, { flags: 'w' });
const w = (s) => log.write(s + '\n');

if (!existsSync(exe)) {
  w('EXE NOT FOUND: ' + exe);
  log.end();
  process.exit(2);
}

// 关键：移除宿主注入的 ELECTRON_RUN_AS_NODE
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const name = path.basename(exe);
w('exe   = ' + exe);
w('start = ' + new Date().toISOString());
w('ELECTRON_RUN_AS_NODE removed = true');

const p = spawn(exe, ['--enable-logging'], {
  cwd: path.dirname(exe),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdoutBuf = '';
let stderrBuf = '';
p.stdout?.on('data', (d) => { stdoutBuf += d.toString(); });
p.stderr?.on('data', (d) => { stderrBuf += d.toString(); });
p.on('error', (e) => w('SPAWN ERROR: ' + e.message));
p.on('exit', (code, sig) => w(`EXIT code=${code} signal=${sig}`));

setTimeout(() => {
  let alive = false;
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${name}"`, { encoding: 'utf8' });
    alive = out.toLowerCase().includes(name.toLowerCase());
    w('--- tasklist after 10s ---');
    w(out.trim());
  } catch (e) {
    w('tasklist error: ' + e.message);
  }
  w('--- stdout ---');
  w(stdoutBuf.slice(0, 3000) || '(empty)');
  w('--- stderr ---');
  w(stderrBuf.slice(0, 3000) || '(empty)');
  w('ALIVE = ' + alive);
  try { process.kill(p.pid); } catch { /* ignore */ }
  try { execSync(`taskkill /F /IM "${name}" /T`, { stdio: 'ignore' }); } catch { /* ignore */ }
  w('cleaned up');
  log.end(() => {
    console.log('ALIVE =', alive);
    console.log('log   =', logPath);
    process.exit(0);
  });
}, 10000);
