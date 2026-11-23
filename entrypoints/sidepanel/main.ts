import 'katex/dist/katex.min.css';
import { getStoredConfig, saveStoredConfig, PROVIDER_DEFAULTS, UserConfig, ProviderType, ThemeMode } from '../../src/services/storage';
import { streamAIChat, ACADEMIC_PROMPTS, ChatMessage } from '../../src/services/ai';
import { renderMarkdownInto } from '../../src/utils/markdown';

const EMPTY_PAPER_DATA = {
  title: '',
  abstract: '',
  authors: [] as string[],
  url: '',
};
const DEFAULT_PAPER_PLACEHOLDER = '未检测到学术论文（请打开 arXiv / bioRxiv / PubMed 页面或手动输入）';

// 运行时状态
let currentConfig: UserConfig;
let activeAbortController: AbortController | null = null;
let elapsedTimerId: number | null = null;
let inferenceStartMs = 0;
let currentPaperData = { ...EMPTY_PAPER_DATA };
let currentSelection = '';
let cachedModelsKey = '';
let cachedDiscoveredModels: Array<{ id: string; label?: string }> = [];

interface TabChatSession {
  history: ChatMessage[];
  renderedTranscript: string;
}

const chatSessions: Record<'overview' | 'selection', TabChatSession> = {
  overview: { history: [], renderedTranscript: '' },
  selection: { history: [], renderedTranscript: '' },
};

const PROVIDER_PRESET_MODELS: Record<ProviderType, Array<{ id: string; label?: string }>> = {
  magpie: [{ id: PROVIDER_DEFAULTS.magpie.model }],
  deepseek: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
  openai: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
  anthropic: [{ id: 'claude-3-5-sonnet-20241022' }, { id: 'claude-3-5-haiku-20241022' }],
  ollama: [{ id: 'llama3' }, { id: 'qwen2.5' }],
};

// DOM 元素引用
const elements = {
  providerBadge: document.getElementById('provider-badge') as HTMLSpanElement,
  quickModelSelect: document.getElementById('quick-model-select') as HTMLSelectElement,
  btnToggleTheme: document.getElementById('btn-toggle-theme') as HTMLButtonElement,
  inferenceStatusBar: document.getElementById('inference-status-bar') as HTMLDivElement,
  inferenceStatusText: document.getElementById('inference-status-text') as HTMLSpanElement,
  btnStopInference: document.getElementById('btn-stop-inference') as HTMLButtonElement,
  tabButtons: document.querySelectorAll<HTMLButtonElement>('.tab-btn'),
  tabPanes: document.querySelectorAll<HTMLElement>('.tab-pane'),

  // Overview Tab
  paperTitle: document.getElementById('paper-title') as HTMLDivElement,
  paperAuthors: document.getElementById('paper-authors') as HTMLDivElement,
  btnRefreshPaper: document.getElementById('btn-refresh-paper') as HTMLButtonElement,
  manualPaperDetails: document.getElementById('manual-paper-details') as HTMLDetailsElement,
  inputManualTitle: document.getElementById('input-manual-title') as HTMLInputElement,
  inputManualAbstract: document.getElementById('input-manual-abstract') as HTMLTextAreaElement,
  btnApplyManualPaper: document.getElementById('btn-apply-manual-paper') as HTMLButtonElement,
  btnTldr: document.getElementById('btn-tldr') as HTMLButtonElement,
  btnCritique: document.getElementById('btn-critique') as HTMLButtonElement,
  overviewOutput: document.getElementById('overview-output') as HTMLDivElement,
  overviewReasoning: document.getElementById('overview-reasoning') as HTMLDetailsElement,
  overviewReasoningSummary: document.getElementById('overview-reasoning-summary') as HTMLElement,
  overviewReasoningBody: document.getElementById('overview-reasoning-body') as HTMLDivElement,
  btnCopyOverview: document.getElementById('btn-copy-overview') as HTMLButtonElement,
  btnResetOverview: document.getElementById('btn-reset-overview') as HTMLButtonElement,
  inputOverviewFollowup: document.getElementById('input-overview-followup') as HTMLInputElement,
  btnOverviewFollowup: document.getElementById('btn-overview-followup') as HTMLButtonElement,

  // Selection Tab
  selectionPreview: document.getElementById('selected-text-preview') as HTMLTextAreaElement,
  btnExplainFormula: document.getElementById('btn-explain-formula') as HTMLButtonElement,
  btnExplainPlain: document.getElementById('btn-explain-plain') as HTMLButtonElement,
  selectionOutput: document.getElementById('selection-output') as HTMLDivElement,
  selectionReasoning: document.getElementById('selection-reasoning') as HTMLDetailsElement,
  selectionReasoningSummary: document.getElementById('selection-reasoning-summary') as HTMLElement,
  selectionReasoningBody: document.getElementById('selection-reasoning-body') as HTMLDivElement,
  btnCopySelection: document.getElementById('btn-copy-selection') as HTMLButtonElement,
  btnResetSelection: document.getElementById('btn-reset-selection') as HTMLButtonElement,
  inputSelectionFollowup: document.getElementById('input-selection-followup') as HTMLInputElement,
  btnSelectionFollowup: document.getElementById('btn-selection-followup') as HTMLButtonElement,

  // Settings Tab
  selectProvider: document.getElementById('select-provider') as HTMLSelectElement,
  labelApiKey: document.getElementById('label-api-key') as HTMLLabelElement,
  inputApiKey: document.getElementById('input-api-key') as HTMLInputElement,
  btnToggleApiKey: document.getElementById('btn-toggle-api-key') as HTMLButtonElement,
  inputBaseUrl: document.getElementById('input-base-url') as HTMLInputElement,
  inputModel: document.getElementById('input-model') as HTMLInputElement,
  modelSuggestions: document.getElementById('model-suggestions') as HTMLDataListElement,
  selectCapsuleEnabled: document.getElementById('select-capsule-enabled') as HTMLSelectElement,
  selectTheme: document.getElementById('select-theme') as HTMLSelectElement,
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
  await hydrateFromSessionStorage();
  void refreshModelSuggestions(currentConfig.provider, currentConfig.baseUrl);
}

function populateQuickModelOptions(
  provider: ProviderType,
  discovered?: Array<{ id: string; label?: string }>
) {
  if (!elements.quickModelSelect) return;
  const currentKey = `${provider}:${elements.inputBaseUrl.value.trim() || PROVIDER_DEFAULTS[provider]?.baseUrl || ''}`;
  const modelList = discovered ?? (cachedModelsKey === currentKey ? cachedDiscoveredModels : []);
  const seen = new Set<string>();
  const candidates: Array<{ id: string; label: string }> = [];
  const activeModel = elements.inputModel.value.trim() || currentConfig?.model || '';

  const pushOption = (id: string, label?: string) => {
    const cleanId = id.trim();
    if (!cleanId || seen.has(cleanId)) return;
    seen.add(cleanId);
    candidates.push({ id: cleanId, label: label?.trim() || cleanId });
  };

  for (const item of modelList) {
    pushOption(item.id, item.label);
  }
  for (const preset of PROVIDER_PRESET_MODELS[provider] || []) {
    pushOption(preset.id, preset.label);
  }
  if (activeModel) {
    pushOption(activeModel, activeModel);
  }

  elements.quickModelSelect.innerHTML = '';
  for (const candidate of candidates) {
    const opt = document.createElement('option');
    opt.value = candidate.id;
    opt.textContent = candidate.label;
    elements.quickModelSelect.appendChild(opt);
  }
  if (activeModel && seen.has(activeModel)) {
    elements.quickModelSelect.value = activeModel;
  }
}

// 从本地 Magpie 网关动态拉取可用模型列表用于输入框自动补全与顶部快速切换
async function refreshModelSuggestions(provider: ProviderType, baseUrl: string) {
  if (elements.modelSuggestions) {
    elements.modelSuggestions.innerHTML = '';
  }
  populateQuickModelOptions(provider);
  if (provider !== 'magpie') return;

  try {
    const normalized = baseUrl.replace(/\/+$/, '');
    const modelsUrl = normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;
    const res = await fetch(modelsUrl);
    if (!res.ok) return;
    const json = await res.json();
    const models = Array.isArray(json?.data) ? json.data : [];
    const discovered: Array<{ id: string; label?: string }> = [];
    for (const item of models) {
      if (typeof item?.id === 'string') {
        discovered.push({ id: item.id, label: item.display_name || item.id });
        if (elements.modelSuggestions) {
          const opt = document.createElement('option');
          opt.value = item.id;
          if (item.display_name) opt.label = item.display_name;
          elements.modelSuggestions.appendChild(opt);
        }
      }
    }
    cachedModelsKey = `${provider}:${baseUrl.trim()}`;
    cachedDiscoveredModels = discovered;
    populateQuickModelOptions(provider, discovered);
  } catch {
    // 网关未启动时静默降级，仍保留预设与手动输入模型名
  }
}

// 同步冷启动前捕获的论文元数据与划词内容
async function hydrateFromSessionStorage() {
  if (!chrome.storage.session) return;
  const session = await chrome.storage.session.get(['paperByTab', 'latestPaperData', 'latestSelection']);

  let initialPaper: typeof currentPaperData | null = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id && !activeTab.url?.startsWith('chrome-extension://')) {
      const byTab = (session.paperByTab as Record<string, typeof currentPaperData>) || {};
      initialPaper = byTab[String(activeTab.id)] || null;
      if (!initialPaper) {
        const resp = await chrome.tabs
          .sendMessage(activeTab.id, { action: 'EXTRACT_PAPER_METADATA_REQUEST' })
          .catch(() => null);
        if (resp?.paper) {
          initialPaper = resp.paper;
        }
      }
    } else if (session.latestPaperData) {
      initialPaper = session.latestPaperData;
    }
  } catch {
    initialPaper = session.latestPaperData || null;
  }

  applyPaperMetadata(initialPaper);

  if (session.latestSelection?.selectedText) {
    applyCapturedSelection(
      session.latestSelection.selectedText,
      Boolean(session.latestSelection.pendingExplain)
    );
    if (session.latestSelection.pendingExplain) {
      await chrome.storage.session.set({
        latestSelection: { ...session.latestSelection, pendingExplain: false },
      });
    }
  }
}

function applyPaperMetadata(payload: typeof currentPaperData | null) {
  if (!payload || (!payload.title?.trim() && !payload.abstract?.trim())) {
    currentPaperData = { ...EMPTY_PAPER_DATA };
    elements.paperTitle.textContent = DEFAULT_PAPER_PLACEHOLDER;
    elements.paperAuthors.textContent = '';
    return;
  }
  currentPaperData = payload;
  elements.paperTitle.textContent = currentPaperData.title || '已捕获学术页面';
  const authors = currentPaperData.authors?.slice(0, 3).join(', ');
  elements.paperAuthors.textContent = authors ? `${authors} 等` : '';
}

function applyCapturedSelection(selectedText: string, autoExplain: boolean) {
  currentSelection = selectedText;
  elements.selectionPreview.value = currentSelection;
  elements.selectionPreview.textContent = currentSelection;

  // 自动切换到划词 Tab
  elements.tabButtons.forEach((b) => b.classList.remove('active'));
  elements.tabPanes.forEach((p) => p.classList.remove('active'));
  const selectionTabBtn = document.querySelector<HTMLButtonElement>('[data-tab="tab-selection"]');
  selectionTabBtn?.classList.add('active');
  document.getElementById('tab-selection')?.classList.add('active');

  if (autoExplain) {
    elements.btnExplainFormula.click();
  }
}

function updateApiKeyFieldHint(provider: ProviderType) {
  const isLocalGateway = provider === 'magpie' || provider === 'ollama';
  if (elements.labelApiKey) {
    elements.labelApiKey.textContent = isLocalGateway
      ? 'API Key (本地服务免填，保存在本地沙箱)'
      : 'API Key (保存在本地沙箱)';
  }
  elements.inputApiKey.placeholder = isLocalGateway
    ? '本地网关无需 API Key（可选）'
    : provider === 'anthropic'
      ? 'sk-ant-...'
      : 'sk-...';
}

const THEME_BUTTON_META: Record<ThemeMode, { icon: string; title: string }> = {
  system: { icon: '🌗', title: '主题：跟随系统（点击切换为深色）' },
  dark: { icon: '🌙', title: '主题：深色模式（点击切换为浅色）' },
  light: { icon: '☀️', title: '主题：浅色模式（点击切换为跟随系统）' },
};

function applyThemeMode(theme: ThemeMode = 'system') {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  if (elements.btnToggleTheme) {
    const meta = THEME_BUTTON_META[theme] || THEME_BUTTON_META.system;
    elements.btnToggleTheme.textContent = meta.icon;
    elements.btnToggleTheme.title = meta.title;
  }
}

function readSettingsFormDraft(): Partial<UserConfig> {
  return {
    provider: elements.selectProvider.value as ProviderType,
    apiKey: elements.inputApiKey.value.trim(),
    baseUrl: elements.inputBaseUrl.value.trim(),
    model: elements.inputModel.value.trim(),
    capsuleEnabled: elements.selectCapsuleEnabled.value !== 'false',
    theme: (elements.selectTheme.value as ThemeMode) || 'system',
  };
}

function hasUnsavedSettingsChanges(): boolean {
  if (!currentConfig) return false;
  const draft = readSettingsFormDraft();
  return (
    draft.provider !== currentConfig.provider ||
    draft.apiKey !== currentConfig.apiKey ||
    draft.baseUrl !== currentConfig.baseUrl ||
    draft.model !== currentConfig.model ||
    draft.capsuleEnabled !== (currentConfig.capsuleEnabled ?? true) ||
    draft.theme !== (currentConfig.theme ?? 'system')
  );
}

function syncSettingsDirtyState() {
  const dirty = hasUnsavedSettingsChanges();
  elements.btnSaveSettings.classList.toggle('is-dirty', dirty);
  elements.btnSaveSettings.textContent = dirty ? '保存配置 *' : '保存配置';

  if (dirty) {
    elements.settingsStatus.dataset.dirty = 'true';
    showStatus('⚠️ 有未保存修改：测试连通性将使用当前表单值，业务推理需先点击「保存配置」。', 'warning', true);
  } else if (elements.settingsStatus.dataset.dirty === 'true') {
    delete elements.settingsStatus.dataset.dirty;
    elements.settingsStatus.style.display = 'none';
    elements.settingsStatus.textContent = '';
  }
}

// 同步配置到 UI
function updateUIFromConfig() {
  elements.providerBadge.textContent = currentConfig.provider;
  elements.selectProvider.value = currentConfig.provider;
  elements.inputApiKey.value = currentConfig.apiKey;
  elements.inputBaseUrl.value = currentConfig.baseUrl;
  elements.inputModel.value = currentConfig.model;
  elements.selectCapsuleEnabled.value = String(currentConfig.capsuleEnabled ?? true);
  const activeTheme = currentConfig.theme ?? 'system';
  elements.selectTheme.value = activeTheme;
  applyThemeMode(activeTheme);
  updateApiKeyFieldHint(currentConfig.provider);
  populateQuickModelOptions(currentConfig.provider);
  syncSettingsDirtyState();
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

  // 顶部快速切换模型并立即持久化
  elements.quickModelSelect.addEventListener('change', async () => {
    const nextModel = elements.quickModelSelect.value.trim();
    if (!nextModel) return;
    elements.inputModel.value = nextModel;
    await saveStoredConfig({ model: nextModel });
    currentConfig = await getStoredConfig();
    syncSettingsDirtyState();
  });

  // 顶部快捷切换主题（跟随系统 -> 深色 -> 浅色）并立即持久化
  elements.btnToggleTheme.addEventListener('click', async () => {
    const current = (currentConfig?.theme ?? 'system') as ThemeMode;
    const nextTheme: ThemeMode = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
    applyThemeMode(nextTheme);
    elements.selectTheme.value = nextTheme;
    await saveStoredConfig({ theme: nextTheme });
    currentConfig = await getStoredConfig();
    syncSettingsDirtyState();
  });

  // API Key 显隐切换
  elements.btnToggleApiKey.addEventListener('click', () => {
    const reveal = elements.inputApiKey.type === 'password';
    elements.inputApiKey.type = reveal ? 'text' : 'password';
    elements.btnToggleApiKey.textContent = reveal ? '🙈' : '👁';
    elements.btnToggleApiKey.setAttribute('aria-pressed', String(reveal));
  });

  // 切换 Provider 时自动补全推荐 BaseURL 与 Model
  elements.selectProvider.addEventListener('change', () => {
    const provider = elements.selectProvider.value as ProviderType;
    const defaults = PROVIDER_DEFAULTS[provider];
    updateApiKeyFieldHint(provider);
    if (defaults) {
      elements.inputBaseUrl.value = defaults.baseUrl;
      elements.inputModel.value = defaults.model;
      void refreshModelSuggestions(provider, defaults.baseUrl);
    }
    syncSettingsDirtyState();
  });

  elements.selectTheme.addEventListener('change', () => {
    applyThemeMode((elements.selectTheme.value as ThemeMode) || 'system');
    syncSettingsDirtyState();
  });

  const dirtyWatchInputs = [
    elements.inputApiKey,
    elements.inputBaseUrl,
    elements.inputModel,
    elements.selectCapsuleEnabled,
  ];
  for (const inputEl of dirtyWatchInputs) {
    inputEl.addEventListener('input', syncSettingsDirtyState);
    inputEl.addEventListener('change', syncSettingsDirtyState);
  }

  // 保存配置
  elements.btnSaveSettings.addEventListener('click', async () => {
    const updated = readSettingsFormDraft();
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
          onFinish: () => {
            const suffix = hasUnsavedSettingsChanges()
              ? '（注意：当前有未保存修改，需点击「保存配置」才会应用于业务推理）'
              : '';
            showStatus(`✅ 连通性测试通过！API 状态正常。${suffix}`, 'success');
          },
        }
      );
    } catch (e: any) {
      showStatus(`测试异常: ${e.message}`, 'error');
    }
  });

  // 重新识别当前标签页论文元数据
  elements.btnRefreshPaper.addEventListener('click', async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return;
      const resp = await chrome.tabs.sendMessage(activeTab.id, {
        action: 'EXTRACT_PAPER_METADATA_REQUEST',
      });
      if (resp?.paper) {
        applyPaperMetadata(resp.paper);
        if (chrome.storage.session) {
          const existing = await chrome.storage.session.get(['paperByTab']);
          const paperByTab = (existing.paperByTab as Record<string, typeof currentPaperData>) || {};
          paperByTab[String(activeTab.id)] = resp.paper;
          await chrome.storage.session.set({ paperByTab, latestPaperData: resp.paper });
        }
      } else {
        elements.overviewOutput.innerHTML =
          '<span style="color:#b45309;">⚠️ 当前页面未识别到学术论文元数据，可展开上方「手动粘贴论文标题/摘要」自行载入。</span>';
      }
    } catch {
      elements.overviewOutput.innerHTML =
        '<span style="color:#b45309;">⚠️ 当前页面暂不支持自动抓取（如 Chrome 内嵌 PDF），可展开上方「手动粘贴论文标题/摘要」载入。</span>';
    }
  });

  // 手动载入论文标题/摘要
  elements.btnApplyManualPaper.addEventListener('click', () => {
    const title = elements.inputManualTitle.value.trim();
    const abstract = elements.inputManualAbstract.value.trim();
    if (!title && !abstract) {
      elements.overviewOutput.innerHTML =
        '<span style="color:#dc2626;">⚠️ 请至少填写论文标题或摘要内容。</span>';
      return;
    }
    const payload = {
      title: title || '手动输入论文',
      abstract,
      authors: [] as string[],
      url: '',
    };
    applyPaperMetadata(payload);
    chrome.storage.session?.set({ latestPaperData: payload }).catch(() => {});
    elements.manualPaperDetails.open = false;
    elements.overviewOutput.textContent = '已载入手动输入的论文内容，可点击上方按钮开始分析。';
  });

  function hasPaperContext(): boolean {
    return Boolean(currentPaperData.title.trim() || currentPaperData.abstract.trim());
  }

  // 划词文本区支持直接编辑/粘贴
  elements.selectionPreview.addEventListener('input', () => {
    currentSelection = elements.selectionPreview.value.trim();
  });

  function getSelectionText(): string {
    const val = elements.selectionPreview.value.trim();
    if (val) {
      currentSelection = val;
      return val;
    }
    return currentSelection.trim();
  }

  function startTabConversation(
    tab: 'overview' | 'selection',
    messages: ChatMessage[],
    targetEl: HTMLElement
  ) {
    chatSessions[tab] = {
      history: [...messages],
      renderedTranscript: '',
    };
    runInference(tab, targetEl, '');
  }

  function runPaperAnalysis(systemPrompt: string, instructionPrefix: string) {
    if (!hasPaperContext()) {
      delete elements.overviewOutput.dataset.rawText;
      elements.overviewOutput.innerHTML =
        '<span style="color:#dc2626;">⚠️ 当前未检测到论文标题或摘要。请先打开 arXiv / bioRxiv / PubMed 论文页（或点击「重新识别」/「手动粘贴论文标题/摘要」）。</span>';
      return;
    }
    const prompt = `${instructionPrefix}\n\n标题: ${currentPaperData.title}\n摘要: ${currentPaperData.abstract}`;
    startTabConversation(
      'overview',
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      elements.overviewOutput
    );
  }

  // 一键速读
  elements.btnTldr.addEventListener('click', () => {
    runPaperAnalysis(ACADEMIC_PROMPTS.summary, '请对以下论文进行 4 维核心解析：');
  });

  // 审稿人盲评
  elements.btnCritique.addEventListener('click', () => {
    runPaperAnalysis(ACADEMIC_PROMPTS.critique, '请针对以下论文进行严苛审稿人盲评：');
  });

  // 公式直觉解读
  elements.btnExplainFormula.addEventListener('click', () => {
    const text = getSelectionText();
    if (!text) {
      elements.selectionOutput.textContent = '请先在论文页面中划选一段公式或数学推导，或直接在上方文本框输入。';
      return;
    }
    startTabConversation(
      'selection',
      [
        { role: 'system', content: ACADEMIC_PROMPTS.intuition },
        { role: 'user', content: `请用直觉与生活化类比解读以下数学公式/算法：\n\n${text}` },
      ],
      elements.selectionOutput
    );
  });

  // 通俗解读
  elements.btnExplainPlain.addEventListener('click', () => {
    const text = getSelectionText();
    if (!text) {
      elements.selectionOutput.textContent = '请先在论文页面中划选一段文字，或直接在上方文本框输入。';
      return;
    }
    startTabConversation(
      'selection',
      [
        { role: 'system', content: '你是一位精通化繁为简的学术导师，请用大白话彻底讲透输入的这段学术文本。' },
        { role: 'user', content: text },
      ],
      elements.selectionOutput
    );
  });

  // 多轮追问绑定
  function bindFollowup(
    tab: 'overview' | 'selection',
    inputEl: HTMLInputElement,
    sendBtn: HTMLButtonElement,
    outputEl: HTMLElement
  ) {
    const submitFollowup = () => {
      const question = inputEl.value.trim();
      if (!question) return;

      const session = chatSessions[tab];
      if (session.history.length === 0) {
        if (tab === 'overview') {
          if (!hasPaperContext()) {
            outputEl.innerHTML =
              '<span style="color:#dc2626;">⚠️ 请先载入论文或输入摘要后再进行追问。</span>';
            return;
          }
          session.history.push(
            { role: 'system', content: ACADEMIC_PROMPTS.summary },
            {
              role: 'user',
              content: `当前论文参考：\n标题: ${currentPaperData.title}\n摘要: ${currentPaperData.abstract}`,
            }
          );
        } else {
          const selText = getSelectionText();
          if (!selText) {
            outputEl.innerHTML =
              '<span style="color:#dc2626;">⚠️ 请先划选或在上方文本框输入内容后再进行追问。</span>';
            return;
          }
          session.history.push(
            { role: 'system', content: ACADEMIC_PROMPTS.intuition },
            { role: 'user', content: `参考内容：\n${selText}` }
          );
        }
      }

      session.history.push({ role: 'user', content: question });
      inputEl.value = '';
      const prefix = session.renderedTranscript
        ? `${session.renderedTranscript}\n\n---\n\n**追问：** ${question}\n\n`
        : `**追问：** ${question}\n\n`;
      runInference(tab, outputEl, prefix);
    };

    sendBtn.addEventListener('click', submitFollowup);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitFollowup();
      }
    });
  }

  bindFollowup(
    'overview',
    elements.inputOverviewFollowup,
    elements.btnOverviewFollowup,
    elements.overviewOutput
  );
  bindFollowup(
    'selection',
    elements.inputSelectionFollowup,
    elements.btnSelectionFollowup,
    elements.selectionOutput
  );

  // 主动停止流式生成
  elements.btnStopInference.addEventListener('click', () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    stopInferenceStatus();
  });

  // 重置会话绑定
  function bindResetButton(
    tab: 'overview' | 'selection',
    btn: HTMLButtonElement,
    outputEl: HTMLElement,
    reasoningEl: HTMLDetailsElement,
    placeholder: string
  ) {
    btn.addEventListener('click', () => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      stopInferenceStatus();
      chatSessions[tab] = { history: [], renderedTranscript: '' };
      delete outputEl.dataset.rawText;
      outputEl.textContent = placeholder;
      reasoningEl.hidden = true;
      reasoningEl.open = false;
    });
  }

  bindResetButton(
    'overview',
    elements.btnResetOverview,
    elements.overviewOutput,
    elements.overviewReasoning,
    '点击上方按钮，基于当前论文自动进行专业研读分析...'
  );
  bindResetButton(
    'selection',
    elements.btnResetSelection,
    elements.selectionOutput,
    elements.selectionReasoning,
    '等待生成直觉解读...'
  );

  // 复制功能（优先导出原始 Markdown/LaTeX 文本）
  const bindCopyButton = (btn: HTMLButtonElement, outputEl: HTMLElement) => {
    btn.addEventListener('click', async () => {
      const textToCopy = outputEl.dataset.rawText || outputEl.innerText;
      await navigator.clipboard.writeText(textToCopy);
      btn.textContent = '已复制!';
      setTimeout(() => (btn.textContent = '复制'), 1500);
    });
  };
  bindCopyButton(elements.btnCopyOverview, elements.overviewOutput);
  bindCopyButton(elements.btnCopySelection, elements.selectionOutput);
}

function getReasoningElements(tab: 'overview' | 'selection') {
  return tab === 'overview'
    ? {
        details: elements.overviewReasoning,
        summary: elements.overviewReasoningSummary,
        body: elements.overviewReasoningBody,
      }
    : {
        details: elements.selectionReasoning,
        summary: elements.selectionReasoningSummary,
        body: elements.selectionReasoningBody,
      };
}

function startInferenceStatus() {
  stopInferenceStatus();
  inferenceStartMs = Date.now();
  elements.inferenceStatusBar.hidden = false;
  elements.inferenceStatusText.textContent = '⏳ 正在推理中（0.0s）...';
  elapsedTimerId = window.setInterval(() => {
    const sec = ((Date.now() - inferenceStartMs) / 1000).toFixed(1);
    elements.inferenceStatusText.textContent = `⏳ 正在推理中（${sec}s）...`;
  }, 100);
}

function stopInferenceStatus(): string {
  if (elapsedTimerId !== null) {
    clearInterval(elapsedTimerId);
    elapsedTimerId = null;
  }
  elements.inferenceStatusBar.hidden = true;
  return inferenceStartMs ? ((Date.now() - inferenceStartMs) / 1000).toFixed(1) : '0.0';
}

// 统一流式推理调度
function runInference(tab: 'overview' | 'selection', targetEl: HTMLElement, transcriptPrefix: string) {
  if (!currentConfig.apiKey && currentConfig.provider !== 'ollama' && currentConfig.provider !== 'magpie') {
    delete targetEl.dataset.rawText;
    targetEl.innerHTML = `<span style="color:#dc2626;">⚠️ 请先切换到【设置】标签页配置你的 API Key。</span>`;
    return;
  }

  if (activeAbortController) {
    activeAbortController.abort();
  }
  const controller = new AbortController();
  activeAbortController = controller;
  startInferenceStatus();

  const reasoningUI = getReasoningElements(tab);
  reasoningUI.details.hidden = true;
  reasoningUI.details.open = false;
  reasoningUI.body.textContent = '';
  let reasoningAccumulated = '';

  const session = chatSessions[tab];
  if (transcriptPrefix) {
    renderMarkdownInto(targetEl, `${transcriptPrefix}思考中...`);
  } else {
    delete targetEl.dataset.rawText;
    targetEl.textContent = '思考中...';
  }
  let accumulated = '';

  streamAIChat(
    session.history,
    currentConfig,
    {
      onReasoningChunk: (delta) => {
        reasoningAccumulated += delta;
        reasoningUI.details.hidden = false;
        reasoningUI.details.open = true;
        reasoningUI.summary.textContent = '💭 思考过程（推理中...）';
        reasoningUI.body.textContent = reasoningAccumulated;
      },
      onChunk: (delta) => {
        accumulated += delta;
        renderMarkdownInto(targetEl, `${transcriptPrefix}${accumulated}`);
      },
      onAbort: (partial) => {
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        const elapsed = stopInferenceStatus();
        if (reasoningAccumulated) {
          reasoningUI.summary.textContent = `💭 思考过程（已中断，${elapsed}s）`;
        }
        if (partial) {
          renderMarkdownInto(targetEl, `${transcriptPrefix}${partial}\n\n*(已手动停止生成)*`);
        } else if (transcriptPrefix) {
          renderMarkdownInto(targetEl, `${transcriptPrefix}*(已手动停止生成)*`);
        } else {
          delete targetEl.dataset.rawText;
          targetEl.textContent = '已停止生成。';
        }
      },
      onError: (err) => {
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        stopInferenceStatus();
        delete targetEl.dataset.rawText;
        targetEl.innerHTML = `<span style="color:#dc2626;">调用出错: ${err.message}</span>`;
      },
      onFinish: (full) => {
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        const elapsed = stopInferenceStatus();
        if (reasoningAccumulated) {
          reasoningUI.summary.textContent = `💭 思考过程（耗时 ${elapsed}s）`;
          reasoningUI.details.open = false;
        }
        const finalTranscript = `${transcriptPrefix}${full}`;
        session.renderedTranscript = finalTranscript;
        session.history.push({ role: 'assistant', content: full });
        renderMarkdownInto(targetEl, finalTranscript);
      },
    },
    controller.signal
  );
}

// 监听扩展内部消息
function listenToRuntimeMessages() {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.action === 'ACTIVE_TAB_PAPER_CHANGED') {
      applyPaperMetadata(message.payload?.paper ?? null);
    } else if (message.action === 'PAPER_METADATA_EXTRACTED') {
      if (!sender.tab || sender.tab.active) {
        applyPaperMetadata(message.payload);
      }
    } else if (message.action === 'SELECTION_TEXT_CAPTURED') {
      applyCapturedSelection(message.payload.selectedText, true);
      chrome.storage.session?.set({
        latestSelection: { ...message.payload, pendingExplain: false },
      }).catch(() => {});
    }
  });
}

function showStatus(
  msg: string,
  type: 'success' | 'error' | 'info' | 'warning',
  preserveDirtyFlag = false
) {
  if (!preserveDirtyFlag) {
    delete elements.settingsStatus.dataset.dirty;
  }
  elements.settingsStatus.textContent = msg;
  elements.settingsStatus.className = `status-msg is-${type}`;
  elements.settingsStatus.style.display = 'block';
}

init();
