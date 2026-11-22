import { getStoredConfig, saveStoredConfig, PROVIDER_DEFAULTS, UserConfig, ProviderType } from '@/services/storage';
import { streamAIChat, ACADEMIC_PROMPTS, ChatMessage } from '@/services/ai';

// 运行时状态
let currentConfig: UserConfig;
let activeAbortController: AbortController | null = null;
let currentPaperData = {
  title: '',
  abstract: '',
  authors: [] as string[],
  url: '',
};
let currentSelection = '';

// DOM 元素引用
const elements = {
  providerBadge: document.getElementById('provider-badge') as HTMLSpanElement,
  tabButtons: document.querySelectorAll<HTMLButtonElement>('.tab-btn'),
  tabPanes: document.querySelectorAll<HTMLElement>('.tab-pane'),

  // Overview Tab
  paperTitle: document.getElementById('paper-title') as HTMLDivElement,
  paperAuthors: document.getElementById('paper-authors') as HTMLDivElement,
  btnTldr: document.getElementById('btn-tldr') as HTMLButtonElement,
  btnCritique: document.getElementById('btn-critique') as HTMLButtonElement,
  overviewOutput: document.getElementById('overview-output') as HTMLDivElement,
  btnCopyOverview: document.getElementById('btn-copy-overview') as HTMLButtonElement,

  // Selection Tab
  selectionPreview: document.getElementById('selected-text-preview') as HTMLDivElement,
  btnExplainFormula: document.getElementById('btn-explain-formula') as HTMLButtonElement,
  btnExplainPlain: document.getElementById('btn-explain-plain') as HTMLButtonElement,
  selectionOutput: document.getElementById('selection-output') as HTMLDivElement,
  btnCopySelection: document.getElementById('btn-copy-selection') as HTMLButtonElement,

  // Settings Tab
  selectProvider: document.getElementById('select-provider') as HTMLSelectElement,
  inputApiKey: document.getElementById('input-api-key') as HTMLInputElement,
  inputBaseUrl: document.getElementById('input-base-url') as HTMLInputElement,
  inputModel: document.getElementById('input-model') as HTMLInputElement,
  btnSaveSettings: document.getElementById('btn-save-settings') as HTMLButtonElement,
  btnTestConnection: document.getElementById('btn-test-connection') as HTMLButtonElement,
  settingsStatus: document.getElementById('settings-status') as HTMLDivElement,
};

// 初始化
async function init() {
  currentConfig = await getStoredConfig();
  updateUIFromConfig();
  setupEventListeners();
  listenToRuntimeMessages();
}

// 同步配置到 UI
function updateUIFromConfig() {
  elements.providerBadge.textContent = currentConfig.provider;
  elements.selectProvider.value = currentConfig.provider;
  elements.inputApiKey.value = currentConfig.apiKey;
  elements.inputBaseUrl.value = currentConfig.baseUrl;
  elements.inputModel.value = currentConfig.model;
}

// 事件绑定
function setupEventListeners() {
  // Tab 切换
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      if (!targetId) return;

      elements.tabButtons.forEach((b) => b.classList.remove('active'));
      elements.tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(targetId)?.classList.add('active');
    });
  });

  // 切换 Provider 时自动补全推荐 BaseURL 与 Model
  elements.selectProvider.addEventListener('change', () => {
    const provider = elements.selectProvider.value as ProviderType;
    const defaults = PROVIDER_DEFAULTS[provider];
    if (defaults) {
      elements.inputBaseUrl.value = defaults.baseUrl;
      elements.inputModel.value = defaults.model;
    }
  });

  // 保存配置
  elements.btnSaveSettings.addEventListener('click', async () => {
    const updated: Partial<UserConfig> = {
      provider: elements.selectProvider.value as ProviderType,
      apiKey: elements.inputApiKey.value.trim(),
      baseUrl: elements.inputBaseUrl.value.trim(),
      model: elements.inputModel.value.trim(),
    };
    await saveStoredConfig(updated);
    currentConfig = await getStoredConfig();
    updateUIFromConfig();
    showStatus('配置已安全保存至本地沙箱！', 'success');
  });

  // 测试连通性
  elements.btnTestConnection.addEventListener('click', async () => {
    showStatus('正在测试连通性...', 'info');
    try {
      await streamAIChat(
        [{ role: 'user', content: 'Say "Connection successful!" in 3 words.' }],
        {
          ...currentConfig,
          apiKey: elements.inputApiKey.value.trim(),
          baseUrl: elements.inputBaseUrl.value.trim(),
          model: elements.inputModel.value.trim(),
          provider: elements.selectProvider.value as ProviderType,
        },
        {
          onChunk: () => {},
          onError: (err) => showStatus(`连接失败: ${err.message}`, 'error'),
          onFinish: () => showStatus('✅ 连通性测试通过！API 状态正常。', 'success'),
        }
      );
    } catch (e: any) {
      showStatus(`测试异常: ${e.message}`, 'error');
    }
  });

  // 一键速读
  elements.btnTldr.addEventListener('click', () => {
    const prompt = `请对以下论文进行 4 维核心解析：\n\n标题: ${currentPaperData.title}\n摘要: ${currentPaperData.abstract}`;
    runInference(
      [
        { role: 'system', content: ACADEMIC_PROMPTS.summary },
        { role: 'user', content: prompt },
      ],
      elements.overviewOutput
    );
  });

  // 审稿人盲评
  elements.btnCritique.addEventListener('click', () => {
    const prompt = `请针对以下论文进行严苛审稿人盲评：\n\n标题: ${currentPaperData.title}\n摘要: ${currentPaperData.abstract}`;
    runInference(
      [
        { role: 'system', content: ACADEMIC_PROMPTS.critique },
        { role: 'user', content: prompt },
      ],
      elements.overviewOutput
    );
  });

  // 公式直觉解读
  elements.btnExplainFormula.addEventListener('click', () => {
    if (!currentSelection) {
      elements.selectionOutput.textContent = '请先在论文页面中划选一段公式或数学推导。';
      return;
    }
    runInference(
      [
        { role: 'system', content: ACADEMIC_PROMPTS.intuition },
        { role: 'user', content: `请用直觉与生活化类比解读以下数学公式/算法：\n\n${currentSelection}` },
      ],
      elements.selectionOutput
    );
  });

  // 通俗解读
  elements.btnExplainPlain.addEventListener('click', () => {
    if (!currentSelection) {
      elements.selectionOutput.textContent = '请先在论文页面中划选一段文字。';
      return;
    }
    runInference(
      [
        { role: 'system', content: '你是一位精通化繁为简的学术导师，请用大白话彻底讲透输入的这段学术文本。' },
        { role: 'user', content: currentSelection },
      ],
      elements.selectionOutput
    );
  });

  // 复制功能
  elements.btnCopyOverview.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.overviewOutput.innerText);
    elements.btnCopyOverview.textContent = '已复制!';
    setTimeout(() => (elements.btnCopyOverview.textContent = '复制'), 1500);
  });

  elements.btnCopySelection.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.selectionOutput.innerText);
    elements.btnCopySelection.textContent = '已复制!';
    setTimeout(() => (elements.btnCopySelection.textContent = '复制'), 1500);
  });
}

// 统一流式推理调度
function runInference(messages: ChatMessage[], targetEl: HTMLElement) {
  if (!currentConfig.apiKey && currentConfig.provider !== 'ollama') {
    targetEl.innerHTML = `<span style="color:#dc2626;">⚠️ 请先切换到【设置】标签页配置你的 API Key。</span>`;
    return;
  }

  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  targetEl.textContent = '思考中...';
  let accumulated = '';

  streamAIChat(
    messages,
    currentConfig,
    {
      onChunk: (delta) => {
        accumulated += delta;
        targetEl.textContent = accumulated;
      },
      onError: (err) => {
        targetEl.innerHTML = `<span style="color:#dc2626;">调用出错: ${err.message}</span>`;
      },
      onFinish: (full) => {
        targetEl.textContent = full;
      },
    },
    activeAbortController.signal
  );
}

// 监听扩展内部消息
function listenToRuntimeMessages() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'PAPER_METADATA_EXTRACTED') {
      currentPaperData = message.payload;
      elements.paperTitle.textContent = currentPaperData.title || '已捕获学术页面';
      elements.paperAuthors.textContent = currentPaperData.authors?.slice(0, 3).join(', ') + ' 等';
    } else if (message.action === 'SELECTION_TEXT_CAPTURED') {
      currentSelection = message.payload.selectedText;
      elements.selectionPreview.textContent = currentSelection;

      // 自动切换到划词 Tab
      elements.tabButtons.forEach((b) => b.classList.remove('active'));
      elements.tabPanes.forEach((p) => p.classList.remove('active'));
      const selectionTabBtn = document.querySelector<HTMLButtonElement>('[data-tab="tab-selection"]');
      selectionTabBtn?.classList.add('active');
      document.getElementById('tab-selection')?.classList.add('active');

      // 默认自动触发公式与直觉解读
      elements.btnExplainFormula.click();
    }
  });
}

function showStatus(msg: string, type: 'success' | 'error' | 'info') {
  elements.settingsStatus.textContent = msg;
  elements.settingsStatus.style.display = 'block';
  elements.settingsStatus.style.backgroundColor =
    type === 'success' ? '#dcfce7' : type === 'error' ? '#fee2e2' : '#f1f5f9';
  elements.settingsStatus.style.color =
    type === 'success' ? '#166534' : type === 'error' ? '#991b1b' : '#334155';
}

init();
