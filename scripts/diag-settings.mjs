/** 诊断：app 起没起、CDP 端口开没开、targets 有什么 */
import { spawn, execSync } from 'child_process';
import * as path from 'path';

const ROOT = 'C:\\Users\\Administrator.DESKTOP-2AER2CO\\Projects\\tangshiye';
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'TangShiYe.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
env.TSY_DISABLE_GPU = '1';

// --disable-gpu：沙箱环境没有可用 GPU，否则 GPU 进程崩了会把整个 app 带崩
// （FATAL:gpu_data_manager_impl_private.cc GPU process isn't usable）
const child = spawn(EXE, ['--open-settings', '--remote-debugging-port=9333', '--remote-allow-origins=*', '--disable-gpu'], {
  cwd: path.dirname(EXE),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '', err = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { err += d.toString(); });
child.on('error', (e) => { err += 'SPAWN ERR ' + e.message + '\n'; });
child.on('exit', (c, s) => { err += `EXIT code=${c} sig=${s}\n`; });

await sleep(9000);

console.log('--- tasklist ---');
try { console.log(execSync('tasklist /FI "IMAGENAME eq TangShiYe.exe"', { encoding: 'utf8' })); }
catch (e) { console.log('tasklist err', e.message); }

console.log('--- netstat 9333 ---');
try { console.log(execSync('netstat -ano | findstr :9333', { encoding: 'utf8' }) || '(端口未监听)'); }
catch { console.log('(端口未监听)'); }

console.log('--- stdout ---');
console.log(out.slice(0, 2000) || '(empty)');
console.log('--- stderr ---');
console.log(err.slice(0, 3000) || '(empty)');

try {
  const r = await fetch('http://127.0.0.1:9333/json/list');
  const list = await r.json();
  console.log('--- targets ---');
  console.log(JSON.stringify(list.map((t) => ({ type: t.type, title: t.title, url: t.url })), null, 2));
} catch (e) {
  console.log('--- targets 取不到:', e.message);
}

try { process.kill(child.pid); } catch {}
try { execSync('taskkill /F /IM "TangShiYe.exe" /T', { stdio: 'ignore' }); } catch {}
process.exit(0);
