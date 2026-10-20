/**
 * 离线规则引擎：完全不联网、不依赖任何模型，纯正则 + 静态词典解释代码。
 *
 * 设计原则：
 *   1. 逐行全覆盖 —— 每一行都必须给出输出，识别不出来就诚实标注"离线未识别"
 *   2. 优先级从具体到宽泛：空行 → 注释 → 预处理/装饰器 → 定义(函数/类/结构)
 *      → 控制流 → 声明/赋值 → 库函数调用 → 方法调用 → 兜底
 *   3. 词典命中的解释精确可靠；语法结构部分信息量较低但保证结构可读
 *
 * 输出与 lineByLine 模式共用同一套 {n, code, explain} 结构，渲染层无需改动。
 */

import { Language } from '../languageDetector';
import { C_FUNCS, C_SYNTAX, C_TYPES, DictEntry } from './dict-c';
import { PY_FUNCS, PY_METHODS, PY_SYNTAX } from './dict-python';

export type LineKind = 'dict' | 'syntax' | 'comment' | 'blank' | 'unknown';

export interface OfflineLine {
  n: number;
  code: string;
  explain: string;
  kind: LineKind;
}

export interface OfflineResult {
  lines: OfflineLine[];
  summary: string;      // markdown 速览
  matched: number;      // 非 unknown 的行数
  total: number;
  language: string;
}

/** 行首标记，让用户在浮窗里一眼区分"精确解释"和"结构模板" */
const TAG: Record<LineKind, string> = {
  dict: '📖 ',
  syntax: '🔧 ',
  comment: '💬 ',
  blank: '· ',
  unknown: '❓ ',
};

/**
 * f-string 识别。
 *
 * 不能简单写 /f["']/ —— `a.append('f')` 里的 `f'` 会被当成 f-string 开头。
 * 要求：f 前面不是字母/数字/下划线/引号（可带 r/b 前缀），且引号成对闭合。
 *   ✓ print(f"hi")   x = f"{a}"   rf"..."   fr'...'
 *   ✗ a.append('f')  →  f 前是引号，排除
 */
const FSTRING_RE = /(?<![\w'"])[rRbB]{0,2}[fF](["'])(?:[^"'\\]|\\.)*\1/;

function joinParts(parts: string[]): string {
  return parts.filter((p) => p && p.trim()).join('；');
}

/** 把 DictEntry 渲染成一行解释 */
function renderEntry(e: DictEntry, withSig = true): string {
  const base = withSig ? `${e.sig} — ${e.brief}` : e.brief;
  return e.note ? `${base}。${e.note}` : base;
}

/**
 * 正则缓存：词典上百条，逐行逐条 new RegExp 会拖慢首帧。
 * 全部非全局模式，lastIndex 不持久化，可安全复用。
 */
const reCache = new Map<string, RegExp>();
function cachedRe(key: string, src: string, flags = 'i'): RegExp {
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(src, flags);
    reCache.set(key, re);
  }
  return re;
}
function callRe(name: string): RegExp {
  return cachedRe('call:' + name, '(?<![\\w.])' + name + '\\s*\\(');
}

/** 抽取一行里所有命中的 C 库函数调用（词边界，避免匹配到标识符子串） */
function findCFuncCalls(line: string): string[] {
  const out: string[] = [];
  for (const name of Object.keys(C_FUNCS)) {
    if (!/[a-z_]/.test(name[0])) continue;
    if (callRe(name).test(line)) out.push(name);
  }
  return out;
}

// ─────────────────────── 表达式 → 人话 ───────────────────────

/**
 * 在"顶层"（括号外、字符串外）查找 needle 的位置，找不到返回 -1。
 * 用来识别 `a + (b * c)` 里真正的最外层运算符是 `+` 而不是 `*`。
 */
function topLevelIndexOf(src: string, needle: string, from = 0): number {
  let depth = 0;
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (depth === 0 && src.startsWith(needle, i)) return i;
  }
  return -1;
}

interface BinOp {
  op: string;
  fn: (a: string, b: string) => string;
  py?: boolean;   // 仅 Python
  c?: boolean;    // 仅 C
}

/**
 * 按"优先级从低到高"排列。先命中的就是表达式的最外层运算，
 * 也就是求值顺序上最后发生的那一步，讲这一层对初学者最有用。
 */
const BIN_OPS: BinOp[] = [
  { op: '||', c: true, fn: (a, b) => `${a} 或 ${b}，只要一方为真结果就是真` },
  { op: '&&', c: true, fn: (a, b) => `${a} 与 ${b}，两方都为真结果才为真` },
  { op: '|', c: true, fn: (a, b) => `${a} 与 ${b} 按位或` },
  { op: '^', c: true, fn: (a, b) => `${a} 与 ${b} 按位异或` },
  { op: '&', c: true, fn: (a, b) => `${a} 与 ${b} 按位与` },
  { op: '==', fn: (a, b) => `比较 ${a} 与 ${b} 是否相等` },
  { op: '!=', fn: (a, b) => `比较 ${a} 与 ${b} 是否不相等` },
  { op: '<=', fn: (a, b) => `判断 ${a} 是否小于等于 ${b}` },
  { op: '>=', fn: (a, b) => `判断 ${a} 是否大于等于 ${b}` },
  { op: '<<', fn: (a, b) => `${a} 左移 ${b} 位` },
  { op: '>>', fn: (a, b) => `${a} 右移 ${b} 位` },
  { op: '<', fn: (a, b) => `判断 ${a} 是否小于 ${b}` },
  { op: '>', fn: (a, b) => `判断 ${a} 是否大于 ${b}` },
  { op: '+', fn: (a, b) => `${a} 加 ${b}` },
  { op: '-', fn: (a, b) => `${a} 减 ${b}` },
  { op: '//', py: true, fn: (a, b) => `${a} 整除 ${b}（向下取整，结果仍是整数）` },
  { op: '**', py: true, fn: (a, b) => `${a} 的 ${b} 次方` },
  { op: '*', fn: (a, b) => `${a} 乘 ${b}` },
  { op: '/', fn: (a, b) => `${a} 除以 ${b}` },
  { op: '%', fn: (a, b) => `取 ${a} 除以 ${b} 的余数` },
];

/**
 * 把右侧表达式翻成一句人话。只描述最外层运算，不做求值、不展开嵌套。
 * 认不出来就返回空串（调用方据此决定要不要加这句）。
 *
 *   n % 2                 → 取 n 除以 2 的余数
 *   a + b * 2             → a 加 b * 2
 *   (a + b) * 2           → (a + b) 乘 2
 *   msg.upper()           → （空，交给词典/调用分支解释）
 *   -x / *p / &x          → （空，一元运算符不解释）
 */
function describeExpr(expr: string, lang: 'c' | 'python'): string {
  const e = expr.trim().replace(/;\s*$/, '');
  if (!e) return '';

  // 一元运算： -y / !flag / ~bits / ++i / --i
  const un = e.match(/^(-|!|~|\+\+|--)\s*([\w.\[\]]+)$/);
  if (un) {
    const rest = un[2];
    if (un[1] === '-' && /^\d/.test(rest)) return '';   // 负数常量不用解释
    if (un[1] === '-') return `取 ${rest} 的相反数`;
    if (un[1] === '!') return `对 ${rest} 取逻辑非（真变假、假变真）`;
    if (un[1] === '~') return `对 ${rest} 按位取反`;
    if (un[1] === '++') return `先把 ${rest} 加 1，再参与本表达式的运算`;
    return `先把 ${rest} 减 1，再参与本表达式的运算`;
  }

  // 三元： c ? a : b
  const qi = topLevelIndexOf(e, '?');
  if (qi > 0) {
    const ci = topLevelIndexOf(e, ':', qi + 1);
    if (ci > qi) {
      return `三元表达式：${e.slice(0, qi).trim()} 成立就取 ${e.slice(qi + 1, ci).trim()}，否则取 ${e.slice(ci + 1).trim()}`;
    }
  }

  // Python 的 and / or（单词运算符，单独处理）
  if (lang === 'python') {
    const w = e.match(/^(.+?)\s+(and|or)\s+(.+)$/);
    if (w) {
      return w[2] === 'and' ? `${w[1].trim()} 与 ${w[3].trim()} 都为真才为真` : `${w[1].trim()} 或 ${w[3].trim()}，一方为真即为真`;
    }
  }

  for (const { op, fn, py, c } of BIN_OPS) {
    if (py && lang !== 'python') continue;
    if (c && lang !== 'c') continue;
    let idx = topLevelIndexOf(e, op);
    // 跳过一元用法： -x / *p / &x / ++i / !ok
    while (idx >= 0) {
      const prev = idx === 0 ? '' : e.slice(0, idx).trimEnd().slice(-1);
      const unary = idx === 0 || !prev || /[+\-*/%&|^<>=!~(]/.test(prev);
      // p->v 里的 - 不是减法
      const arrow = op === '-' && e[idx + 1] === '>';
      if (!unary && !arrow) break;
      idx = topLevelIndexOf(e, op, idx + op.length);
    }
    if (idx <= 0) continue;
    const a = e.slice(0, idx).trim();
    const b = e.slice(idx + op.length).trim();
    if (!a || !b) continue;
    return fn(a, b);
  }
  return '';
}

/** 抽取一行里所有命中的 Python 函数/方法调用 */
function findPyCalls(line: string): { name: string; entry: DictEntry; isMethod: boolean }[] {
  const out: { name: string; entry: DictEntry; isMethod: boolean }[] = [];
  const seen = new Set<string>();

  // 方法调用：.name(
  const methodRe = /\.([a-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(line)) !== null) {
    const name = m[1];
    const entry = PY_METHODS[name];
    if (entry && !seen.has('m:' + name)) {
      seen.add('m:' + name);
      out.push({ name, entry, isMethod: true });
    }
  }
  // 函数调用：name(
  for (const name of Object.keys(PY_FUNCS)) {
    if (callRe(name).test(line) && !seen.has('f:' + name)) {
      seen.add('f:' + name);
      out.push({ name, entry: PY_FUNCS[name], isMethod: false });
    }
  }
  return out;
}

// ─────────────────────── C 语言逐行解释 ───────────────────────

const C_TYPE_ALT =
  '(?:unsigned\\s+|signed\\s+)?(?:long\\s+long|long|short|int|char|float|double|void|size_t)';

/**
 * C 函数定义：类型 名字(参数…
 * 不加 $ 锚定，因为单行写法很常见：`int main(){ printf("hi"); }`
 * （结尾可能还有语句）。排除控制流关键字由调用方负责。
 */
const C_FN_DEF_RE = new RegExp('^(' + C_TYPE_ALT + '(?:\\s*\\*)*)\\s+(\\w+)\\s*\\(([^)]*)\\)');

function explainCLine(raw: string, n: number): OfflineLine {
  const line = raw.trim();
  const mk = (explain: string, kind: LineKind): OfflineLine => ({
    n, code: raw, explain: TAG[kind] + explain, kind,
  });

  if (!line) return mk('空行，仅作视觉分隔，程序执行时无任何作用', 'blank');
  if (line.startsWith('//')) {
    return mk(`单行注释，说明文字："${line.slice(2).trim()}"。编译器完全忽略`, 'comment');
  }
  if (line.startsWith('/*') || line.startsWith('*') || line.endsWith('*/')) {
    return mk(`块注释，说明文字："${line.replace(/^\/?\*+\/?|\*+\/$/g, '').trim()}"。编译器完全忽略`, 'comment');
  }

  // 预处理指令
  if (line.startsWith('#')) {
    const inc = line.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
    if (inc) {
      const header = inc[1];
      const what = header === 'stdio.h' ? '标准输入输出（printf/scanf 等）'
        : header === 'stdlib.h' ? '内存分配与工具函数（malloc/free/rand 等）'
        : header === 'string.h' ? '字符串处理（strlen/strcpy/strcmp 等）'
        : header === 'math.h' ? '数学函数（sqrt/pow 等，编译需加 -lm）'
        : header === 'ctype.h' ? '字符分类（isdigit/toupper 等）'
        : header === 'time.h' ? '时间与日期（time/clock 等）'
        : '对应的声明与宏';
      return mk(`${renderEntry(C_SYNTAX.include)}。此处引入 ${header}，提供${what}`, 'syntax');
    }
    if (/^#\s*define\s+/.test(line)) {
      const d = line.match(/^#\s*define\s+(\w+)(?:\s+(.*))?$/);
      const detail = d ? `本行定义宏 ${d[1]}${d[2] ? '，替换为 ' + d[2].trim() : '（空宏）'}` : '定义宏';
      return mk(`${renderEntry(C_SYNTAX.define)}。${detail}`, 'syntax');
    }
    if (/^#\s*(ifdef|ifndef|if|elif|else|endif|undef|pragma)/.test(line)) {
      return mk(renderEntry(C_SYNTAX.ifdef), 'syntax');
    }
    return mk(`预处理指令：${line}（在编译之前由预处理器处理）`, 'syntax');
  }

  // main 函数
  if (/\bmain\s*\(/.test(line)) {
    return mk(`${renderEntry(C_SYNTAX.main)}。本行是程序入口的定义${/\{/.test(line) ? '，后面花括号内是主逻辑' : ''}`, 'syntax');
  }

  // 结构体 / 枚举 / 联合体 变量声明： struct Node *p = malloc(...);  enum Color c;
  // 必须放在"结构体定义"之前，否则 struct Node *p; 会被当成"定义结构体 Node"。
  // \b 必须加：不加的话 `struct Node;` 会因回溯被拆成 tag="Nod"、变量名="e"
  const structVar = line.match(/^(struct|union|enum)\s+(\w+)\b\s*(\*+)?\s*(\w+)\s*(\[[^\]]*\])?\s*(?:=\s*(.+?))?\s*;\s*$/);
  if (structVar) {
    const kw = structVar[1];
    const tag = structVar[2];
    const stars = structVar[3] || '';
    const varName = structVar[4];
    const arr = structVar[5] || '';
    const init = structVar[6];
    const cn = kw === 'struct' ? '结构体' : kw === 'union' ? '联合体' : '枚举';
    const parts: string[] = [];
    if (stars) {
      parts.push(`声明指针变量 ${varName}，指向 ${kw} ${tag} 类型的${cn}（${stars.length} 级指针，存的是地址而不是结构体本身）`);
    } else if (arr) {
      parts.push(`声明${cn}数组 ${varName}，每个元素是 ${kw} ${tag}`);
    } else {
      parts.push(`声明变量 ${varName}，类型是 ${kw} ${tag}`);
    }
    parts.push(`${kw} ${tag} 是前面定义过的${cn}类型，这里拿它当类型名用`);
    if (init) {
      parts.push(`初值为 ${init.trim()}`);
      const d = describeExpr(init, 'c');
      if (d) parts.push(`即${d}`);
    }
    const calls = findCFuncCalls(line);
    for (const c of calls) parts.push(`调用了 ${c}：${C_FUNCS[c].brief}`);
    return mk(joinParts(parts), calls.length ? 'dict' : 'syntax');
  }

  // typedef 单独处理（必须早于 struct 定义分支，否则 typedef struct X X; 会被当定义）
  if (/^typedef\b/.test(line)) {
    const td = line.match(/^typedef\s+(.+?)\s+(\w+)\s*;\s*$/);
    const detail = td ? `本行给「${td[1].trim()}」起了新名字 ${td[2]}，之后可以直接写 ${td[2]}` : `本行：${line}`;
    return mk(`${renderEntry(C_SYNTAX.typedef)}。${detail}`, 'syntax');
  }

  // 结构体 / 枚举 / 联合体 定义
  // 只认真的"定义"：带左花括号，或 `struct X;` 前向声明
  const structDef = line.match(new RegExp('^\\s*(typedef\\s+)?(struct|enum|union)\\s+(\\w+)?'));
  if (structDef && (/\{/.test(line) || /^\s*(struct|enum|union)\s+\w+\s*;\s*$/.test(line))) {
    const kw = structDef[2] as 'struct' | 'enum' | 'union';
    const name = structDef[3] ? ` ${structDef[3]}` : '';
    const cn = kw === 'struct' ? '结构体' : kw === 'enum' ? '枚举' : '联合体';
    // 无花括号 = 前向声明，只说"有这个名字"，不定义成员
    if (!/\{/.test(line)) {
      return mk(`前向声明：告诉编译器"存在一个叫${name} 的${cn}"，完整成员定义在后面某处。常用于两个${cn}互相引用（A 里要用 B，B 里要用 A）时打破循环依赖`, 'syntax');
    }
    return mk(`${renderEntry(C_SYNTAX[kw])}。本行定义名为 ${structDef[3] || '(匿名)'} 的${cn}`, 'syntax');
  }

  // 控制流
  const controlMatch = (): OfflineLine | null => {
    const table: Array<[RegExp, keyof typeof C_SYNTAX, string]> = [
      // 必须用 \b：写成 /^\s*do\s*\{?/ 会让 `double a, b, c;` 里的 "do" 命中，
      // 把一条变量声明解释成 do-while 循环。
      [/^\s*do\b/, 'do', ''],
      [/^\s*while\s*\(/, 'while', ''],
      [/^\s*for\s*\(/, 'for', ''],
      [/^\s*switch\s*\(/, 'switch', ''],
      [/^\s*case\s+/, 'case', ''],
      [/^\s*default\s*:/, 'default', ''],
      [/^\s*\}\s*while/, 'do', '与前面的 do 配对，构成 do-while 的结尾判断'],
      [/^\s*else\s+if\s*\(/, 'else if', ''],
      [/^\s*else\b/, 'else', ''],
      [/^\s*if\s*\(/, 'if', ''],
      [/^\s*break\s*;/, 'break', ''],
      [/^\s*continue\s*;/, 'continue', ''],
      [/^\s*goto\s+/, 'goto', ''],
    ];
    for (const [re, key, extra] of table) {
      if (re.test(line)) {
        const e = C_SYNTAX[key as string];
        if (!e) continue;
        const cond = line.match(/\(([^)]*)\)/);
        let detail = extra || renderEntry(e);
        if (cond && !extra && /\(\s*[^)]+\s*\)/.test(line)) {
          detail += `。本行条件/参数：${cond[1].trim()}`;
        }
        return mk(detail, 'syntax');
      }
    }
    return null;
  };
  const ctl = controlMatch();
  if (ctl) return ctl;

  // return
  if (/\breturn\b/.test(line)) {
    const rv = line.match(/return\s+([^;]*)[;)]/);
    return mk(`${renderEntry(C_SYNTAX.return)}${rv && rv[1].trim() ? `。本行返回的是：${rv[1].trim()}` : '。本行不返回具体值'}`, 'syntax');
  }

  // 函数定义： 类型 名字(参数)  —— 需排除已被上面捕获的情况
  const fnDef = line.match(C_FN_DEF_RE);
  if (fnDef) {
    const retType = fnDef[1].trim();
    const fname = fnDef[2];
    const params = fnDef[3].trim();
    const typeNote = C_TYPES[retType.replace(/\s*\*+$/, '').trim()];
    return mk(
      `定义函数 ${fname}。返回类型 ${retType}${typeNote ? '（' + typeNote + '）' : ''}` +
      `${params ? `，参数：${params}` : '，无参数'}` +
      `${/\{/.test(line) ? '。紧随的花括号内是函数体' : ''}`,
      'syntax',
    );
  }

  // 函数声明（原型）： 类型 名字(参数);
  const fnDecl = line.match(new RegExp('^(' + C_TYPE_ALT + '(?:\\s*\\*)*)\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*;\\s*$'));
  if (fnDecl) {
    return mk(`函数声明（原型）：告诉编译器存在 ${fnDecl[2]} 这个函数，参数(${fnDecl[3]})、返回 ${fnDecl[1].trim()}，具体实现在别处`, 'syntax');
  }

  // 多变量声明： double a, b, c;   /  int x = 1, y = 2;
  // 必须放在单变量声明之前：否则 `int x = 1, y = 2;` 会被 decl 当成
  // "变量 x 的初值是 `1, y = 2`"，语义完全错。
  const multiDecl = line.match(new RegExp('^(' + C_TYPE_ALT + ')\\s+(.+?)\\s*;\\s*$'));
  if (multiDecl && multiDecl[2].includes(',')) {
    const type = multiDecl[1].trim();
    const items = multiDecl[2].split(',').map((s) => s.trim()).filter(Boolean);
    const names: string[] = [];
    let allDecl = items.length > 1;
    for (const it of items) {
      const m = it.match(/^(\*+)?\s*(\w+)\s*(\[[^\]]*\])?\s*(?:=\s*(.+))?$/);
      if (!m) { allDecl = false; break; }
      names.push((m[1] ? '*' : '') + m[2] + (m[3] || ''));
    }
    if (allDecl) {
      const typeNote = C_TYPES[type.replace(/\s+/g, ' ')];
      const parts = [`用一条语句同时声明 ${items.length} 个 ${type} 类型变量：${names.join('、')}`];
      if (typeNote) parts.push(typeNote);
      const inited = items.filter((i) => i.includes('='));
      if (inited.length) parts.push(`其中带初始值的是：${inited.join('；')}`);
      return mk(joinParts(parts), 'syntax');
    }
  }

  // 变量声明： 类型 [*]名字[数组] (= 初值);
  const decl = line.match(new RegExp('^(' + C_TYPE_ALT + ')\\s+(\\**)\\s*(\\w+)\\s*(\\[[^\\]]*\\])?\\s*(?:=([^;]*))?;\\s*$'));
  if (decl) {
    const type = decl[1].trim();
    const stars = decl[2] || '';
    const name = decl[3];
    const arr = decl[4] || '';
    const init = decl[5];
    const typeNote = C_TYPES[type.replace(/\s+/g, ' ')] || '';
    const parts: string[] = [];
    if (stars) {
      parts.push(`声明指针变量 ${name}，它存放的是地址而不是值本身（${stars.length} 级指针）。类型：${type}${typeNote ? '，' + typeNote : ''}`);
    } else if (arr) {
      parts.push(`声明数组 ${name}，长度 ${arr.slice(1, -1).trim() || '由初始化决定'}，元素类型 ${type}${typeNote ? '（' + typeNote + '）' : ''}`);
    } else {
      parts.push(`声明变量 ${name}，类型 ${type}${typeNote ? '（' + typeNote + '）' : ''}`);
    }
    if (init) {
      parts.push(`初值为 ${init.trim()}`);
      const d = describeExpr(init, 'c');
      if (d) parts.push(`即${d}`);
    }
    const calls = findCFuncCalls(line);
    for (const c of calls) parts.push(`调用了 ${c}：${C_FUNCS[c].brief}`);
    return mk(joinParts(parts), calls.length ? 'dict' : 'syntax');
  }

  // 自增减： i++ / ++i / i--
  const incdec = line.match(/^(\+{1,2}|-{1,2})\s*(\w+)\s*;?$|^\s*(\w+)\s*(\+{1,2}|-{1,2})\s*;?$/);
  if (incdec) {
    const name = incdec[2] || incdec[3];
    const op = (incdec[1] || incdec[4] || '').includes('+') ? '加' : '减';
    return mk(`把变量 ${name} 的值${op} 1（${incdec[3] ? '后缀' : '前缀'}写法）`, 'syntax');
  }

  // 复合赋值： s += i;  /  arr[k] = v;  /  p->next = q;  /  y = n % 2;
  // 左值允许 a.b / a->b / a[i] 链式访问；(?!=) 防止把 `i == 5;` 的 == 当赋值
  const aug = line.match(
    /^(\w+(?:\s*(?:->|\.)\s*\w+|\s*\[[^\]]*\])*)\s*((?:<<|>>|[+\-*/%&|^])=|=(?!=))\s*([^;]*);?\s*$/,
  );
  if (aug) {
    const target = aug[1].replace(/\s+/g, '');
    const opEq = aug[2];
    const op = opEq === '=' ? '' : opEq.slice(0, -1);
    const val = (aug[3] || '').trim();
    const opName: Record<string, string> = { '+': '加', '-': '减', '*': '乘', '/': '除', '%': '取余', '&': '按位与', '|': '按位或', '^': '按位异或', '<<': '左移', '>>': '右移' };
    const parts: string[] = [];
    const isMember = /(->|\.)/.test(target);
    const isSubscript = /\[/.test(target);
    if (isMember) {
      parts.push(
        `把 ${target} 设为 ${val}` +
        `（通过 ${target.includes('->') ? '-> 指针' : '. 点号'} 访问的成员变量，改的是结构体/对象里的那个字段）`,
      );
    } else if (isSubscript) {
      parts.push(`把下标为 ${target.slice(target.indexOf('[') + 1, -1)} 的 ${target.slice(0, target.indexOf('['))} 元素设为 ${val}（数组下标赋值）`);
    } else if (op && opName[op]) {
      parts.push(`把 ${target} ${opName[op]}上 ${val} 后再写回 ${target}，等价于 ${target} = ${target} ${op} (${val})`);
    } else {
      // 右侧是单个函数调用：说清"调用谁、返回值给谁"
      const callOnly = val.match(/^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/);
      if (callOnly) {
        parts.push(`调用函数 ${callOnly[1]}(${callOnly[2].trim()})，把它的返回值赋给变量 ${target}`);
      } else {
        const d = describeExpr(val, 'c');
        parts.push(`把 ${val} 的计算结果赋给变量 ${target}${d ? `（${d}）` : ''}`);
      }
    }
    if (/^NULL$/i.test(val)) parts.push('NULL 是空指针，表示"不指向任何有效内存"，解引用它会直接崩溃');
    const calls = findCFuncCalls(line);
    for (const c of calls) parts.push(`调用了 ${c}：${C_FUNCS[c].brief}`);
    return mk(joinParts(parts), calls.length ? 'dict' : 'syntax');
  }

  // 赋值 / 表达式语句：命中库函数则给词典解释
  const calls = findCFuncCalls(line);
  if (calls.length) {
    const parts = calls.map((c) => `${c}：${renderEntry(C_FUNCS[c], false)}`);
    const assign = line.match(/^(\w+)\s*=/);
    if (assign) parts.unshift(`把右侧结果赋给变量 ${assign[1]}`);
    return mk(joinParts(parts), 'dict');
  }

  // 单独的比较语句： i == 5;  结果没被使用，多半是笔误（想赋值写成了 ==）
  const cmpStmt = line.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*;\s*$/);
  if (cmpStmt) {
    return mk(
      `比较表达式语句：${describeExpr(cmpStmt[1] + ' ' + cmpStmt[2] + ' ' + cmpStmt[3], 'c')}` +
      `，结果为 1（真）或 0（假）。注意本行没有把结果存给任何变量，` +
      `如果本意是赋值应写单个 =，这里写的是 ${cmpStmt[2]}`,
      'syntax',
    );
  }

  // 其它表达式语句： n % 2;  /  a + b;
  const bareExpr = line.match(/^(.+?);\s*$/);
  if (bareExpr) {
    const d = describeExpr(bareExpr[1], 'c');
    if (d) return mk(`表达式语句：${d}。计算结果没有被保存，执行完即丢弃`, 'syntax');
  }

  // 花括号
  if (line === '{') return mk('代码块开始：左花括号，把若干语句打包成一个整体', 'syntax');
  if (line === '}') return mk('代码块结束：右花括号，表示一个块或函数的结束', 'syntax');
  if (/^\}/.test(line)) return mk('代码块结束：右花括号（本行还有后续语句）', 'syntax');

  // 兜底
  return mk(`离线规则未覆盖这一行（${line.slice(0, 40)}${line.length > 40 ? '…' : ''}）。如需语义级解读请关闭离线模式联网调用 AI`, 'unknown');
}

// ─────────────────────── Python 逐行解释 ───────────────────────

function explainPyLine(raw: string, n: number): OfflineLine {
  const line = raw.trim();
  const indent = raw.length - raw.replace(/^\s+/, '').length;
  const mk = (explain: string, kind: LineKind): OfflineLine => ({
    n, code: raw, explain: TAG[kind] + explain, kind,
  });
  const indentTip = indent >= 4 ? `（缩进 ${indent} 空格，属于上一行代码块的成员）` : '';

  if (!line) return mk('空行，Python 里纯作分隔，无语法作用', 'blank');
  if (line.startsWith('#')) {
    return mk(`单行注释，说明文字："${line.slice(1).trim()}"。解释器完全忽略`, 'comment');
  }
  if (/^('''|""")/.test(line) || /^\s*(""".*"""|'''.*''')\s*$/.test(line)) {
    return mk('文档字符串（docstring）：用来说明模块/类/函数的用途，可用 help() 查看', 'comment');
  }

  // 装饰器
  if (/^@\w+/.test(line)) {
    const deco = line.slice(1).trim();
    const known: Record<string, string> = {
      staticmethod: PY_SYNTAX.staticmethod.brief,
      classmethod: PY_SYNTAX.classmethod.brief,
      property: PY_SYNTAX.property.brief,
    };
    return mk(`装饰器 @${deco}：${known[deco] || '在不改动原函数代码的前提下给它附加额外功能'}`, 'syntax');
  }

  // 函数定义
  const fn = line.match(/^def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([\w\[\],\s]+)\s*)?:/);
  if (fn) {
    const name = fn[1];
    const params = fn[2].trim();
    const ret = fn[3];
    const pList = params ? params.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const selfTip = pList[0] === 'self' ? '，第一个参数 self 指实例本身（调用时不用传）' : '';
    return mk(
      `${renderEntry(PY_SYNTAX.def)}。本行定义函数 ${name}(${params})${selfTip}` +
      `${ret ? `，声明返回类型 ${ret.trim()}` : ''}` +
      `${indentTip}。冒号下面缩进的代码就是函数体`,
      'syntax',
    );
  }

  // 类定义
  const cls = line.match(/^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/);
  if (cls) {
    return mk(`${renderEntry(PY_SYNTAX['class'])}。本行定义类 ${cls[1]}${cls[2] ? '，继承自 ' + cls[2] : '（不显式继承任何类）'}${indentTip}`, 'syntax');
  }

  // import
  const imp = line.match(/^import\s+([\w.,\s]+)(?:\s+as\s+(\w+))?/);
  if (imp) return mk(`${renderEntry(PY_SYNTAX.import)}。本行导入 ${imp[1].trim()}${imp[2] ? '，并起别名 ' + imp[2] : ''}`, 'syntax');
  const fromImp = line.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
  if (fromImp) return mk(`${renderEntry(PY_SYNTAX.from)}。本行从 ${fromImp[1]} 导入 ${fromImp[2].trim()}${indentTip}`, 'syntax');

  // 控制流
  const pyCtl: Array<[RegExp, string, DictEntry]> = [
    [/^if\s+.*:/, 'if', PY_SYNTAX.if],
    [/^elif\s+.*:/, 'elif', PY_SYNTAX.elif],
    [/^else\s*:/, 'else', PY_SYNTAX.else],
    [/^for\s+.*:/, 'for', PY_SYNTAX.for],
    [/^while\s+.*:/, 'while', PY_SYNTAX.while],
    [/^try\s*:/, 'try', PY_SYNTAX.try],
    [/^except.*:/, 'except', PY_SYNTAX.except],
    [/^finally\s*:/, 'finally', PY_SYNTAX.finally],
    [/^with\s+.*:/, 'with', PY_SYNTAX.with],
    [/^break\s*$/, 'break', PY_SYNTAX.break],
    [/^continue\s*$/, 'continue', PY_SYNTAX.continue],
    [/^pass\s*$/, 'pass', PY_SYNTAX.pass],
    [/^raise\b/, 'raise', PY_SYNTAX.raise],
    [/^assert\b/, 'assert', PY_SYNTAX.assert],
    [/^del\b/, 'del', PY_SYNTAX.del],
    [/^global\b/, 'global', PY_SYNTAX.global],
    [/^nonlocal\b/, 'nonlocal', PY_SYNTAX.nonlocal],
    [/^async\s+def\b/, 'async', PY_SYNTAX.async],
  ];
  for (const [re, _k, entry] of pyCtl) {
    if (re.test(line)) {
      const cond = line.match(/^(\w+)\s+(.*):\s*$/);
      const detail = cond && cond[2] ? `。本行条件/内容：${cond[2].trim()}` : '';
      return mk(`${renderEntry(entry)}${detail}${indentTip}`, 'syntax');
    }
  }

  // return / yield
  if (/^return\b/.test(line)) {
    const rv = line.match(/^return\s+(.*)$/);
    const parts: string[] = [renderEntry(PY_SYNTAX.return)];
    let hasDict = false;
    if (rv) {
      const retVal = rv[1].trim();
      parts.push(`本行返回：${retVal}`);
      // 返回值里藏着的语法糖与调用
      const retCalls = findPyCalls(retVal);
      hasDict = retCalls.length > 0;
      for (const c of retCalls) {
        parts.push(`调用了${c.isMethod ? '方法' : '函数'} ${c.name}：${renderEntry(c.entry, false)}`);
      }
      if (/\bfor\b/.test(retVal) && /\bin\b/.test(retVal)) parts.push(`用到了列表推导式：${PY_SYNTAX.comprehension.brief}`);
      if (/\w+\s*\[[^\]]*\]/.test(retVal)) parts.push(`用到了切片：${PY_SYNTAX.slice_op.brief}`);
      if (/^f["']/.test(retVal)) parts.push(`用到了 f-string：${PY_SYNTAX.fstring.brief}`);
      if (/\bif\b/.test(retVal) && /\belse\b/.test(retVal)) parts.push(`用到了三元表达式：${PY_SYNTAX.ternary.brief}`);
    } else {
      parts.push('本行不返回具体值（等价于返回 None）');
    }
    return mk(joinParts(parts) + indentTip, hasDict ? 'dict' : 'syntax');
  }
  if (/^yield\b/.test(line)) return mk(renderEntry(PY_SYNTAX.yield) + indentTip, 'syntax');

  // 列表推导式
  if (/\[.*\bfor\b.*\bin\b.*\]/.test(line) && !/^\s*#/.test(line)) {
    return mk(`${renderEntry(PY_SYNTAX.comprehension)}。本行：${line}`, 'syntax');
  }

  // f-string
  // 必须排除 `a.append('f')` 这种：里面的 f' 不是 f-string，
  // 而是字符串字面量 'f' 的最后一个字符。所以 f 前面不能是引号/字母/数字。
  if (FSTRING_RE.test(line)) {
    return mk(`${renderEntry(PY_SYNTAX.fstring)}。本行：${line}`, 'syntax');
  }

  // 赋值： 名字 = 表达式 （含增强赋值、多目标、下标/属性赋值）
  // 先排除比较运算（== != <= >=），只有单个 = 才是赋值
  const isComparison = /[=!<>]=/.test(line);
  const assign = isComparison
    ? null
    : line.match(/^([\w_]+(?:\s*,\s*[\w_]+)*)\s*((?:\[[^\]]*\]|\.[\w_]+)*)\s*((?:[+\-*/%|&^]|<<|>>)=|=(?!=))\s*(.+)$/);
  if (assign) {
    const target = assign[1].trim();
    const accessor = (assign[2] || '').replace(/\s+/g, '');
    const opEq = assign[3] || '=';
    const value = (assign[4] || '').trim();
    const parts: string[] = [];
    const calls = findPyCalls(value);
    const opName: Record<string, string> = { '+': '加', '-': '减', '*': '乘', '/': '除', '%': '取余', '//': '整除', '**': '求幂', '&': '按位与', '|': '按位或', '^': '按位异或', '<<': '左移', '>>': '右移' };

    if (opEq !== '=') {
      const op = opEq.slice(0, -1);
      parts.push(`把 ${target} ${opName[op] || op} ${value} 后再写回 ${target}，等价于 ${target} = ${target} ${op} ${value}`);
    } else if (/^\[/.test(accessor)) {
      // 字典/列表按下标赋值： d[w] = ... / arr[i] = ...
      parts.push(`给 ${target}${accessor} 赋值 ${value}（按下标/键写入，键不存在会新建，下标越界则报 IndexError）`);
    } else if (/^\./.test(accessor)) {
      parts.push(`给对象 ${target} 的属性 ${accessor.slice(1)} 赋值 ${value}`);
    } else if (value === '[]') parts.push(`创建一个空列表并赋给 ${target}`);
    else if (value === '{}') parts.push(`创建一个空字典并赋给 ${target}`);
    else if (/^\[.*\]$/.test(value)) parts.push(`把列表 ${value} 赋给变量 ${target}`);
    else if (/^\{.*\}$/.test(value)) {
      parts.push(value.includes(':')
        ? `把字典 ${value} 赋给变量 ${target}`
        : `创建一个空字典/集合 ${value} 并赋给 ${target}`);
    }
    else if (/^f["']/.test(value)) parts.push(`把格式化后的字符串赋给 ${target}`);
    else if (/^["'].*["']$/.test(value)) parts.push(`把字符串 ${value} 赋给变量 ${target}`);
    else if (/^-?\d+(\.\d+)?$/.test(value)) parts.push(`把数值 ${value} 赋给变量 ${target}`);
    else if (/^lambda\b/.test(value)) parts.push(`${renderEntry(PY_SYNTAX.lambda)}，赋给 ${target}`);
    else if (/\bif\b/.test(value) && /\belse\b/.test(value)) parts.push(`${renderEntry(PY_SYNTAX.ternary)}，结果赋给 ${target}`);
    else {
      const d = describeExpr(value, 'python');
      parts.push(`把右侧的计算结果赋给变量 ${target}${d ? `（${d}）` : ''}`);
    }

    for (const c of calls) {
      parts.push(`调用了${c.isMethod ? '方法' : '函数'} ${c.name}：${renderEntry(c.entry, false)}`);
    }
    // 右侧出现的语法糖（可能藏在表达式中间，不是整行）
    if (/\blambda\b/.test(value) && !/^lambda\b/.test(value)) parts.push(`其中用了 lambda：${PY_SYNTAX.lambda.brief}`);
    if (/\w+\s*\[[^\]]*\]/.test(value)) parts.push(`其中用了切片/下标：${PY_SYNTAX.slice_op.brief}`);
    if (/\bin\b/.test(value) && /\bfor\b/.test(value)) parts.push(`其中用了推导式：${PY_SYNTAX.comprehension.brief}`);
    return mk(joinParts(parts) + indentTip, calls.length ? 'dict' : 'syntax');
  }

  // 独立表达式 / 调用语句
  const calls = findPyCalls(line);
  if (calls.length) {
    const parts = calls.map((c) => `${c.isMethod ? '方法' : '函数'} ${c.name}：${renderEntry(c.entry, false)}`);
    if (/^print\s*\(/.test(line)) parts.unshift('向屏幕输出内容');
    return mk(joinParts(parts) + indentTip, 'dict');
  }

  // 兜底
  return mk(`离线规则未覆盖这一行（${line.slice(0, 40)}${line.length > 40 ? '…' : ''}）。如需语义级解读请关闭离线模式联网调用 AI`, 'unknown');
}

// ─────────────────────── 通用语言兜底 ───────────────────────

function explainGenericLine(raw: string, n: number): OfflineLine {
  const line = raw.trim();
  const mk = (explain: string, kind: LineKind): OfflineLine => ({ n, code: raw, explain: TAG[kind] + explain, kind });
  if (!line) return mk('空行', 'blank');
  if (/^(\/\/|#|--|;)/.test(line)) return mk(`注释行："${line}"`, 'comment');
  if (/^[}\])]/.test(line)) return mk('代码块/结构结束', 'syntax');
  if (/^[{[(]/.test(line)) return mk('代码块/结构开始', 'syntax');
  if (/\b(if|else|for|while|switch|return|try|catch|break|continue)\b/.test(line)) {
    return mk(`包含控制流关键字：${(line.match(/\b(if|else|for|while|switch|return|try|catch|break|continue)\b/) || [])[1]}`, 'syntax');
  }
  return mk(`离线词典目前只覆盖 C 与 Python，这行无法离线解释：${line.slice(0, 40)}`, 'unknown');
}

// ─────────────────────── 速览 / 详解 summary ───────────────────────

/** 行内代码：代码里本身含反引号时退化为双反引号 */
function mdCode(s: string): string {
  const t = s.includes('`') ? '``' : '`';
  return t + s + t;
}

/**
 * 生成 markdown 正文。
 *
 * 关键：必须把**每一行的解释**都写出来。
 * 早期版本只把 kind==='dict'（词典精确命中）的行拼进正文，结果
 * `int i, j;` `double a, b, c;` `y = n % 2;` 这类纯语法行全部被丢弃，
 * 用户只看到"离线可解释 2/2 行"却看不到任何解释——等于没解释。
 *
 * @param maxLines 正文里逐行列出的最大行数（速览用 20，详解用全部）
 */
function buildSummary(
  code: string,
  lines: OfflineLine[],
  language: Language,
  opts: { maxLines?: number; skipBlank?: boolean } = {},
): string {
  const maxLines = opts.maxLines ?? 100000;
  const src = code.split('\n');
  const defs: string[] = [];
  const calls = new Set<string>();
  const controls = new Set<string>();

  if (language === 'c') {
    for (const l of src) {
      const f = l.match(C_FN_DEF_RE);
      if (f && !['if', 'while', 'for', 'switch'].includes(f[2])) defs.push(`${f[2]}()`);
      for (const c of findCFuncCalls(l)) calls.add(c);
      for (const k of ['if', 'for', 'while', 'switch', 'do']) {
        if (cachedRe('kw:' + k, '\\b' + k + '\\b').test(l)) controls.add(k);
      }
    }
  } else if (language === 'python') {
    for (const l of src) {
      const f = l.match(/^def\s+(\w+)/);
      if (f) defs.push(`${f[1]}()`);
      const c = l.match(/^class\s+(\w+)/);
      if (c) defs.push(`class ${c[1]}`);
      for (const call of findPyCalls(l)) calls.add(call.name);
      for (const k of ['if', 'for', 'while', 'try', 'with']) {
        if (cachedRe('pykw:' + k, '^\\s*' + k + '\\b').test(l)) controls.add(k);
      }
    }
  }

  const counts: Record<LineKind, number> = { dict: 0, syntax: 0, comment: 0, blank: 0, unknown: 0 };
  for (const l of lines) counts[l.kind]++;
  const covered = lines.length - counts.unknown;

  const langName = language === 'c' ? 'C' : language === 'python' ? 'Python' : language;
  const out: string[] = [];
  out.push('**离线速览**（规则引擎 · 未联网）');
  out.push('');
  out.push(`- 语言：${langName}　共 ${lines.length} 行`);
  if (defs.length) out.push(`- 定义了：${[...new Set(defs)].join('、')}`);
  if (calls.size) out.push(`- 调用了：${[...calls].join('、')}`);
  if (controls.size) out.push(`- 控制结构：${[...controls].map((c) => ({
    if: '条件分支', for: 'for 循环', while: 'while 循环', switch: 'switch 分支',
    do: 'do-while 循环', try: '异常捕获', with: '上下文管理',
  } as Record<string, string>)[c] || c).join('、')}`);
  out.push(
    `- 覆盖：${covered}/${lines.length} 行（` +
    `📖 词典精确 ${counts.dict} 行、🔧 语法结构 ${counts.syntax} 行、💬 注释 ${counts.comment} 行` +
    (counts.unknown ? `、❓ 未识别 ${counts.unknown} 行` : '') +
    '）',
  );

  // ── 逐行解释（正文主体，不能省）──
  out.push('');
  const shown = lines.slice(0, maxLines);
  const skippedBlank = opts.skipBlank ? shown.filter((l) => l.kind === 'blank').length : 0;
  out.push(
    '**逐行解释**' +
    (skippedBlank ? `（已省略 ${skippedBlank} 个空行，行号与编辑器一致）` : ''),
  );
  out.push('');
  for (const l of shown) {
    if (l.kind === 'blank') {
      if (opts.skipBlank) continue;   // 速览省空间，空行不占一行
      out.push(`${l.n}. *(空行)*`);
      continue;
    }
    const t = l.code.trim();
    const short = t.length > 70 ? t.slice(0, 70) + '…' : t;
    out.push(`${l.n}. ${mdCode(short)} — ${l.explain}`);
  }
  if (lines.length > shown.length) {
    out.push('');
    out.push(`> 还有 ${lines.length - shown.length} 行未展开，点下方「详解」查看全部`);
  }

  out.push('');
  out.push('> 说明：以上为静态规则分析，无法理解算法意图与业务逻辑。关闭「离线模式」可联网获得 AI 语义级解读。');
  return out.join('\n');
}

// ─────────────────────── 语言自推断 ───────────────────────

/**
 * 只在 C / Python 之间二选一的打分器。
 *
 * 用户常常只选中一行（`double a, b, c;` 或 `a.append('f')`），
 * 上游 detectLanguage 可能因为特征太少判成 unknown。这里用权重打分兜底，
 * 保证离线引擎总能落到一套规则上，而不是整段走"未覆盖"。
 */
export function guessCisPy(code: string): 'c' | 'python' | null {
  if (!code || !code.trim()) return null;
  const src = code.replace(/\r\n/g, '\n');
  const lines = src.split('\n').filter((l) => l.trim() && !/^\s*(\/\/|#(?!include|define|ifndef|endif)).*$/.test(l));

  let c = 0;
  let py = 0;

  // ── C 特征 ──
  if (/#\s*(include|define|ifndef|endif|pragma)\b/.test(src)) c += 5;
  if (/\b(int|void)\s+main\s*\(/.test(src)) c += 5;
  if (/\b(printf|scanf|fprintf|sprintf|snprintf|puts|malloc|calloc|realloc|free|strlen|strcpy|strncpy|strcmp|strcat|fopen|fclose|fgets|fputs|sizeof)\s*\(/.test(src)) c += 4;
  if (/%[-+ #0-9.]*[diouxXeEfgGaAcspn]/.test(src)) c += 3;      // 格式化占位符极强
  if (/->\s*\w+/.test(src)) c += 3;                              // 指针成员访问
  if (/\b(char|int|float|double|long|short|unsigned|signed|size_t|struct|typedef|const)\b/.test(src)) c += 2;
  c += Math.min(3, lines.filter((l) => /;\s*(\/\/.*)?$/.test(l)).length); // 分号结尾语句
  if (/\bfor\s*\(\s*(int|size_t)\b/.test(src)) c += 2;

  // ── Python 特征 ──
  if (/^\s*(def|class)\s+\w+/m.test(src)) py += 5;
  if (/^\s*(import|from)\s+\w+/m.test(src)) py += 4;
  if (/\b(print|len|range|enumerate|zip|isinstance|str|int|float|list|dict|set|sorted|sum|min|max|abs|open)\s*\(/.test(src)) py += 3;
  if (/\.(append|extend|insert|remove|pop|sort|split|rsplit|strip|lstrip|rstrip|join|get|items|keys|values|upper|lower|title|replace|format|startswith|endswith|find|count|copy|update)\s*\(/.test(src)) py += 4;
  if (/\b(elif|None|True|False|self|lambda|yield|with\s+open)\b/.test(src)) py += 4;
  if (/if\s+__name__\s*==/.test(src)) py += 5;
  if (FSTRING_RE.test(src)) py += 3;                             // f-string（排除 'f' 字面量误判）
  if (/^\s*#(?!include|define|ifndef|endif|pragma)/m.test(src)) py += 2;  // Python 注释
  if (/^\s*\w+\s*=\s*[\[\{'"]/m.test(src)) py += 2;              // 赋值给字面量
  // 完全没有任何分号 → 强烈不像 C
  if (!/;/.test(src)) py += 2;
  // 有换行且明显缩进结构
  if (lines.length > 1 && /^\s{2,}\S/m.test(src)) py += 2;

  if (c === 0 && py === 0) return null;
  if (c > py) return 'c';
  if (py > c) return 'python';
  return null;  // 平局：宁可承认不知道，也不乱猜
}

// ─────────────────────── 对外入口 ───────────────────────

/** 离线逐行解释（同步、零延迟） */
export function explainOffline(code: string, language: Language): OfflineResult {
  const src = (code || '').replace(/\r\n/g, '\n').split('\n');

  // 上游判不出语言时，自己再猜一次（单行代码最常见）
  let lang: Language = language;
  if (lang !== 'c' && lang !== 'python') {
    const guess = guessCisPy(code);
    if (guess) lang = guess;
  }

  const lines: OfflineLine[] = src.map((raw, i) => {
    const n = i + 1;
    if (lang === 'c') return explainCLine(raw, n);
    if (lang === 'python') return explainPyLine(raw, n);
    return explainGenericLine(raw, n);
  });
  const matched = lines.filter((l) => l.kind !== 'unknown').length;
  return {
    lines,
    summary: buildSummary(code, lines, lang),
    matched,
    total: lines.length,
    language: lang,
  };
}

/**
 * 离线速览（返回 markdown）。
 *
 * 与详解共用同一条 buildSummary 路径，只是限制正文行数 + 跳过空行：
 * 浮窗只有 400px 宽，塞太多行会撑到屏幕 85% 还读不完。
 * 超过 12 行就提示"点详解看全部"（详解走 lineByLine 三列，宽度 600px，更适合长代码）。
 */
export function quickExplainOffline(code: string, language: Language): string {
  const r = explainOffline(code, language);
  return buildSummary(code, r.lines, (r.language as Language) || language, {
    maxLines: 12,
    skipBlank: true,
  });
}
