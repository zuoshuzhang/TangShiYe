# CodeWhisper — 独立桌面小工具：双击 Ctrl 解读代码

## 一、项目概述

**一句话描述：** 一个常驻系统托盘的轻量桌面小工具。在任何编辑器/网页中选中代码后双击 Ctrl，屏幕上弹出一个紧凑浮窗，显示中文代码解释，可展开详解并追问。

**与有道词典的类比：**

| 有道词典 | CodeWhisper |
|---------|-------------|
| 选中英文 → 双击 Ctrl → 弹出翻译小窗 | 选中代码 → 双击 Ctrl → 弹出代码解释小窗 |
| 托盘常驻，开机自启 | 托盘常驻，开机自启 |
| 小窗可固定/关闭 | 小窗可固定/关闭 |
| 点击"详细释义"跳转完整页 | 点击"展开详解"扩展窗口 + 追问对话 |

**核心优势（相比 VSCode 插件方案）：**
- ✅ 真正的系统级双击 Ctrl（全局键盘钩子）
- ✅ 在任何地方都能用：VSCode、PyCharm、Sublime、网页、PDF
- ✅ 真正的浮动小窗口，出现在鼠标/选中文本附近
- ✅ 独立进程，不影响编辑器性能

---

## 二、技术选型

### 选 Electron

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Electron | 全 JS/TS、生态成熟、跨平台、全局快捷键/托盘/剪贴板 API 完善 | 体积较大（~80MB） | ✅ **推荐** |
| Tauri v2 | 体积极小（~5MB）、性能好 | Rust 后端增加复杂度，Claude Code 实现成本高 | ⚠️ 未来优化 |
| Python + pywebview | 简单轻量 | 打包分发麻烦、UI 不够精致 | ❌ |

**最终决定：Electron**
- 全 JavaScript/TypeScript，Claude Code 可以一气呵成
- `globalShortcut` API 原生支持全局快捷键
- `BrowserWindow` 可创建无边框、置顶、任意位置的浮动小窗
- `Tray` API 支持系统托盘
- `clipboard` API 读取剪贴板
- `electron-builder` 一键打包为 exe / dmg / AppImage

---

## 三、核心交互流程

```
┌─────────────────────────────────────────────────────────────┐
│                    用户在任意编辑器中工作                       │
│                                                              │
│    1. 鼠标选中一段代码                                        │
│                         ↓                                    │
│    2. 双击 Ctrl（300ms 内按两次）                              │
│                         ↓                                    │
│    3. CodeWhisper 后台检测到双击 Ctrl                          │
│                         ↓                                    │
│    4. 自动执行 Ctrl+C 复制选中内容到剪贴板                     │
│       （如果剪贴板已有内容且与选中一致，跳过此步）              │
│                         ↓                                    │
│    5. 读取剪贴板文本                                          │
│                         ↓                                    │
│    6. 获取鼠标当前位置坐标                                    │
│                         ↓                                    │
│    7. 在鼠标位置附近弹出浮动小窗                               │
│       显示 loading → 调用 LLM → 显示一句话速览                │
│                         ↓                                    │
│    8. 用户可选：                                              │
│       - 点击空白处或按 Esc → 关闭小窗                         │
│       - 点击「展开详解」→ 窗口变大，显示详细教学               │
│       - 在对话框追问 → 基于当前代码继续提问                    │
│       - 点击「固定」→ 窗口不会自动消失                        │
└─────────────────────────────────────────────────────────────┘
```

### 关键细节：获取选中代码

独立应用无法直接读取其他程序的选中文本。解决方案：

```
方案 A（推荐，默认）：
  双击 Ctrl 后，程序自动模拟发送 Ctrl+C
  → 等待 50ms → 读取剪贴板 → 弹窗显示解释
  优点：用户无感，一步到位
  缺点：会覆盖剪贴板（需先保存旧内容，解释完恢复）

方案 B（备选，可在设置中切换）：
  用户自己先 Ctrl+C 复制，再双击 Ctrl 触发
  优点：不干扰剪贴板
  缺点：多一步操作
```

---

## 四、功能需求

### P0 — MVP

#### 4.1 系统托盘常驻

```
- 启动后缩小到系统托盘（Windows 右下角 / Mac 顶部菜单栏）
- 托盘图标：一个小的代码图标 </>
- 右键菜单：
  - ✅ 已启用 / ❌ 暂停 （切换监听状态）
  - ⚙️ 设置
  - 📖 使用说明
  - 🚪 退出
- 不显示主窗口，只在触发时弹出浮窗
```

#### 4.2 双击 Ctrl 检测（全局键盘钩子）

```typescript
// 核心逻辑：
// 使用 Electron 的 globalShortcut 无法监听单独的 Ctrl 按下
// 需要使用 node 原生模块：iohook 或 uiohook-napi
//
// 推荐：uiohook-napi（iohook 的现代替代，支持 Node 18+）
//
// 检测逻辑：
let lastCtrlTime = 0;
const DOUBLE_TAP_THRESHOLD = 300; // ms

uIOhook.on('keydown', (e) => {
  if (e.keycode === UiohookKey.Ctrl) {  // 左 Ctrl 或右 Ctrl
    const now = Date.now();
    if (now - lastCtrlTime < DOUBLE_TAP_THRESHOLD) {
      // 双击 Ctrl 触发！
      triggerExplain();
      lastCtrlTime = 0; // 重置
    } else {
      lastCtrlTime = now;
    }
  }
});

// 注意：
// - 如果用户按的是 Ctrl+C（Ctrl 和 C 一起按），不应该触发
// - 需要检测：两次 Ctrl 之间没有其他键被按下
// - 只在 Ctrl keydown 后紧跟 Ctrl keyup，没有夹杂其他键时才算一次"轻按"
```

**关于 uiohook-napi：**
- npm 包名：`uiohook-napi`
- 纯 Node.js 原生模块，跨平台（Windows / Mac / Linux）
- 可监听全局键盘和鼠标事件
- 不需要管理员权限（Mac 需要辅助功能权限）

**如果 uiohook-napi 安装有困难的备用方案：**
使用 Electron 的 `globalShortcut` 注册 `CommandOrControl+K CommandOrControl+K`（chord 快捷键）作为降级方案。在设置中让用户选择触发方式。

#### 4.3 浮动小窗

```typescript
// 创建无边框、置顶的小窗口
const popup = new BrowserWindow({
  width: 380,              // 紧凑宽度
  height: 160,             // 速览模式的初始高度
  frame: false,            // 无边框
  transparent: true,       // 支持圆角透明
  alwaysOnTop: true,       // 置顶
  skipTaskbar: true,       // 不显示在任务栏
  resizable: false,        // 不可拖动调整大小
  show: false,             // 创建时不显示
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
  },
});

// 在鼠标位置附近弹出
const { x, y } = screen.getCursorScreenPoint();
const display = screen.getDisplayNearestPoint({ x, y });

// 确保窗口不超出屏幕边界
let popupX = x + 10;  // 鼠标右下方偏移
let popupY = y + 10;

// 边界修正
if (popupX + 380 > display.bounds.x + display.bounds.width) {
  popupX = x - 390;  // 放到鼠标左边
}
if (popupY + 160 > display.bounds.y + display.bounds.height) {
  popupY = y - 170;  // 放到鼠标上方
}

popup.setPosition(popupX, popupY);
popup.show();
```

**窗口行为：**
- 点击窗口外任意位置 → 窗口消失（使用 `popup.on('blur', ...)`)
- 按 Esc → 窗口消失
- 点击「固定 📌」按钮 → 窗口不会因失焦消失
- 展开详解时 → 窗口高度动画过渡到更大尺寸（最大 500px）
- 窗口有微小的阴影和圆角，像一个浮层卡片

#### 4.4 速览模式

窗口默认显示紧凑的一句话解释：

```
 ┌────────────────────────────────────┐
 │  📖  st = set(nums)           📌 ✕ │
 │                                    │
 │  把列表 nums 转换成集合 set，      │
 │  赋值给变量 st。集合会自动去重。    │
 │                                    │
 │    [ 📋 复制 ]  [ 📖 展开详解 ]    │
 └────────────────────────────────────┘
     窗口尺寸：380 × 160px
```

#### 4.5 展开详解模式

点击展开后，窗口平滑变大：

```
 ┌────────────────────────────────────┐
 │  📖  st = set(nums)           📌 ✕ │
 │────────────────────────────────────│
 │  把列表 nums 转换成集合 set，      │
 │  赋值给变量 st。集合会自动去重。    │
 │                                    │
 │  ── 拆解 ─────────────────────── │
 │  set()  内置函数，转集合            │
 │  nums   传入的列表                 │
 │  st     结果变量名                 │
 │                                    │
 │  ── 示例 ─────────────────────── │
 │  nums = [1, 2, 2, 3]              │
 │  st = set(nums)                    │
 │  print(st)  # {1, 2, 3}           │
 │                                    │
 │  ── 要点 ─────────────────────── │
 │  • 去重  • 查找快  • 无序          │
 │────────────────────────────────────│
 │  💬 追问                           │
 │  ┌────────────────────────┐  [▶]  │
 │  │ 集合和列表什么区别？    │       │
 │  └────────────────────────┘       │
 └────────────────────────────────────┘
     窗口尺寸：380 × 自适应（最大 500px，超出可滚动）
```

#### 4.6 追问对话

```
 │────────────────────────────────────│
 │  💬 追问                           │
 │                                    │
 │  🧑 集合和列表什么区别？            │
 │                                    │
 │  🤖 列表有序可重复，用 []；         │
 │     集合无序不重复，用 {}。         │
 │     集合查找是 O(1)，列表是 O(n)。 │
 │                                    │
 │  ┌────────────────────────┐  [▶]  │
 │  │                        │       │
 │  └────────────────────────┘       │
 └────────────────────────────────────┘
```

**追问功能要求：**
- 输入框按 Enter 发送
- 流式输出（打字机效果）
- 每次追问携带：原始代码 + 速览 + 详解 + 对话历史
- 最多 10 轮对话
- 对话区域可滚动，自动滚到底部
- 新触发一段代码的解释时，旧对话清空

#### 4.7 LLM 调用

```typescript
// 统一接口
interface LLMProvider {
  quickExplain(code: string, lang: string, context: string): Promise<string>;
  detailedExplain(code: string, lang: string, context: string): Promise<string>;
  chat(messages: Message[], onChunk: (text: string) => void): Promise<void>;
}

// 支持的 Provider：
// 1. OpenAI 兼容接口（默认 DeepSeek）
// 2. Ollama 本地模型
// 3. Claude API

// 配置存储：使用 electron-store 持久化到本地 JSON 文件
```

#### 4.8 语言自动检测

```typescript
// 用户从不同编辑器复制代码，无法获取文件类型
// 需要自动检测编程语言
//
// 简单方案（推荐 MVP）：
// 基于关键词匹配判断语言
function detectLanguage(code: string): string {
  if (/\bdef\b|\bimport\b.*\bfrom\b|\bprint\s*\(/.test(code)) return 'python';
  if (/\bconst\b|\blet\b|\b=>\b|\bconsole\./.test(code)) return 'javascript';
  if (/\bpublic\b.*\bclass\b|\bSystem\.out/.test(code)) return 'java';
  if (/\b#include\b|\bstd::|\bcout\b/.test(code)) return 'cpp';
  if (/\bfn\b|\blet\s+mut\b|\b->/.test(code)) return 'rust';
  if (/\bfunc\b|\bpackage\b|\bfmt\./.test(code)) return 'go';
  return 'unknown'; // 让 LLM 自己判断
}

// 进阶方案（P1）：
// 也发给 LLM 让它判断，一次请求同时返回语言和解释
```

### P1 — 体验增强

#### 4.9 剪贴板保护

```typescript
// 双击 Ctrl 触发时：
// 1. 保存当前剪贴板内容
// 2. 模拟 Ctrl+C
// 3. 等待 100ms
// 4. 读取新的剪贴板内容（即选中的代码）
// 5. 恢复原来的剪贴板内容
//
// 使用 Electron 的 clipboard API：
const { clipboard } = require('electron');

async function getSelectedText(): Promise<string> {
  const originalClipboard = clipboard.readText();
  
  // 模拟 Ctrl+C
  // 使用 robotjs 或 nut-js 发送按键
  keyboard.pressKey(Key.LeftControl, Key.C);
  keyboard.releaseKey(Key.LeftControl, Key.C);
  
  await sleep(100);
  
  const selectedText = clipboard.readText();
  
  // 恢复剪贴板
  clipboard.writeText(originalClipboard);
  
  return selectedText;
}
```

#### 4.10 缓存

- LRU 缓存，100 条上限
- key = `hash(代码文本 + 检测到的语言)`
- 缓存速览和详解，追问不缓存

#### 4.11 设置窗口

从托盘菜单打开的独立设置窗口：

```
 ┌─ CodeWhisper 设置 ──────────────────────────┐
 │                                              │
 │  🔗 API 配置                                 │
 │  ┌──────────────────────────────────────┐    │
 │  │ 提供商   [DeepSeek        ▾]         │    │
 │  │ API Key  [sk-***************]        │    │
 │  │ 模型     [deepseek-chat    ]         │    │
 │  │       [ 测试连接 ]                    │    │
 │  └──────────────────────────────────────┘    │
 │                                              │
 │  ⌨️ 快捷键                                   │
 │  ┌──────────────────────────────────────┐    │
 │  │ 触发方式  ● 双击 Ctrl  ○ 自定义快捷键 │    │
 │  │ 双击间隔  [300] ms                    │    │
 │  │ 自动复制  ☑ 自动执行 Ctrl+C 获取选中  │    │
 │  └──────────────────────────────────────┘    │
 │                                              │
 │  🌐 解释设置                                  │
 │  ┌──────────────────────────────────────┐    │
 │  │ 解释语言  [简体中文      ▾]           │    │
 │  │ 难度等级  [初学者        ▾]           │    │
 │  └──────────────────────────────────────┘    │
 │                                              │
 │  🖥️ 通用                                     │
 │  ┌──────────────────────────────────────┐    │
 │  │ ☑ 开机自启动                          │    │
 │  │ ☑ 启动时最小化到托盘                   │    │
 │  └──────────────────────────────────────┘    │
 │                                              │
 │              [ 保存 ]  [ 取消 ]               │
 └──────────────────────────────────────────────┘
```

### P2 — 锦上添花

- **历史记录**：记录查询过的代码解释，可搜索回顾
- **开机自启动**：electron-builder 配置自启动
- **快捷键自定义**：允许设置为其他组合键
- **主题跟随系统**：自动明暗主题切换
- **多显示器支持**：弹窗在鼠标所在的显示器上弹出

---

## 五、技术架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron Main Process                     │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Tray Manager  │  │ Global Key   │  │ Window Manager      │ │
│  │ (系统托盘)    │  │ Listener     │  │                     │ │
│  │              │  │ (uiohook-napi│  │ - popup (浮动小窗)  │ │
│  │ - 右键菜单   │  │  双击Ctrl检测)│  │ - settings (设置)   │ │
│  └──────────────┘  └──────┬───────┘  └──────────┬──────────┘ │
│                           │ 触发                  │            │
│  ┌────────────────────────▼──────────────────────┐│            │
│  │           Code Acquisition Layer              ││            │
│  │                                               ││            │
│  │  1. 保存剪贴板 → 2. 模拟 Ctrl+C              ││            │
│  │  3. 读取剪贴板 → 4. 恢复剪贴板               ││            │
│  │  5. 检测语言   → 6. 提交给 LLM Service       ││            │
│  └────────────────────────┬──────────────────────┘│            │
│                           │                       │            │
│  ┌────────────────────────▼──────────────────────┐│            │
│  │              LLM Service Layer                ││            │
│  │  ┌───────────────┐ ┌────────┐ ┌────────────┐ ││            │
│  │  │OpenAI 兼容接口 │ │ Ollama │ │ Claude API │ ││            │
│  │  │(DeepSeek 默认) │ │ (本地) │ │            │ ││            │
│  │  └───────────────┘ └────────┘ └────────────┘ ││            │
│  │  CacheManager (LRU, 100条)                    ││            │
│  └───────────────────────────────────────────────┘│            │
│                                                    │            │
│  ┌─────────────────────┐  ┌───────────────────┐   │            │
│  │ Config Store        │  │ Clipboard Guard   │   │            │
│  │ (electron-store)    │  │ (保存/恢复剪贴板)  │   │            │
│  └─────────────────────┘  └───────────────────┘   │            │
│                                                    │            │
│  IPC 通信 (contextBridge + ipcMain/ipcRenderer)    │            │
│                                                    │            │
├────────────────────────────────────────────────────┤            │
│                  Renderer Process                   │            │
│                                                    │            │
│  ┌──── popup.html ──────────────────────────────┐ │            │
│  │  QuickView → DetailView → ChatView           │ │            │
│  │  (速览)      (详解)        (追问对话)         │ │            │
│  └──────────────────────────────────────────────┘ │            │
│                                                    │            │
│  ┌──── settings.html ───────────────────────────┐ │            │
│  │  API 配置 / 快捷键 / 通用设置                 │ │            │
│  └──────────────────────────────────────────────┘ │            │
└──────────────────────────────────────────────────────────────┘
```

---

## 六、文件结构

```
codewhisper/
├── package.json
├── tsconfig.json
├── electron-builder.yml          # 打包配置
│
├── src/
│   ├── main/                     # Electron 主进程
│   │   ├── index.ts              # 入口：创建 app、注册 Tray、初始化监听
│   │   ├── tray.ts               # 系统托盘管理
│   │   ├── keyListener.ts        # 全局键盘监听（uiohook-napi）+ 双击 Ctrl 检测
│   │   ├── windowManager.ts      # 窗口管理：创建/定位/显示/隐藏 popup 和 settings
│   │   ├── codeAcquisition.ts    # 获取选中代码：模拟Ctrl+C → 读剪贴板 → 恢复剪贴板
│   │   ├── languageDetector.ts   # 编程语言自动检测
│   │   ├── llm/
│   │   │   ├── llmService.ts     # LLM 统一接口 + Provider 工厂
│   │   │   ├── openaiProvider.ts # OpenAI 兼容接口（DeepSeek / 通义千问等）
│   │   │   ├── ollamaProvider.ts # Ollama 本地模型
│   │   │   └── claudeProvider.ts # Claude API
│   │   ├── prompts.ts            # Prompt 模板
│   │   ├── cache.ts              # LRU 缓存
│   │   └── store.ts              # 配置持久化（electron-store）
│   │
│   ├── preload/
│   │   └── preload.ts            # contextBridge：暴露安全的 IPC 接口给渲染进程
│   │
│   └── renderer/                 # 渲染进程（浮窗 UI）
│       ├── popup/
│       │   ├── index.html        # 浮窗 HTML
│       │   ├── index.ts          # 浮窗 JS 入口
│       │   ├── styles.css        # 浮窗样式
│       │   └── components/
│       │       ├── QuickView.ts  # 速览组件
│       │       ├── DetailView.ts # 详解组件
│       │       └── ChatView.ts   # 追问对话组件
│       │
│       └── settings/
│           ├── index.html        # 设置页 HTML
│           ├── index.ts          # 设置页 JS
│           └── styles.css        # 设置页样式
│
├── assets/
│   ├── icon.png                  # 应用图标 (256x256)
│   ├── tray-icon.png             # 托盘图标 (16x16 / 22x22)
│   └── tray-icon-disabled.png    # 暂停状态托盘图标
│
└── test/
    ├── keyListener.test.ts
    ├── languageDetector.test.ts
    ├── llmService.test.ts
    └── cache.test.ts
```

---

## 七、package.json

```jsonc
{
  "name": "codewhisper",
  "version": "0.1.0",
  "description": "双击 Ctrl，即刻解读代码",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "pack": "electron-builder --dir",
    "dist": "electron-builder",
    "dist:win": "electron-builder --win",
    "dist:mac": "electron-builder --mac",
    "dist:linux": "electron-builder --linux"
  },
  "dependencies": {
    "electron-store": "^8.1.0",
    "uiohook-napi": "^1.5.4",
    "marked": "^12.0.0",
    "highlight.js": "^11.9.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0",
    "electron-vite": "^2.0.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  },
  "build": {
    "appId": "com.codewhisper.app",
    "productName": "CodeWhisper",
    "directories": {
      "output": "release"
    },
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.png"
    },
    "mac": {
      "target": ["dmg"],
      "icon": "assets/icon.png"
    },
    "linux": {
      "target": ["AppImage"],
      "icon": "assets/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
}
```

---

## 八、Prompt 模板

```typescript
// ═══════ 速览 ═══════
export const QUICK_EXPLAIN_PROMPT = `你是一个面向中文编程初学者的代码解读助手。
请用简洁的中文解释以下代码的含义。

要求：
- 2-3 句话，总共不超过 80 个汉字
- 用最通俗的语言，假设用户完全没有编程基础
- 说清楚"这段代码做了什么事"
- 只输出纯文字解释，不要输出代码

代码（可能是 {language}）：
\`\`\`
{code}
\`\`\``;


// ═══════ 详解 ═══════
export const DETAILED_EXPLAIN_PROMPT = `你是一个面向中文编程初学者的代码教学助手。
请对以下代码进行详细的教学式解释。

请严格按以下 Markdown 格式输出：

## 拆解
把代码拆成几个关键部分，每个部分一行：
**\`关键词\`** — 一句话解释

## 示例
\`\`\`{language}
一段可运行的完整示例
\`\`\`
运行结果：
\`\`\`
预期输出
\`\`\`

## 要点
用 2-3 个 • 开头的短句总结要点。

要求：
- 用通俗中文，假设读者零基础
- 不要重复速览内容，直接进入拆解
- 示例简单易懂

代码（可能是 {language}）：
\`\`\`
{code}
\`\`\``;


// ═══════ 追问对话 System ═══════
export const CHAT_SYSTEM_PROMPT = `你是 CodeWhisper，一个面向中文编程初学者的代码教学助手。
用户正在学习这段代码（{language}）：
\`\`\`
{code}
\`\`\`

请：
- 用通俗中文回答，简洁为主（不超过 150 字，除非用户要求展开）
- 适当给出小代码示例
- 如果问题跑题，礼貌引导回来`;
```

---

## 九、IPC 通信协议

```typescript
// ══════ Main → Renderer ══════

// 显示速览
'whisper:show-quick': { code: string; explanation: string }

// 显示详解
'whisper:show-detail': { content: string }  // Markdown 格式

// 对话流式回复
'whisper:chat-chunk': { text: string }

// 对话完成
'whisper:chat-complete': {}

// 显示加载中
'whisper:loading': {}

// 显示错误
'whisper:error': { message: string }


// ══════ Renderer → Main ══════

// 请求展开详解
'whisper:request-detail': {}

// 发送追问
'whisper:send-chat': { text: string }

// 复制到剪贴板
'whisper:copy': { text: string }

// 固定/取消固定窗口
'whisper:toggle-pin': {}

// 关闭窗口
'whisper:close': {}

// 窗口高度变化（详解展开后通知主进程调整窗口大小）
'whisper:resize': { height: number }
```

---

## 十、浮窗 UI 样式要点

```css
/* ── 浮窗容器（无边框窗口的内容区） ── */
html, body {
  margin: 0;
  padding: 0;
  background: transparent;     /* 配合 Electron transparent 窗口 */
  overflow: hidden;
  user-select: text;
}

/* 主容器：圆角 + 阴影，模拟悬浮卡片 */
.whisper-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15),
              0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  max-height: 500px;
  display: flex;
  flex-direction: column;
}

/* 明暗主题变量 */
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --bg-secondary: #f5f5f5;
    --text: #1a1a1a;
    --text-secondary: #666666;
    --border: #e0e0e0;
    --accent: #2563eb;
    --accent-bg: #eff6ff;
    --code-bg: #f8f8f8;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e1e;
    --bg-secondary: #2d2d2d;
    --text: #d4d4d4;
    --text-secondary: #999999;
    --border: #404040;
    --accent: #58a6ff;
    --accent-bg: #1c2d3f;
    --code-bg: #2d2d2d;
  }
}

/* ── 标题栏（可拖动区域） ── */
.titlebar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;        /* 允许拖动窗口 */
  font-size: 12px;
  gap: 6px;
}

.titlebar-buttons {
  display: flex;
  gap: 4px;
  margin-left: auto;
  -webkit-app-region: no-drag;     /* 按钮区不可拖动 */
}

.titlebar-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 14px;
}

.titlebar-btn:hover {
  background: var(--bg-secondary);
}

/* ── 内容区（可滚动） ── */
.content {
  padding: 10px 12px;
  overflow-y: auto;
  flex: 1;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}

/* ── 代码展示 ── */
.code-display {
  background: var(--code-bg);
  border-left: 3px solid var(--accent);
  padding: 6px 10px;
  border-radius: 0 4px 4px 0;
  font-family: 'Consolas', 'Menlo', 'Courier New', monospace;
  font-size: 12px;
  margin-bottom: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ── 操作按钮 ── */
.actions {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px;
}

.action-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}

.action-btn:hover {
  background: var(--bg-secondary);
}

.action-btn.primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

/* ── 对话区 ── */
.chat-area {
  border-top: 1px solid var(--border);
  padding: 8px 12px;
}

.chat-messages {
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 8px;
}

.msg {
  font-size: 12px;
  margin-bottom: 6px;
  line-height: 1.5;
}

.msg-user { color: var(--accent); }
.msg-ai { padding-left: 6px; border-left: 2px solid var(--border); }

.chat-input-row {
  display: flex;
  gap: 6px;
}

.chat-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.chat-input:focus {
  border-color: var(--accent);
}

.chat-send-btn {
  padding: 6px 10px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
```

---

## 十一、开发步骤（给 Claude Code 的执行指令）

### 阶段一：骨架跑通

```
步骤 1：用 electron-vite 初始化项目（TypeScript 模板）
        npm create electron-vite@latest codewhisper -- --template vanilla-ts
        
步骤 2：配置 package.json 的依赖和打包配置

步骤 3：实现 main/index.ts
        - app.whenReady → 创建 Tray + 隐藏主窗口
        - 注册 app quit 事件

步骤 4：实现 main/tray.ts
        - 创建系统托盘图标
        - 右键菜单：启用/暂停、设置、退出

步骤 5：实现 main/windowManager.ts
        - createPopup()：创建 380×160 无边框置顶窗口
        - showPopup(x, y)：在指定坐标弹出
        - hidePopup()：隐藏
        - resizePopup(height)：调整高度（展开详解时）

步骤 6：创建 renderer/popup/index.html + styles.css
        - 先写一个静态 UI，硬编码一段解释内容
        - 确认浮窗样式正确：圆角、阴影、明暗主题

步骤 7：手动测试
        - npm run dev 启动
        - 确认托盘图标出现
        - 从托盘菜单手动触发弹窗（先不做键盘监听）
        - 确认弹窗显示在正确位置、外观正确
```

### 阶段二：键盘监听 + 获取代码

```
步骤 8：安装 uiohook-napi，实现 main/keyListener.ts
        - 双击 Ctrl 检测逻辑
        - 过滤 Ctrl+其他键的组合
        
        如果 uiohook-napi 安装失败（原生模块编译问题），
        降级方案：使用 globalShortcut 注册 Ctrl+Shift+K

步骤 9：实现 main/codeAcquisition.ts
        - 保存剪贴板 → 模拟 Ctrl+C → 读取 → 恢复
        - 使用 Electron 的 clipboard 模块
        - 模拟按键使用 @nut-tree/nut-js（跨平台模拟按键）

步骤 10：串联测试
         - 在任意编辑器选中代码 → 双击 Ctrl
         → 控制台打印获取到的代码
         → 弹窗显示代码文本
```

### 阶段三：接通 LLM

```
步骤 11：实现 main/llm/openaiProvider.ts
         - fetch 调用 /v1/chat/completions
         - 支持普通调用和流式调用

步骤 12：实现 main/llm/llmService.ts
         - Provider 工厂模式
         - quickExplain / detailedExplain / chat 方法

步骤 13：实现 main/prompts.ts
         - 速览、详解、追问三套 Prompt

步骤 14：实现 main/languageDetector.ts
         - 关键词匹配检测编程语言

步骤 15：实现 main/store.ts
         - electron-store 存储配置
         - 提供默认值（DeepSeek）

步骤 16：实现 preload/preload.ts
         - contextBridge 暴露 IPC 方法

步骤 17：串联：双击 Ctrl → 获取代码 → 检测语言 → 调 LLM → 弹窗显示速览
```

### 阶段四：完整 UI

```
步骤 18：实现 popup 的完整 HTML/CSS/JS
         - QuickView 速览区
         - 展开/收起按钮交互
         
步骤 19：实现 DetailView 详解区
         - Markdown 渲染（marked + highlight.js）
         - 展开时动态调整窗口高度

步骤 20：实现 ChatView 追问对话区
         - 消息列表 + 输入框
         - 流式显示回复（逐 chunk 追加文字）
         - 对话历史管理

步骤 21：实现窗口交互
         - 点击外部关闭（blur 事件）
         - Esc 关闭
         - 固定按钮（取消 blur 自动关闭）
         - 拖动标题栏移动窗口
```

### 阶段五：设置和完善

```
步骤 22：实现 settings 窗口 UI 和功能
步骤 23：实现 LRU 缓存
步骤 24：实现剪贴板保护（保存 + 恢复）
步骤 25：添加 Ollama Provider
步骤 26：首次使用引导（检测到 API Key 为空时弹出设置）
步骤 27：异常处理：网络超时、API 报错、空选中等
步骤 28：electron-builder 打包测试
步骤 29：编写 README.md
```

---

## 十二、关键注意事项（给 Claude Code）

1. **uiohook-napi 是原生模块**，需要 node-gyp 编译环境。如果编译失败，提供两个降级方案：
   - 方案 A：`globalShortcut.register('CommandOrControl+Shift+K', callback)`
   - 方案 B：`globalShortcut.register('CommandOrControl+Q', callback)`
   在代码中做好条件判断，优先用 uiohook-napi，失败时自动降级。

2. **模拟 Ctrl+C 获取选中文本**需要按键模拟库。推荐 `@nut-tree/nut-js`（跨平台），如果安装困难可以用 `robotjs`。如果两个都装不上，降级为"用户自己先 Ctrl+C"的模式（检测剪贴板变化）。

3. **Electron transparent 窗口在 Linux 上**可能有兼容性问题。加一个判断：Linux 上不使用透明背景，改为普通白色/深色背景 + 圆角。

4. **防抖处理**：双击 Ctrl 触发后，1 秒内再次触发应忽略（防止误操作）。

5. **窗口动画**：展开详解时的高度变化要平滑。在 Renderer 中计算内容高度后，通过 IPC 通知 Main 进程调用 `popup.setSize(380, newHeight, true)`（第三个参数 animate=true）。

6. **Mac 辅助功能权限**：uiohook-napi 在 Mac 上需要用户授权辅助功能。首次启动时需检测权限，未授权时弹出引导。用 `systemPreferences.isTrustedAccessibilityClient(true)` 检测。

7. **字体**：浮窗中代码部分使用等宽字体：`'Cascadia Code', 'Fira Code', 'Consolas', 'Menlo', monospace`。解释文字用系统字体。

8. **打包注意**：uiohook-napi 和 nut-js 等原生模块需要在 electron-builder 配置中正确配置 `extraResources` 或 `externals`。

9. **窗口位置记忆**：不需要记忆，每次都在鼠标位置附近弹出。但需要处理多显示器场景：用 `screen.getDisplayNearestPoint()` 获取鼠标所在的显示器。

10. **进程架构**：Electron 的 Main 进程负责所有后端逻辑（键盘监听、LLM 调用、剪贴板操作）。Renderer 进程（浮窗）只负责 UI 展示。两者通过 IPC 通信。绝对不要在 Renderer 中直接调用 Node.js API。
