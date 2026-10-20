/**
 * LLM 统一服务层。
 *
 * Provider 分支：
 *   - zhipu        智谱 GLM-4-Flash 永久免费（OpenAI 兼容，baseUrl=bigmodel.cn）
 *   - ollama       本地 Ollama（OpenAI 兼容，baseUrl=localhost:11434）
 *   - openai-compat 其他 OpenAI 兼容（DeepSeek / 通义 / Moonshot 等）
 *   - claude       未实现
 *
 * Mode 分支：
 *   - quick        一句话速览（流式）
 *   - segmented    详解-分段（流式，markdown 渲染）
 *   - lineByLine   详解-逐行（非流式，JSON 解析后结构化渲染）
 */

import { OpenAIProvider, ChatMessage, OpenAIProviderError } from './openaiProvider';
import { getConfig, PROVIDER_PRESETS, Provider } from '../store';
import { quickExplainPrompt, detailedExplainPrompt, lineByLinePrompt, chatSystemPrompt } from '../prompts';
import { Language } from '../languageDetector';

function makeProvider(): OpenAIProvider {
  const cfg = getConfig();
  if (cfg.provider === 'claude') {
    throw new OpenAIProviderError(`暂不支持 provider="claude"`);
  }
  // Ollama 要求非空 apiKey；填占位 "ollama" 通过校验
  const apiKey = cfg.provider === 'ollama'
    ? (cfg.apiKey || 'ollama')
    : cfg.apiKey;
  return new OpenAIProvider({
    baseUrl: cfg.baseUrl || PROVIDER_PRESETS[cfg.provider as Provider]?.baseUrl || '',
    apiKey,
    model: cfg.model,
    thinking: cfg.thinking,
  });
}

export interface ExplainArgs {
  code: string;
  language: Language;
  signal?: AbortSignal;
  /** 传入则走流式，每个 chunk 立即回调；否则走非流式 */
  onChunk?: (text: string) => void;
}

export interface LineByLineLine {
  n: number;
  code: string;
  explain: string;
}

export interface LineByLineResult {
  lines: LineByLineLine[];
  raw: string; // 原始 AI 输出，用于调试/降级渲染
}

/**
 * 尝试从 AI 输出里抽取 JSON 块（容忍 ```json 围栏或前置/后置噪声）。
 * 解析失败时返回 null，调用方应降级到 segmented 模式或显示原始内容。
 */
function tryParseLineByLineJson(raw: string): LineByLineLine[] | null {
  if (!raw) return null;
  let s = raw.trim();

  // 去掉 ```json ... ``` 围栏
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  // 截到第一个 { 之前如果有噪声
  const firstBrace = s.indexOf('{');
  if (firstBrace > 0) s = s.slice(firstBrace);

  // 截到最后一个 }
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace >= 0 && lastBrace < s.length - 1) s = s.slice(0, lastBrace + 1);

  // 尝试 1：严格解析
  try {
    const obj = JSON.parse(s);
    if (obj && Array.isArray(obj.lines)) {
      return obj.lines
        .filter((x: any) => x && typeof x.n === 'number' && typeof x.code === 'string' && typeof x.explain === 'string')
        .map((x: any) => ({ n: x.n, code: x.code, explain: x.explain }));
    }
  } catch { /* fallthrough */ }

  // 尝试 2：容错 - 找到 {"lines":[ ... ]} 子串
  const m = s.match(/\{\s*"lines"\s*:\s*\[([\s\S]*?)\]\s*\}/);
  if (m) {
    try {
      const obj = JSON.parse('{"lines":[' + m[1] + ']}');
      if (Array.isArray(obj.lines)) {
        return obj.lines
          .filter((x: any) => x && typeof x.n === 'number' && typeof x.code === 'string' && typeof x.explain === 'string')
          .map((x: any) => ({ n: x.n, code: x.code, explain: x.explain }));
      }
    } catch { /* fallthrough */ }
  }

  return null;
}

export async function quickExplain({ code, language, signal, onChunk }: ExplainArgs): Promise<string> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'user', content: quickExplainPrompt({ code, language }) },
  ];
  if (onChunk) {
    const full = await provider.stream(messages, { signal, onChunk, temperature: 0.2, maxTokens: 1024 });
    return full.trim();
  }
  const text = await provider.complete(messages, { signal, temperature: 0.2, maxTokens: 1024 });
  return text.trim();
}

export async function detailedExplain({ code, language, signal, onChunk }: ExplainArgs): Promise<string> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'user', content: detailedExplainPrompt({ code, language }) },
  ];
  if (onChunk) {
    const full = await provider.stream(messages, { signal, onChunk, temperature: 0.3, maxTokens: 4096 });
    return full.trim();
  }
  const text = await provider.complete(messages, { signal, temperature: 0.3, maxTokens: 4096 });
  return text.trim();
}

/**
 * 逐行解释：走非流式（不暴露 onChunk），让 AI 输出严格 JSON，
 * 解析成结构化数据返回。解析失败时 lines=[]、raw 保留原始内容供降级渲染。
 */
export async function lineByLineExplain({ code, language, signal }: ExplainArgs): Promise<LineByLineResult> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'user', content: lineByLinePrompt({ code, language }) },
  ];
  const raw = await provider.complete(messages, { signal, temperature: 0.1, maxTokens: 3000 });
  const lines = tryParseLineByLineJson(raw) || [];
  return { lines, raw };
}

export interface ChatArgs {
  code: string;
  language: Language;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}

export async function chat({ code, language, history, signal, onChunk }: ChatArgs): Promise<string> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'system', content: chatSystemPrompt({ code, language }) },
    ...history,
  ];
  return provider.stream(messages, { signal, onChunk, temperature: 0.4, maxTokens: 2048 });
}

export { OpenAIProviderError };
