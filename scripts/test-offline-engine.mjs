// scripts/test-offline-engine.mjs
// 单测：跑离线引擎对典型 C / Python 片段，输出每一行的 kind 与解释前缀。
// 退出码：0=全部用例通过，1=有失败。
// 离线引擎是 TypeScript，单测跑编译后的 dist/main/offline/engine.js。
// 没 build 过就给明确引导，而不是抛一堆看不懂的解析错误。
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const distAbs = resolve(process.cwd(), 'dist/main/offline/engine.js');
if (!existsSync(distAbs)) {
  console.error('找不到编译产物 ' + distAbs);
  console.error('请先在项目根目录执行: npm run build');
  process.exit(2);
}

const engine = await import(pathToFileURL(distAbs).href);

// 剥掉解释前缀的 emoji 标记（📖 / 🔧 / 💬 / ❓ …），只为日志好读
const TAG_RE = /^[^\p{L}\p{N}]+/u;

let pass = 0, fail = 0;
function assertContains(label, actual, fragments) {
  const ok = fragments.every(f => actual.includes(f));
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else {
    fail++;
    console.error(`  ✗ ${label}`);
    console.error(`    期望含 ${JSON.stringify(fragments)}`);
    console.error(`    实际: ${actual.slice(0, 200)}`);
  }
}

console.log('=== C：printf 库函数命中 + 注释 + 控制流 ===');
const c1 = engine.explainOffline(`
#include <stdio.h>
// 程序入口
int main(void) {
    int n = 10;
    char *p = malloc(n);
    printf("hello %d\\n", n);
    free(p);
    return 0;
}
`, 'c');
c1.lines.forEach((ln, i) => {
  console.log(`  L${ln.n} [${ln.kind}] ${ln.explain.slice(0, 80)}`);
});
const c1join = c1.lines.map(l => l.explain).join('\n');
assertContains('C #include 解释命中', c1join, ['stdio.h', 'printf', '标准输入输出']);
assertContains('C 单行注释识别', c1join, ['单行注释', '程序入口']);
assertContains('C int 变量声明解释', c1join, ['int', '整型']);
assertContains('C char* 指针声明解释', c1join, ['指针', 'malloc']);
assertContains('C printf 库函数命中', c1join, ['printf', '📖']);
assertContains('C free 库函数命中', c1join, ['free', '释放']);
assertContains('C return 解释', c1join, ['return', '返回']);
assertContains('C main 解释', c1join, ['main', '入口']);

console.log('\n=== C：for 循环 + if/else + 函数定义 ===');
const c2 = engine.explainOffline(`
int sum(int a, int b) {
    int s = 0;
    for (int i = a; i < b; i++) {
        if (i % 2 == 0) {
            s += i;
        } else {
            s -= 1;
        }
    }
    return s;
}
`, 'c');
const c2join = c2.lines.map(l => l.explain).join('\n');
assertContains('C 函数定义 sum 命中', c2join, ['定义函数', 'sum', '返回类型', 'int']);
assertContains('C for 循环识别', c2join, ['for', '计数循环']);
assertContains('C if 识别', c2join, ['条件成立']);
assertContains('C 复合赋值 s += 命中', c2join, ['写回', 's']);
assertContains('C 复合赋值 s -= 命中', c2join, ['减上', '写回']);

console.log('\n=== Python：内置函数 + 列表 + 推导式 + 注释 ===');
const p1 = engine.explainOffline(`
# 词频统计
def word_count(words):
    """统计每个词出现次数"""
    d = {}
    for w in words:
        d[w] = d.get(w, 0) + 1
    top = sorted(d.items(), key=lambda x: x[1], reverse=True)
    return [k for k, _ in top]
`, 'python');
p1.lines.forEach((ln) => {
  console.log(`  L${ln.n} [${ln.kind}] ${ln.explain.slice(0, 80)}`);
});
const p1join = p1.lines.map(l => l.explain).join('\n');
assertContains('Py 单行注释识别', p1join, ['单行注释', '词频统计']);
assertContains('Py docstring 识别', p1join, ['docstring']);
assertContains('Py def 函数定义', p1join, ['def', 'word_count']);
assertContains('Py 空字典字面量赋值', p1join, ['字典', 'd']);
assertContains('Py for 循环', p1join, ['for', '依次取出']);
assertContains('Py .get 方法命中', p1join, ['get', '📖', '不存在', '默认']);
assertContains('Py sorted 函数命中', p1join, ['sorted', '📖']);
assertContains('Py lambda 赋值', p1join, ['lambda']);
assertContains('Py 列表推导式', p1join, ['列表推导式', '生成新列表']);
assertContains('Py return 解释', p1join, ['return']);

console.log('\n=== Python：print + 切片 + f-string + 三元 + 类型转换 ===');
const p2 = engine.explainOffline(`
def show(name, age):
    msg = f"Hello {name}, you are {age}"
    nums = list(range(10))
    last = nums[-1] if nums else 0
    print("name:", name, "| age:", age)
    return msg.upper()
`, 'python');
const p2join = p2.lines.map(l => l.explain).join('\n');
assertContains('Py f-string 识别', p2join, ['f-string', '嵌入']);
assertContains('Py list() 内置函数', p2join, ['list(', '转成列表']);
assertContains('Py range 内置函数', p2join, ['range']);
assertContains('Py 三元表达式', p2join, ['三元表达式']);
assertContains('Py 切片 nums[-1] 识别', p2join, ['切片']);
assertContains('Py print 调用', p2join, ['print', '向屏幕输出']);
assertContains('Py .upper 方法', p2join, ['upper', '大写']);

console.log('\n=== Python：类 + 装饰器 + 异常 ===');
const p3 = engine.explainOffline(`
@staticmethod
class Helper:
    def __init__(self, name):
        self.name = name

    def greet(self):
        try:
            return f"Hi {self.name}"
        except Exception as e:
            return str(e)
`, 'python');
const p3join = p3.lines.map(l => l.explain).join('\n');
assertContains('Py @staticmethod 装饰器', p3join, ['@staticmethod', '静态方法']);
assertContains('Py class 定义', p3join, ['class', 'Helper']);
assertContains('Py __init__ 命中', p3join, ['__init__']);
assertContains('Py try 识别', p3join, ['try', '可能出错的代码']);
assertContains('Py except 识别', p3join, ['except']);

console.log('\n=== C 速览 summary ===');
const cs = engine.quickExplainOffline(`#include <stdio.h>
int main(){ printf("hi\\n"); return 0; }`, 'c');
console.log('  summary:\n' + cs.split('\n').map(l => '    ' + l).join('\n'));
assertContains('C summary 含 main', cs, ['离线速览', 'main()']);
assertContains('C summary 含 printf 调用', cs, ['printf']);

console.log('\n=== Python 速览 summary ===');
const ps = engine.quickExplainOffline(`def f(x):\n    return [i*i for i in range(x)]`, 'python');
console.log('  summary:\n' + ps.split('\n').map(l => '    ' + l).join('\n'));
assertContains('Py summary 含 f()', ps, ['f()']);
assertContains('Py summary 含 range', ps, ['range']);

// ─────────────────────────────────────────────────────────────
// 真实用户反馈样本（2026-10-19 截图）
// 场景：用户在编辑器里只选中 1~2 行，detectLanguage 判不出语言 → 全部走兜底。
// 期望：引擎自己推断出 C/Python，并给出有意义的逐行解释。
// ─────────────────────────────────────────────────────────────
console.log('\n=== 用户反馈样本 1：单行 C 多变量声明（判不出语言）===');
for (const lang of ['unknown', 'c']) {
  const r = engine.explainOffline('double a, b, c;', lang);
  const join = r.lines.map((l) => l.explain).join(' | ');
  console.log(`  [language=${lang}] 推断结果=${r.language} kind=${r.lines[0].kind}`);
  console.log(`    => ${r.lines[0].explain.replace(TAG_RE, '')}`);
  assertContains(`C 多变量声明(language=${lang}) 不再是未覆盖`, join, ['double', 'a']);
  if (r.lines[0].kind === 'unknown') {
    fail++; console.error('  ✗ 仍然是 unknown 兜底');
  } else { pass++; }
  if (r.language !== 'c') { fail++; console.error(`  ✗ 语言应推断为 c，实际 ${r.language}`); }
  else { pass++; }
}

console.log('\n=== 用户反馈样本 2：Python 赋值 + 方法调用（判不出语言）===');
for (const lang of ['unknown', 'python']) {
  const r = engine.explainOffline('res = str.split("xyz")', lang);
  const join = r.lines.map((l) => l.explain).join(' | ');
  console.log(`  [language=${lang}] 推断结果=${r.language} kind=${r.lines[0].kind}`);
  console.log(`    => ${r.lines[0].explain.replace(TAG_RE, '')}`);
  assertContains(`Py 赋值+split(language=${lang})`, join, ['res']);
  if (r.lines[0].kind === 'unknown') {
    fail++; console.error('  ✗ 仍然是 unknown 兜底');
  } else { pass++; }
}

console.log('\n=== 用户反馈样本 3：Python 列表 + append（两行，判不出语言）===');
{
  const code = "a = ['a', 'b', 'c', 'd', 'e']\na.append('f')";
  const r = engine.explainOffline(code, 'unknown');
  console.log(`  推断结果=${r.language}  覆盖=${r.matched}/${r.total}`);
  r.lines.forEach((l) => console.log(`    ${l.n}. [${l.kind}] ${l.explain.replace(TAG_RE, '')}`));
  assertContains('Py 列表字面量赋值', r.lines[0].explain, ['列表', 'a']);
  assertContains('Py append 方法说明', r.lines[1].explain, ['append']);
  if (r.language !== 'python') { fail++; console.error(`  ✗ 语言应推断为 python，实际 ${r.language}`); }
  else { pass++; }
  if (r.matched !== r.total) { fail++; console.error(`  ✗ 应全部覆盖，实际 ${r.matched}/${r.total}`); }
  else { pass++; }
}

// ─────────────────────────────────────────────────────────────
// 用户反馈样本（第二轮）：速览正文必须包含每一行的实际解释
// 旧 bug：quickExplainOffline 只拼 kind==='dict' 的行，纯语法行全丢，
// 用户只看到"离线可解释 2/2 行"却看不到任何解释内容。
// ─────────────────────────────────────────────────────────────
console.log('\n=== 用户反馈样本 4：C 简单声明（速览必须逐行给解释）===');
{
  const code = 'int i, j;\nint n = 5;';
  const q = engine.quickExplainOffline(code, 'c');
  console.log('  summary:\n' + q.split('\n').map((l) => '    ' + l).join('\n'));
  assertContains('速览含「逐行解释」小节', q, ['逐行解释']);
  assertContains('速览列出第 1 行代码原文', q, ['`int i, j;`']);
  assertContains('速览第 1 行有实际解释（同时声明）', q, ['同时声明', 'i、j']);
  assertContains('速览列出第 2 行代码原文', q, ['`int n = 5;`']);
  assertContains('速览第 2 行有实际解释（初值）', q, ['初值为', '5']);
  assertContains('速览不再出现"2/2 行"却没有正文', q, ['覆盖：2/2 行']);
}
{
  const q = engine.quickExplainOffline('double a, b, c;', 'c');
  console.log('  summary:\n' + q.split('\n').map((l) => '    ' + l).join('\n'));
  assertContains('double 声明速览含解释', q, ['`double a, b, c;`', 'double', 'a、b、c']);
}

console.log('\n=== 用户反馈样本 5：C 取余赋值（速览必须解释表达式）===');
{
  const code = 'y = n % 2;';
  const q = engine.quickExplainOffline(code, 'c');
  console.log('  summary:\n' + q.split('\n').map((l) => '    ' + l).join('\n'));
  assertContains('取余赋值速览含解释', q, ['`y = n % 2;`', '赋给变量 y', '余数']);
  const line = engine.explainOffline(code, 'c').lines[0];
  assertContains('取余赋值单行解释', line.explain, ['n % 2', '余数']);
}

console.log('\n=== 回归：== 不能当赋值 ===');
{
  const r = engine.explainOffline('i == 5;', 'c');
  const txt = r.lines[0].explain;
  console.log('    => ' + txt);
  if (txt.includes('把 = 5 赋给')) { fail++; console.error('  ✗ 仍把 == 当赋值'); }
  else { pass++; console.log('  ✓ 未误判为赋值'); }
  assertContains('== 语句被识别为比较', txt, ['比较', '==']);
}

console.log('\n=== 回归：p->v 里的 - 不能当减法 ===');
{
  const txt = engine.explainOffline('x = p->v;', 'c').lines[0].explain;
  console.log('    => ' + txt);
  if (txt.includes('减 ')) { fail++; console.error('  ✗ 把 -> 当减法'); }
  else { pass++; console.log('  ✓ 未误判为减法'); }
}

console.log('\n=== 表达式人话（C）===');
for (const [src, expect] of [
  ['x = a + b * 2;', ['a 加']],
  ['x = (a + b) * 2;', ['乘 2']],
  ['n = n / 2;', ['n 除以 2']],
  ['ok = a && b;', ['都为真']],
]) {
  const txt = engine.explainOffline(src, 'c').lines[0].explain;
  assertContains(`C 表达式 ${src}`, txt, expect);
}

console.log('\n=== Python 速览逐行正文 ===');
{
  const q = engine.quickExplainOffline("a = ['a', 'b']\na.append('c')", 'python');
  console.log('  summary:\n' + q.split('\n').map((l) => '    ' + l).join('\n'));
  assertContains('Py 速览逐行含 append', q, ['逐行解释', 'append', "`a.append('c')`"]);
}

console.log('\n=== 语言自推断单元 ===');
const guessCases = [
  ['double a, b, c;', 'c'],
  ['int x = 1;', 'c'],
  ['#include <stdio.h>\nint main(void) { return 0; }', 'c'],
  ["a = ['a','b']", 'python'],
  ["res = str.split('xyz')", 'python'],
  ['def f(x):\n    return x * 2', 'python'],
  ['a.append(1)', 'python'],
  ['print("hi")', 'python'],
];
for (const [src, expect] of guessCases) {
  const got = engine.guessCisPy(src);
  if (got === expect) { pass++; console.log(`  ✓ ${JSON.stringify(src.slice(0, 28))} → ${got}`); }
  else { fail++; console.error(`  ✗ ${JSON.stringify(src.slice(0, 28))} 期望 ${expect} 实际 ${got}`); }
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
