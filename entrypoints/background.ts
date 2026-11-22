import { defineBackground } from 'wxt/sandbox';
import type { PaperMetadata } from '../src/utils/paper-extractor';

type PaperByTabMap = Record<string, PaperMetadata>;

async function getPaperByTab(): Promise<PaperByTabMap> {
  if (!chrome.storage.session) return {};
  const data = await chrome.storage.session.get(['paperByTab']);
  return (data.paperByTab as PaperByTabMap) || {};
}

async function setTabPaper(tabId: number, paper: PaperMetadata | null): Promise<void> {
  if (!chrome.storage.session) return;
  const paperByTab = await getPaperByTab();
  const key = String(tabId);
  if (paper) {
    paperByTab[key] = paper;
    await chrome.storage.session.set({ paperByTab, latestPaperData: paper });
  } else {
    delete paperByTab[key];
    await chrome.storage.session.set({ paperByTab });
  }
}

function notifySidePanelPaper(tabId: number, paper: PaperMetadata | null): void {
  chrome.runtime
    .sendMessage({
      action: 'ACTIVE_TAB_PAPER_CHANGED',
      payload: { tabId, paper },
    })
    .catch(() => {});
}

async function resolveTabPaper(tabId: number): Promise<PaperMetadata | null> {
  const paperByTab = await getPaperByTab();
  const cached = paperByTab[String(tabId)];
  if (cached) return cached;

  try {
    const resp = await chrome.tabs.sendMessage(tabId, {
      action: 'EXTRACT_PAPER_METADATA_REQUEST',
    });
    if (resp?.paper) {
      await setTabPaper(tabId, resp.paper as PaperMetadata);
      return resp.paper as PaperMetadata;
    }
  } catch {
    // 非内容脚本页面（如 chrome:// 或 PDF 查看器）忽略错误
  }
  return null;
}

export default defineBackground(() => {
  console.log('[PaperPilot] Background Service Worker initialized.');

  // 设置点击扩展图标时默认直接打开 Side Panel (Chrome 116+)
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error('[PaperPilot] Failed to set sidePanel behavior:', error));
  }

  // 切换标签页时按 tabId 同步论文上下文到 Side Panel
  chrome.tabs?.onActivated?.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab.url?.startsWith('chrome-extension://')) return;
      const paper = await resolveTabPaper(activeInfo.tabId);
      notifySidePanelPaper(activeInfo.tabId, paper);
    } catch {
      // 标签页已关闭等瞬态情况忽略
    }
  });

  // 同标签页导航至新 URL 时清理旧缓存并同步通知
  chrome.tabs?.onUpdated?.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url || tab.url?.startsWith('chrome-extension://')) return;
    await setTabPaper(tabId, null);
    if (tab.active) {
      notifySidePanelPaper(tabId, null);
    }
  });

  // 关闭标签页时释放缓存
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    void setTabPaper(tabId, null);
  });

  // 监听来自 Content Script 的划词或快速唤起请求
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PAPER_METADATA_EXTRACTED' && message.payload) {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        void setTabPaper(tabId, message.payload as PaperMetadata);
        if (sender.tab?.active) {
          notifySidePanelPaper(tabId, message.payload as PaperMetadata);
        }
      } else {
        chrome.storage.session
          ?.set({ latestPaperData: message.payload })
          .catch((err) => console.error('[PaperPilot] Failed to cache paper metadata:', err));
      }
    } else if (message.action === 'SELECTION_TEXT_CAPTURED' && message.payload) {
      chrome.storage.session
        ?.set({ latestSelection: { ...message.payload, pendingExplain: true } })
        .catch((err) => console.error('[PaperPilot] Failed to cache selection:', err));
    } else if (message.action === 'OPEN_SIDEPANEL_REQUEST') {
      if (sender.tab && sender.tab.id && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel
          .open({ tabId: sender.tab.id })
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // 保持异步消息通道
      }
    }
  });
});
