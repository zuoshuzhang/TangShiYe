/**
 * C 语言离线词典（零依赖、零网络）。
 *
 * 分两部分：
 *   C_FUNCS    标准库函数 —— 初学者最高频的疑问点，命中即给精确解释
 *   C_SYNTAX   关键字与语法结构 —— 模板化解释，信息量低于函数词条但保证逐行有输出
 *
 * 词条字段：
 *   sig   函数原型 / 结构形式
 *   brief 一句话作用
 *   note  可选：返回值、易错点、记忆口诀
 */

export interface DictEntry {
  sig: string;
  brief: string;
  note?: string;
}

/** C 标准库函数 */
export const C_FUNCS: Record<string, DictEntry> = {
  // ── stdio.h ──
  printf: {
    sig: 'int printf(const char *format, ...)',
    brief: '按格式串 format 把内容输出到标准输出（屏幕）',
    note: '返回实际打印的字符数。占位符：%d 整数 / %f 浮点 / %c 字符 / %s 字符串 / %p 地址 / %x 十六进制 / %% 百分号本身',
  },
  scanf: {
    sig: 'int scanf(const char *format, ...)',
    brief: '从标准输入（键盘）按格式读取数据，存入后面的变量',
    note: '变量前必须加 & 取地址（字符数组名除外）。返回成功读入的个数，常用 if(scanf("%d",&x)!=1) 判输入失败',
  },
  puts: {
    sig: 'int puts(const char *s)',
    brief: '输出字符串 s 并自动换行',
    note: '等价于 printf("%s\\n", s)，但更快、不能格式化',
  },
  putchar: { sig: 'int putchar(int c)', brief: '输出单个字符 c' },
  getchar: {
    sig: 'int getchar(void)',
    brief: '从键盘读入一个字符并返回其 ASCII 码',
    note: '返回 int 不是 char，因为失败/结束返回 EOF(-1)',
  },
  fgets: {
    sig: 'char *fgets(char *s, int size, FILE *stream)',
    brief: '从 stream 读一行（最多 size-1 个字符）存到 s',
    note: '比已废弃的 gets 安全：不会越界。换行符 \\n 会被一起读入；失败返回 NULL',
  },
  gets: {
    sig: 'char *gets(char *s)',
    brief: '【已废弃，禁止使用】从键盘读一行到 s',
    note: '不检查缓冲区长度，是经典缓冲区溢出漏洞来源。C11 起已被移除，请改用 fgets',
  },
  sprintf: {
    sig: 'int sprintf(char *str, const char *format, ...)',
    brief: '把格式化结果写进字符数组 str（不打印到屏幕）',
    note: '不检查 str 容量，可能溢出；安全替代是 snprintf',
  },
  snprintf: {
    sig: 'int snprintf(char *str, size_t size, const char *format, ...)',
    brief: '把格式化结果写进 str，最多写 size 字节，安全版 sprintf',
  },
  fopen: {
    sig: 'FILE *fopen(const char *path, const char *mode)',
    brief: '按模式 mode 打开文件 path，返回文件指针',
    note: '模式："r" 读 / "w" 写（清空）/ "a" 追加 / "rb" "wb" 二进制。失败返回 NULL，必须判断',
  },
  fclose: { sig: 'int fclose(FILE *fp)', brief: '关闭文件 fp 并释放资源', note: '忘记关闭会导致数据未刷盘、句柄泄漏' },
  fread: { sig: 'size_t fread(void *ptr, size_t size, size_t nmemb, FILE *fp)', brief: '从 fp 读 nmemb 个 size 字节的数据块到 ptr' },
  fwrite: { sig: 'size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *fp)', brief: '把 ptr 中 nmemb 个 size 字节的数据块写入 fp' },
  fprintf: { sig: 'int fprintf(FILE *fp, const char *format, ...)', brief: '按格式输出到指定文件 fp（printf 的文件版）' },
  fscanf: { sig: 'int fscanf(FILE *fp, const char *format, ...)', brief: '从文件 fp 按格式读取（scanf 的文件版）' },
  fseek: { sig: 'int fseek(FILE *fp, long offset, int whence)', brief: '移动文件读写位置', note: 'whence：SEEK_SET 开头 / SEEK_CUR 当前 / SEEK_END 末尾' },
  feof: { sig: 'int feof(FILE *fp)', brief: '判断是否读到文件末尾', note: '只有在一次读取失败之后才会为真，不能用作 while(!feof(fp)) 的循环条件' },
  perror: { sig: 'void perror(const char *s)', brief: '打印 s 加上最近一次系统错误的文字说明', note: '调试文件/内存操作失败时非常有用' },
  remove: { sig: 'int remove(const char *path)', brief: '删除文件 path，成功返回 0' },
  rename: { sig: 'int rename(const char *old, const char *new)', brief: '把文件改名/移动' },

  // ── stdlib.h ──
  malloc: {
    sig: 'void *malloc(size_t size)',
    brief: '在堆上申请 size 字节的连续内存，返回首地址',
    note: '分配的内存未初始化（内容随机）。失败返回 NULL 必须判断；用完必须 free，否则内存泄漏',
  },
  calloc: {
    sig: 'void *calloc(size_t nmemb, size_t size)',
    brief: '申请 nmemb 个 size 字节的内存并全部清零',
    note: '数组场景比 malloc 方便，天然初始化为 0',
  },
  realloc: {
    sig: 'void *realloc(void *ptr, size_t size)',
    brief: '调整已分配内存块 ptr 的大小为 size',
    note: '可能搬家（返回新地址），所以必须用返回值覆盖原指针：p = realloc(p, n); 直接写 realloc(p,n) 会丢指针',
  },
  free: {
    sig: 'void free(void *ptr)',
    brief: '释放 malloc/calloc/realloc 申请的内存',
    note: '只能释放堆内存，重复释放或释放后继续使用是未定义行为。好习惯：free(p); p = NULL;',
  },
  exit: { sig: 'void exit(int status)', brief: '立即结束整个程序', note: 'status 0 表示正常，非 0 表示异常（惯例）' },
  atoi: { sig: 'int atoi(const char *s)', brief: '把字符串转成整数', note: '无法判断是否失败（失败返回 0）；更稳的是 strtol' },
  atof: { sig: 'double atof(const char *s)', brief: '把字符串转成双精度浮点数' },
  strtol: { sig: 'long strtol(const char *s, char **endptr, int base)', brief: '按 base 进制把字符串转成长整型，可检测转换失败' },
  rand: { sig: 'int rand(void)', brief: '返回 0~RAND_MAX 之间的伪随机整数', note: '取 [0,n) 用 rand()%n；需要先 srand 播种子否则每次运行序列相同' },
  srand: { sig: 'void srand(unsigned int seed)', brief: '设置随机数种子', note: '常见写法 srand((unsigned)time(NULL))' },
  abs: { sig: 'int abs(int x)', brief: '返回 x 的绝对值' },
  qsort: {
    sig: 'void qsort(void *base, size_t nmemb, size_t size, int (*cmp)(const void *, const void *))',
    brief: '对数组 base 快速排序，需自己提供比较函数 cmp',
    note: 'cmp 返回 负/0/正 表示 小于/等于/大于。升序：return *(int*)a - *(int*)b;',
  },
  system: { sig: 'int system(const char *cmd)', brief: '执行一条 shell 命令', note: 'Windows 下如 system("pause") 可暂停窗口' },
  getenv: { sig: 'char *getenv(const char *name)', brief: '读取环境变量 name 的值' },

  // ── string.h ──
  strlen: {
    sig: 'size_t strlen(const char *s)',
    brief: '返回字符串 s 的字符数（不含结尾 \\0）',
    note: '只数到第一个 \\0 为止，不含 \\0 本身。分配内存时要 strlen(s)+1',
  },
  strcpy: {
    sig: 'char *strcpy(char *dest, const char *src)',
    brief: '把 src 字符串（含 \\0）复制到 dest',
    note: '不检查 dest 容量，溢出即崩溃/被攻击。改用 strncpy 或 snprintf',
  },
  strncpy: { sig: 'char *strncpy(char *dest, const char *src, size_t n)', brief: '最多复制 n 个字符，较 strcpy 安全', note: '若 src 长度 >= n，dest 不会以 \\0 结尾，需手动补' },
  strcat: { sig: 'char *strcat(char *dest, const char *src)', brief: '把 src 追加到 dest 末尾', note: '同样不检查容量' },
  strncat: { sig: 'char *strncat(char *dest, const char *src, size_t n)', brief: '最多追加 n 个字符到 dest 末尾' },
  strcmp: {
    sig: 'int strcmp(const char *a, const char *b)',
    brief: '按字典序比较两个字符串',
    note: '相等返回 0！所以判断相等要写 if(strcmp(a,b)==0)，不能写 if(strcmp(a,b))。负数表示 a<b，正数 a>b',
  },
  strncmp: { sig: 'int strncmp(const char *a, const char *b, size_t n)', brief: '只比较前 n 个字符' },
  strstr: { sig: 'char *strstr(const char *hay, const char *needle)', brief: '在 hay 中查找子串 needle，返回首次出现位置，找不到返回 NULL' },
  strchr: { sig: 'char *strchr(const char *s, int c)', brief: '在 s 中查找字符 c 首次出现的位置，找不到返回 NULL' },
  memset: {
    sig: 'void *memset(void *s, int c, size_t n)',
    brief: '把 s 开始的 n 个字节全部填充为值 c',
    note: '按字节填充，常用 memset(arr, 0, sizeof(arr)) 清零。对 int 数组填 1 得到的是 0x01010101 而不是 1',
  },
  memcpy: { sig: 'void *memcpy(void *dest, const void *src, size_t n)', brief: '从 src 复制 n 字节到 dest', note: '内存区域重叠时行为未定义，重叠请用 memmove' },
  memmove: { sig: 'void *memmove(void *dest, const void *src, size_t n)', brief: '同 memcpy 但允许源和目标内存重叠' },
  memcmp: { sig: 'int memcmp(const void *a, const void *b, size_t n)', brief: '比较前 n 个字节，相等返回 0' },
  strtok: { sig: 'char *strtok(char *s, const char *delim)', brief: '按 delim 中的分隔符切割字符串', note: '首次传 s，之后传 NULL 继续切；会破坏原字符串（把分隔符改成 \\0）' },

  // ── math.h ──（链接时需 -lm）
  sqrt: { sig: 'double sqrt(double x)', brief: '返回 x 的平方根' },
  pow: { sig: 'double pow(double x, double y)', brief: '返回 x 的 y 次方' },
  fabs: { sig: 'double fabs(double x)', brief: '返回浮点数的绝对值' },
  sin: { sig: 'double sin(double x)', brief: '正弦，x 为弧度' },
  cos: { sig: 'double cos(double x)', brief: '余弦，x 为弧度' },
  tan: { sig: 'double tan(double x)', brief: '正切，x 为弧度' },
  log: { sig: 'double log(double x)', brief: '自然对数 ln(x)' },
  log10: { sig: 'double log10(double x)', brief: '常用对数 lg(x)' },
  exp: { sig: 'double exp(double x)', brief: '返回 e 的 x 次方' },
  floor: { sig: 'double floor(double x)', brief: '向下取整（取不大于 x 的最大整数）' },
  ceil: { sig: 'double ceil(double x)', brief: '向上取整（取不小于 x 的最小整数）' },
  round: { sig: 'double round(double x)', brief: '四舍五入到最近整数' },

  // ── ctype.h ──
  isalpha: { sig: 'int isalpha(int c)', brief: '判断 c 是否为英文字母，是返回非 0' },
  isdigit: { sig: 'int isdigit(int c)', brief: '判断 c 是否为数字字符 0~9' },
  isalnum: { sig: 'int isalnum(int c)', brief: '判断 c 是否为字母或数字' },
  isupper: { sig: 'int isupper(int c)', brief: '判断 c 是否为大写字母' },
  islower: { sig: 'int islower(int c)', brief: '判断 c 是否为小写字母' },
  isspace: { sig: 'int isspace(int c)', brief: '判断 c 是否为空白字符（空格/换行/制表符等）' },
  toupper: { sig: 'int toupper(int c)', brief: '把小写字母转成大写，非字母原样返回' },
  tolower: { sig: 'int tolower(int c)', brief: '把大写字母转成小写，非字母原样返回' },

  // ── time.h ──
  time: { sig: 'time_t time(time_t *t)', brief: '返回当前时间距 1970-01-01 的秒数（时间戳）' },
  clock: { sig: 'clock_t clock(void)', brief: '返回程序启动到现在的 CPU 时钟数，除以 CLOCKS_PER_SEC 得秒' },
  difftime: { sig: 'double difftime(time_t t1, time_t t0)', brief: '返回两个时间戳相差的秒数' },
  strftime: { sig: 'size_t strftime(char *s, size_t max, const char *fmt, const struct tm *tm)', brief: '把时间结构按 fmt 格式化成字符串' },
};

/** C 关键字与语法结构 */
export const C_SYNTAX: Record<string, DictEntry> = {
  include: { sig: '#include <头文件.h>', brief: '预处理指令：把指定头文件的内容原样插入到这里', note: '尖括号 <> 找系统目录，双引号 "" 先找当前目录' },
  define: { sig: '#define 名字 替换文本', brief: '预处理指令：定义宏，编译前做纯文本替换', note: '宏不做类型检查，建议常量用 #define 或 const，函数式宏要整体加括号' },
  ifdef: { sig: '#ifdef / #ifndef / #endif', brief: '条件编译：满足/不满足宏定义时才编译中间的代码', note: '常与 #define 配合做头文件防重复包含：#ifndef XXX_H' },
  typedef: { sig: 'typedef 原类型 新名字;', brief: '给类型起别名', note: '如 typedef struct Node Node; 之后可直接写 Node n;' },
  struct: { sig: 'struct 名字 { 成员... };', brief: '定义结构体：把多个不同类型的变量打包成一个整体', note: '访问成员用 . （结构体变量）或 -> （结构体指针）' },
  enum: { sig: 'enum 名字 { 常量1, 常量2 };', brief: '定义枚举：一组有名字的整数常量', note: '默认从 0 开始递增，可显式赋值' },
  union: { sig: 'union 名字 { 成员... };', brief: '定义联合体：所有成员共用同一块内存', note: '大小为最大成员的大小，同一时刻只有一个成员有效' },
  static: { sig: 'static 类型 变量/函数', brief: '改变生命周期或作用域', note: '修饰局部变量：只初始化一次、函数返回后仍保留值；修饰全局：仅本文件可见' },
  const: { sig: 'const 类型 变量', brief: '声明为只读，初始化后不可修改', note: 'const int *p 表示不能改 *p；int *const p 表示不能改 p 本身' },
  extern: { sig: 'extern 类型 变量;', brief: '声明变量/函数定义在别的文件里，此处只是引用' },
  volatile: { sig: 'volatile 类型 变量', brief: '告诉编译器该变量可能被意外修改，禁止优化掉读取', note: '多用于硬件寄存器、多线程共享标志' },
  sizeof: { sig: 'sizeof(类型或变量)', brief: '返回该类型/变量占用的字节数', note: '常用 sizeof(arr)/sizeof(arr[0]) 算数组元素个数（仅对真数组有效，指针不行）' },
  unsigned: { sig: 'unsigned 整型', brief: '声明无符号整型，只能表示非负整数', note: '与有符号数混合运算会自动转换，容易出现意外的大数' },
  if: { sig: 'if (条件) { ... }', brief: '条件成立才执行花括号里的代码' },
  else: { sig: 'else { ... }', brief: '与 if 配对，条件不成立时执行' },
  'else if': { sig: 'else if (条件2) { ... }', brief: '上一个条件不成立时，再判断条件2' },
  switch: { sig: 'switch (表达式) { case 值: ...; break; }', brief: '按表达式的值跳转到匹配的 case 分支' },
  case: { sig: 'case 常量:', brief: 'switch 的一个分支入口', note: '执行完不会自动跳出，必须写 break，否则会贯穿执行下一个 case' },
  default: { sig: 'default:', brief: 'switch 中所有 case 都不匹配时执行的兜底分支' },
  for: { sig: 'for (初始化; 循环条件; 更新) { ... }', brief: '计数循环：先初始化，条件为真就执行循环体，然后更新，再判断', note: '三段都可省略，for(;;) 是死循环' },
  while: { sig: 'while (条件) { ... }', brief: '条件循环：先判断，条件为真才执行，可能一次都不执行' },
  do: { sig: 'do { ... } while (条件);', brief: '先执行一次循环体再判断，至少执行一次', note: '注意末尾有分号' },
  break: { sig: 'break;', brief: '立即跳出当前循环或 switch' },
  continue: { sig: 'continue;', brief: '跳过本次循环剩下的语句，直接进入下一轮判断' },
  return: { sig: 'return 表达式;', brief: '结束当前函数并把表达式的值返回给调用者', note: 'main 里 return 0 表示程序正常结束' },
  goto: { sig: 'goto 标签;', brief: '无条件跳到同一函数内的标签处', note: '破坏程序结构，除错误处理外不建议使用' },
  main: { sig: 'int main(void) / int main(int argc, char *argv[])', brief: '程序入口函数，操作系统从这里开始执行', note: 'argc 是命令行参数个数，argv[0] 是程序名' },
};

/** C 基本类型说明（用于变量声明行的类型标注） */
export const C_TYPES: Record<string, string> = {
  int: '整型，通常 4 字节，范围约 ±21 亿',
  char: '字符型，1 字节，本质是存 ASCII 码的小整数',
  float: '单精度浮点，4 字节，约 6~7 位有效数字',
  double: '双精度浮点，8 字节，约 15~16 位有效数字；C 里默认浮点类型',
  long: '长整型，通常 4 或 8 字节（平台相关）',
  short: '短整型，通常 2 字节',
  void: '空类型；做返回类型表示不返回值，void* 表示通用指针',
  'long long': '长长整型，至少 8 字节',
  size_t: '无符号整型，专用于表示大小和下标（sizeof 的返回类型）',
};
