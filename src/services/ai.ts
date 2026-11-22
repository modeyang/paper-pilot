import { UserConfig } from './storage';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onError: (error: Error) => void;
  onFinish: (fullText: string) => void;
}

export const ACADEMIC_PROMPTS = {
  intuition: `你是一位世界顶级的学术导师和数学/物理直觉翻译大师。
用户会发给你论文中的一段数学公式、推导步骤或复杂算法伪代码。
你的核心任务是：
1. 【杜绝术语复读】：不要照抄符号念公式，必须用几何直觉、物理图像或通俗类比解释它的“本质目的”。
2. 【核心变量洞察】：挑出 2~3 个最关键的参数/符号，明确说明“当这个变量增大/减小时，系统行为会如何变化”。
3. 【局限性提示】：一句话指出这个公式或假设在什么极端情况下可能失效。
输出风格：清晰分点，专业严谨但不枯燥。`,

  critique: `你是一位来自顶会（NeurIPS/ICLR/CVPR/Nature）的极其严苛、经验丰富的资深审稿人（Area Chair）。
用户会给你一段论文摘要或核心方法描述。
请毫不留情、直击要害地进行审稿盲评（Critique）：
1. 【创新性质疑】：该方法是否只是现有组件的微小增量（A+B Trick）？真正的理论突破点在哪里？
2. 【消融实验盲区】：哪些关键假设或模块缺乏充分的控制变量对照？
3. 【工程与算力隐忧】：显存占用、训练开销或实时推理延迟是否现实？复现成本是否过高？
输出风格：客观尖锐、逻辑严密、学术建设性强。`,

  summary: `你是一位学术前沿速递首席分析师。
请用最精炼的结构化语言对输入的学术文本进行 4 维提炼：
- 🎯 【核心解决痛点】：（1句话明确 Baseline 的致命缺陷）
- 💡 【关键创新解法】：（1句话说明作者提出的核心架构或方法）
- 📊 【关键 SOTA 数据】：（提升幅度与评测基准）
- ⚠️ 【当前主要局限】：（未解决的问题与未来方向）`,
};

/**
 * 统一的大模型 SSE 流式请求客户端
 */
export async function streamAIChat(
  messages: ChatMessage[],
  config: UserConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  let fullOutput = '';

  try {
    if (config.provider === 'anthropic') {
      // Anthropic Claude 格式
      const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
      const userMsgs = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'dangerously-allow-browser': 'true',
        },
        body: JSON.stringify({
          model: config.model || 'claude-3-5-sonnet-20241022',
          messages: userMsgs,
          system: systemMsg,
          stream: true,
          max_tokens: 2048,
        }),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API Error (${res.status}): ${errText}`);
      }

      await parseSSE(res, (data) => {
        if (data.type === 'content_block_delta' && data.delta?.text) {
          fullOutput += data.delta.text;
          callbacks.onChunk(data.delta.text);
        }
      });
    } else {
      // OpenAI 兼容格式 (含 DeepSeek, 本地 Ollama, OpenAI)
      const url =
        config.provider === 'ollama'
          ? `${config.baseUrl}/v1/chat/completions`
          : `${config.baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          temperature: 0.3,
        }),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${config.provider.toUpperCase()} API Error (${res.status}): ${errText}`);
      }

      await parseSSE(res, (data) => {
        const content = data.choices?.[0]?.delta?.content;
        if (content) {
          fullOutput += content;
          callbacks.onChunk(content);
        }
      });
    }

    callbacks.onFinish(fullOutput);
  } catch (error: any) {
    if (signal?.aborted) {
      console.log('[PaperPilot] Inference aborted by user.');
    } else {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * 健壮的通用 SSE 流解析器
 */
async function parseSSE(response: Response, onData: (json: any) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is null');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // 心跳与注释

      if (trimmed.startsWith('data: ')) {
        const raw = trimmed.slice(6);
        if (raw === '[DONE]') return;
        try {
          const parsed = JSON.parse(raw);
          onData(parsed);
        } catch {
          // 忽略格式解析残块
        }
      }
    }
  }
}
