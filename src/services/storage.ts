export type ProviderType = 'magpie' | 'deepseek' | 'openai' | 'anthropic' | 'ollama';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface UserConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  capsuleEnabled: boolean;
  theme: ThemeMode;
  systemPromptPreset: 'intuition' | 'critique' | 'summary' | 'custom';
  customSystemPrompt?: string;
}

export const DEFAULT_CONFIG: UserConfig = {
  provider: 'magpie',
  apiKey: '',
  baseUrl: 'http://127.0.0.1:3425/v1',
  model: 'auto/deepseek-v4.1-flash',
  capsuleEnabled: true,
  theme: 'system',
  systemPromptPreset: 'intuition',
};

export const PROVIDER_DEFAULTS: Record<ProviderType, { baseUrl: string; model: string }> = {
  magpie: {
    baseUrl: 'http://127.0.0.1:3425/v1',
    model: 'auto/deepseek-v4.1-flash',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3:latest',
  },
};

/**
 * 读取本地用户配置
 */
export async function getStoredConfig(): Promise<UserConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['paper_pilot_config'], (result) => {
      if (result.paper_pilot_config) {
        resolve({ ...DEFAULT_CONFIG, ...result.paper_pilot_config });
      } else {
        resolve(DEFAULT_CONFIG);
      }
    });
  });
}

/**
 * 保存用户配置到本地沙箱
 */
export async function saveStoredConfig(config: Partial<UserConfig>): Promise<void> {
  const current = await getStoredConfig();
  const updated = { ...current, ...config };
  return new Promise((resolve) => {
    chrome.storage.local.set({ paper_pilot_config: updated }, () => {
      resolve();
    });
  });
}
