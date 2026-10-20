/**
 * OpenAI 兼容接口 Provider（DeepSeek、通义千问、Moonshot 等都走这条）。
 * 使用原生 fetch（Node 18+）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * DeepSeek 等支持思考模式的接口：
   *   'disabled' / 'enabled' 会附加到请求 body 的 thinking.type 字段；
   *   'auto' 或未设置则不附加（兼容标准 OpenAI 接口）。
   */
  thinking?: 'auto' | 'disabled' | 'enabled';
}

export interface CompleteOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /**
   * 请求超时（毫秒）。默认 15000，叠加到外部 signal 上。
   * 防止"WiFi 连着但黑洞路由"场景下 TCP 连接一直挂起到 OS 默认超时时（~20~30s）
   * 用户被迫干等。15s 已足够覆盖所有主流 LLM 的首字返回。
   */
  timeoutMs?: number;
}

export interface StreamOptions extends CompleteOptions {
  onChunk: (text: string) => void;
}

export class OpenAIProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenAIProviderError';
    this.status = status;
  }
}

/**
 * 把外部 AbortSignal 和超时定时器合并：任一触发就 abort。
 * Node 18+ 有原生 AbortSignal.any，但广泛可用的回退是手写：
 * 监听外部 abort，监听 setTimeout 触发，统一调用合并 controller.abort()。
 */
function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const ctrl = new AbortController();
  let externalListener: (() => void) | null = null;
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else {
      externalListener = () => ctrl.abort(external.reason);
      external.addEventListener('abort', externalListener, { once: true });
    }
  }
  const timer = setTimeout(() => {
    if (ctrl.signal.aborted) return;
    const reason = new Error(`LLM 请求超过 ${timeoutMs}ms 未响应（可能是断网或黑洞路由，已自动中断）`);
    (reason as Error & { name: string }).name = 'TimeoutError';
    ctrl.abort(reason);
  }, timeoutMs);
  // 成功路径只要 controller 被任何原因 abort 就清掉定时器
  ctrl.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    if (external && externalListener) external.removeEventListener('abort', externalListener);
  }, { once: true });
  return ctrl.signal;
}

function formatNetworkError(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string }; message?: string };
  if (e?.name === 'AbortError') return '请求已取消';
  const code = e?.code || e?.cause?.code;
  const msg = e?.message || e?.cause?.message || String(err);
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) return '网络无法访问 LLM 域名（ENOTFOUND）：' + msg;
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return '连接被拒绝（ECONNREFUSED）：' + msg;
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || /timeout/i.test(msg)) return '连接超时：' + msg;
  if (code === 'CERT_HAS_EXPIRED' || /certificate/i.test(msg)) return 'TLS 证书问题：' + msg;
  return '网络请求失败：' + msg;
}

function formatHttpError(status: number, body: string): string {
  const tail = body ? ' | ' + body.slice(0, 240).replace(/\s+/g, ' ') : '';
  switch (status) {
    case 401: return 'API Key 无效或未授权（401），请检查 apiKey 是否正确。' + tail;
    case 402: return '账户余额不足（402），请前往 LLM 平台充值。' + tail;
    case 403: return '请求被拒绝（403），可能是地区/权限限制。' + tail;
    case 404: return '接口或模型不存在（404），请检查 baseUrl 与 model 名称。' + tail;
    case 422: return '请求参数不合法（422）。' + tail;
    case 429: return '请求过于频繁（429），请稍后重试。' + tail;
    default:
      if (status >= 500) return `服务端错误（${status}），请稍后重试。` + tail;
      return `LLM 调用失败（${status}）。` + tail;
  }
}

export class OpenAIProvider {
  constructor(private opts: OpenAIProviderOptions) {}

  private headers(): Record<string, string> {
    if (!this.opts.apiKey) {
      throw new OpenAIProviderError('未配置 API Key，请在配置文件中填写或设置环境变量 DEEPSEEK_API_KEY / OPENAI_API_KEY');
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.opts.apiKey}`,
    };
  }

  private endpoint(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    return `${base}/chat/completions`;
  }

  private buildBody(messages: ChatMessage[], options: CompleteOptions, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1024,
      stream,
    };
    if (this.opts.thinking === 'disabled' || this.opts.thinking === 'enabled') {
      body.thinking = { type: this.opts.thinking };
    }
    return body;
  }

  async complete(messages: ChatMessage[], options: CompleteOptions = {}): Promise<string> {
    let res: Response;
    const { signal, timeoutMs = 15000 } = options;
    const combinedSignal = combineSignals(signal, timeoutMs);
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        signal: combinedSignal,
        body: JSON.stringify(this.buildBody(messages, options, false)),
      });
    } catch (err) {
      throw new OpenAIProviderError(formatNetworkError(err));
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OpenAIProviderError(formatHttpError(res.status, text), res.status);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string') {
      throw new OpenAIProviderError('LLM 响应格式异常：缺少 choices[0].message.content');
    }
    if (!content && choice?.finish_reason === 'length') {
      throw new OpenAIProviderError('LLM 输出被 max_tokens 截断且无可见内容（推理模型可能耗尽 token），请提高 max_tokens 或换轻量模型');
    }
    return content;
  }

  async stream(messages: ChatMessage[], options: StreamOptions): Promise<string> {
    let res: Response;
    const { signal, timeoutMs = 30000, ...rest } = options;
    const combinedSignal = combineSignals(signal, timeoutMs);
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        signal: combinedSignal,
        body: JSON.stringify(this.buildBody(messages, { ...rest, maxTokens: rest.maxTokens ?? 2048 }, true)),
      });
    } catch (err) {
      throw new OpenAIProviderError(formatNetworkError(err));
    }

    if (!res.ok || !res.body) {
      const text = res.body ? await res.text().catch(() => '') : '';
      throw new OpenAIProviderError(formatHttpError(res.status, text), res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return full;
        }
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = obj?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            full += delta;
            try {
              options.onChunk(delta);
            } catch (e) {
              console.error('[OpenAIProvider] onChunk handler error:', e);
            }
          }
        } catch {
          // 容忍部分 chunk 解析错误
        }
      }
    }

    return full;
  }
}
