import 'katex/dist/katex.min.css';
import { getStoredConfig, saveStoredConfig, PROVIDER_DEFAULTS, UserConfig, ProviderType } from '../../src/services/storage';
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
let currentPaperData = { ...EMPTY_PAPER_DATA };
let currentSelection = '';

interface TabChatSession {
  history: ChatMessage[];
  renderedTranscript: string;
}

const chatSessions: Record<'overview' | 'selection', TabChatSession> = {
  overview: { history: [], renderedTranscript: '' },
  selection: { history: [], renderedTranscript: '' },
};

// DOM 元素引用
const elements = {
  providerBadge: document.getElementById('provider-badge') as HTMLSpanElement,
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
  btnCopyOverview: document.getElementById('btn-copy-overview') as HTMLButtonElement,
  btnResetOverview: document.getElementById('btn-reset-overview') as HTMLButtonElement,
  inputOverviewFollowup: document.getElementById('input-overview-followup') as HTMLInputElement,
  btnOverviewFollowup: document.getElementById('btn-overview-followup') as HTMLButtonElement,

  // Selection Tab
  selectionPreview: document.getElementById('selected-text-preview') as HTMLTextAreaElement,
  btnExplainFormula: document.getElementById('btn-explain-formula') as HTMLButtonElement,
  btnExplainPlain: document.getElementById('btn-explain-plain') as HTMLButtonElement,
  selectionOutput: document.getElementById('selection-output') as HTMLDivElement,
  btnCopySelection: document.getElementById('btn-copy-selection') as HTMLButtonElement,
  btnResetSelection: document.getElementById('btn-reset-selection') as HTMLButtonElement,
  inputSelectionFollowup: document.getElementById('input-selection-followup') as HTMLInputElement,
  btnSelectionFollowup: document.getElementById('btn-selection-followup') as HTMLButtonElement,

  // Settings Tab
  selectProvider: document.getElementById('select-provider') as HTMLSelectElement,
  inputApiKey: document.getElementById('input-api-key') as HTMLInputElement,
  inputBaseUrl: document.getElementById('input-base-url') as HTMLInputElement,
  inputModel: document.getElementById('input-model') as HTMLInputElement,
  modelSuggestions: document.getElementById('model-suggestions') as HTMLDataListElement,
  selectCapsuleEnabled: document.getElementById('select-capsule-enabled') as HTMLSelectElement,
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

// 从本地 Magpie 网关动态拉取可用模型列表用于输入框自动补全
async function refreshModelSuggestions(provider: ProviderType, baseUrl: string) {
  if (!elements.modelSuggestions) return;
  elements.modelSuggestions.innerHTML = '';
  if (provider !== 'magpie') return;

  try {
    const normalized = baseUrl.replace(/\/+$/, '');
    const modelsUrl = normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;
    const res = await fetch(modelsUrl);
    if (!res.ok) return;
    const json = await res.json();
    const models = Array.isArray(json?.data) ? json.data : [];
    for (const item of models) {
      if (typeof item?.id === 'string') {
        const opt = document.createElement('option');
        opt.value = item.id;
        if (item.display_name) opt.label = item.display_name;
        elements.modelSuggestions.appendChild(opt);
      }
    }
  } catch {
    // 网关未启动时静默降级，仍允许手动输入模型名
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

// 同步配置到 UI
function updateUIFromConfig() {
  elements.providerBadge.textContent = currentConfig.provider;
  elements.selectProvider.value = currentConfig.provider;
  elements.inputApiKey.value = currentConfig.apiKey;
  elements.inputBaseUrl.value = currentConfig.baseUrl;
  elements.inputModel.value = currentConfig.model;
  elements.selectCapsuleEnabled.value = String(currentConfig.capsuleEnabled ?? true);
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
      void refreshModelSuggestions(provider, defaults.baseUrl);
    }
  });

  // 保存配置
  elements.btnSaveSettings.addEventListener('click', async () => {
    const updated: Partial<UserConfig> = {
      provider: elements.selectProvider.value as ProviderType,
      apiKey: elements.inputApiKey.value.trim(),
      baseUrl: elements.inputBaseUrl.value.trim(),
      model: elements.inputModel.value.trim(),
      capsuleEnabled: elements.selectCapsuleEnabled.value !== 'false',
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

  // 重置会话绑定
  function bindResetButton(
    tab: 'overview' | 'selection',
    btn: HTMLButtonElement,
    outputEl: HTMLElement,
    placeholder: string
  ) {
    btn.addEventListener('click', () => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      chatSessions[tab] = { history: [], renderedTranscript: '' };
      delete outputEl.dataset.rawText;
      outputEl.textContent = placeholder;
    });
  }

  bindResetButton(
    'overview',
    elements.btnResetOverview,
    elements.overviewOutput,
    '点击上方按钮，基于当前论文自动进行专业研读分析...'
  );
  bindResetButton(
    'selection',
    elements.btnResetSelection,
    elements.selectionOutput,
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
  activeAbortController = new AbortController();

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
      onChunk: (delta) => {
        accumulated += delta;
        renderMarkdownInto(targetEl, `${transcriptPrefix}${accumulated}`);
      },
      onError: (err) => {
        delete targetEl.dataset.rawText;
        targetEl.innerHTML = `<span style="color:#dc2626;">调用出错: ${err.message}</span>`;
      },
      onFinish: (full) => {
        const finalTranscript = `${transcriptPrefix}${full}`;
        session.renderedTranscript = finalTranscript;
        session.history.push({ role: 'assistant', content: full });
        renderMarkdownInto(targetEl, finalTranscript);
      },
    },
    activeAbortController.signal
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

function showStatus(msg: string, type: 'success' | 'error' | 'info') {
  elements.settingsStatus.textContent = msg;
  elements.settingsStatus.style.display = 'block';
  elements.settingsStatus.style.backgroundColor =
    type === 'success' ? '#dcfce7' : type === 'error' ? '#fee2e2' : '#f1f5f9';
  elements.settingsStatus.style.color =
    type === 'success' ? '#166534' : type === 'error' ? '#991b1b' : '#334155';
}

init();
