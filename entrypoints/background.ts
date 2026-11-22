import { defineBackground } from 'wxt/sandbox';

export default defineBackground(() => {
  console.log('[PaperPilot] Background Service Worker initialized.');

  // 设置点击扩展图标时默认直接打开 Side Panel (Chrome 116+)
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error('[PaperPilot] Failed to set sidePanel behavior:', error));
  }

  // 监听来自 Content Script 的划词或快速唤起请求
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PAPER_METADATA_EXTRACTED' && message.payload) {
      chrome.storage.session
        ?.set({ latestPaperData: message.payload })
        .catch((err) => console.error('[PaperPilot] Failed to cache paper metadata:', err));
    } else if (message.action === 'SELECTION_TEXT_CAPTURED' && message.payload) {
      chrome.storage.session
        ?.set({ latestSelection: { ...message.payload, pendingExplain: true } })
        .catch((err) => console.error('[PaperPilot] Failed to cache selection:', err));
    } else if (message.action === 'OPEN_SIDEPANEL_REQUEST') {
      if (sender.tab && sender.tab.id && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ tabId: sender.tab.id })
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // 保持异步消息通道
      }
    }
  });
});
