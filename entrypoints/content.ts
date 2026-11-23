import { defineContentScript } from 'wxt/sandbox';
import { extractPaperMetadata } from '../src/utils/paper-extractor';

const CAPSULE_MARGIN = 8;
const MATH_OR_CJK_RE = /[α-ωΑ-Ω∑∫∂∇√∞≈≠≤≥±×÷^_{}$\\=+\u4e00-\u9fff]/;

function shouldTriggerForSelection(text: string): boolean {
  if (text.length >= 4) return true;
  if (text.length >= 2 && MATH_OR_CJK_RE.test(text)) return true;
  return false;
}

export default defineContentScript({
  matches: [
    '*://arxiv.org/*',
    '*://*.biorxiv.org/*',
    '*://*.medrxiv.org/*',
    '*://pubmed.ncbi.nlm.nih.gov/*',
    '*://ieeexplore.ieee.org/*',
    '*://aclanthology.org/*',
    '*://openreview.net/*',
    '*://scholar.google.com/*',
    '*://*.semanticscholar.org/*',
    '*://*.nature.com/*',
    '*://*.science.org/*',
    '*://proceedings.neurips.cc/*',
    '*://proceedings.mlr.press/*',
  ],
  main() {
    console.log('[PaperPilot] Academic Content Script injected.');

    let floatCapsule: HTMLDivElement | null = null;
    let selectedTextCache = '';
    let capsuleEnabled = true;

    chrome.storage?.local?.get(['paper_pilot_config'], (result) => {
      if (typeof result?.paper_pilot_config?.capsuleEnabled === 'boolean') {
        capsuleEnabled = result.paper_pilot_config.capsuleEnabled;
      }
    });

    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.paper_pilot_config?.newValue) {
        const nextVal = changes.paper_pilot_config.newValue.capsuleEnabled;
        if (typeof nextVal === 'boolean') {
          capsuleEnabled = nextVal;
          if (!capsuleEnabled) removeCapsule();
        }
      }
    });

    function clamp(val: number, min: number, max: number): number {
      return Math.min(Math.max(val, min), Math.max(min, max));
    }

    // 创建隔离样式的悬浮操作胶囊，并基于视口边界自适应定位/翻转
    function createCapsule(selectionRect: DOMRect, text: string) {
      removeCapsule();
      selectedTextCache = text;

      floatCapsule = document.createElement('div');
      floatCapsule.id = 'paper-pilot-capsule-root';
      floatCapsule.style.position = 'fixed';
      floatCapsule.style.left = '0px';
      floatCapsule.style.top = '0px';
      floatCapsule.style.zIndex = '2147483647';
      floatCapsule.style.cursor = 'pointer';

      // 使用 Shadow DOM 实现样式绝对隔离
      const shadow = floatCapsule.attachShadow({ mode: 'open' });
      const btn = document.createElement('button');
      btn.style.cssText = 'background:transparent;border:none;padding:0;margin:0;cursor:pointer;display:block;';
      btn.innerHTML = `
        <span style="display:flex;align-items:center;gap:6px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:12px;font-weight:600;color:#ffffff;background:#2563eb;padding:6px 12px;border-radius:20px;box-shadow:0 4px 12px rgba(37,99,235,0.3);border:none;outline:none;cursor:pointer;white-space:nowrap;transition:all 0.15s ease;">
          <span>🎓</span>
          <span>Ask PaperPilot</span>
        </span>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        sendSelectionToSidePanel(selectedTextCache);
        removeCapsule();
      });

      shadow.appendChild(btn);
      document.body.appendChild(floatCapsule);

      const capRect = floatCapsule.getBoundingClientRect();
      const capWidth = capRect.width || 140;
      const capHeight = capRect.height || 32;
      const maxLeft = window.innerWidth - capWidth - CAPSULE_MARGIN;
      const maxTop = window.innerHeight - capHeight - CAPSULE_MARGIN;

      // 水平优先放在选区右侧，若溢出则向左夹紧
      const preferredLeft = selectionRect.right + CAPSULE_MARGIN;
      const left = clamp(
        preferredLeft > maxLeft ? selectionRect.left : preferredLeft,
        CAPSULE_MARGIN,
        maxLeft
      );

      // 垂直优先放在选区上方，若顶部空间不足则翻转到选区下方
      const aboveTop = selectionRect.top - capHeight - CAPSULE_MARGIN;
      const belowTop = selectionRect.bottom + CAPSULE_MARGIN;
      const top = clamp(aboveTop < CAPSULE_MARGIN ? belowTop : aboveTop, CAPSULE_MARGIN, maxTop);

      floatCapsule.style.left = `${Math.round(left)}px`;
      floatCapsule.style.top = `${Math.round(top)}px`;
    }

    function removeCapsule() {
      if (floatCapsule) {
        floatCapsule.remove();
        floatCapsule = null;
      }
    }

    // 划词捕获监听
    document.addEventListener('mouseup', (e) => {
      if (!capsuleEnabled) return;
      if (floatCapsule && floatCapsule.contains(e.target as Node)) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (text && shouldTriggerForSelection(text) && selection && selection.rangeCount > 0) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          if (rect) {
            createCapsule(rect, text);
          }
        } else {
          removeCapsule();
        }
      }, 20);
    });

    // 支持 Alt+Shift+P 将当前选中内容一键送入侧边栏
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        const text = window.getSelection()?.toString().trim();
        if (text && text.length >= 2) {
          e.preventDefault();
          sendSelectionToSidePanel(text);
          removeCapsule();
        }
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (floatCapsule && !floatCapsule.contains(e.target as Node)) {
        removeCapsule();
      }
    });

    // 发送划选内容到 Side Panel
    function sendSelectionToSidePanel(text: string) {
      chrome.runtime.sendMessage({
        action: 'OPEN_SIDEPANEL_REQUEST',
      });

      chrome.runtime.sendMessage({
        action: 'SELECTION_TEXT_CAPTURED',
        payload: {
          selectedText: text,
          pageTitle: document.title,
          pageUrl: window.location.href,
        },
      });
    }

    // 自动探测并向侧边栏上报学术元数据 (arXiv abs/html/pdf, bioRxiv, PubMed 等)
    function reportPaperMetadata() {
      const metadata = extractPaperMetadata(document, new URL(window.location.href));
      if (metadata) {
        chrome.runtime.sendMessage({
          action: 'PAPER_METADATA_EXTRACTED',
          payload: metadata,
        });
      }
      return metadata;
    }

    reportPaperMetadata();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'EXTRACT_PAPER_METADATA_REQUEST') {
        const paper = reportPaperMetadata();
        sendResponse({ paper });
      }
    });
  },
});
