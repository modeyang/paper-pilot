import { defineConfig } from 'wxt';

// 针对 Chrome Manifest V3 和 Side Panel 的 WXT 配置文件
export default defineConfig({
  manifest: {
    name: 'PaperPilot: AI Paper Side Panel Copilot',
    description: 'AI companion for arXiv & academic papers in Chrome Side Panel with BYOK.',
    version: '1.0.0',
    permissions: ['sidePanel', 'storage', 'activeTab'],
    host_permissions: [
      'https://api.deepseek.com/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'http://localhost:11434/*',
    ],
    action: {
      default_title: 'Click to open PaperPilot Side Panel',
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: 'Alt+P',
          mac: 'Alt+P',
        },
        description: 'Open PaperPilot Side Panel',
      },
    },
  },
});
