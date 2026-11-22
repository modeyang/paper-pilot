import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['*://arxiv.org/*', '*://*.biorxiv.org/*', '*://pubmed.ncbi.nlm.nih.gov/*', '<all_urls>'],
  main() {
    console.log('[PaperPilot] Academic Content Script injected.');

    let floatCapsule: HTMLDivElement | null = null;
    let selectedTextCache = '';

    // 创建隔离样式的悬浮操作胶囊
    function createCapsule(x: number, y: number, text: string) {
      removeCapsule();
      selectedTextCache = text;

      floatCapsule = document.createElement('div');
      floatCapsule.id = 'paper-pilot-capsule-root';
      floatCapsule.style.position = 'absolute';
      floatCapsule.style.left = `${x + 10}px`;
      floatCapsule.style.top = `${y - 35}px`;
      floatCapsule.style.zIndex = '2147483647';
      floatCapsule.style.cursor = 'pointer';

      // 使用 Shadow DOM 实现样式绝对隔离
      const shadow = floatCapsule.attachShadow({ mode: 'open' });
      const btn = document.createElement('button');
      btn.innerHTML = `
        <span style="display:flex;align-items:center;gap:6px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:12px;font-weight:600;color:#ffffff;background:#2563eb;padding:6px 12px;border-radius:20px;box-shadow:0 4px 12px rgba(37,99,235,0.3);border:none;outline:none;cursor:pointer;transition:all 0.15s ease;">
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
    }

    function removeCapsule() {
      if (floatCapsule) {
        floatCapsule.remove();
        floatCapsule = null;
      }
    }

    // 划词捕获监听
    document.addEventListener('mouseup', (e) => {
      // 避免点击胶囊自身时触发
      if (floatCapsule && floatCapsule.contains(e.target as Node)) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (text && text.length > 5) {
          const rect = selection?.getRangeAt(0).getBoundingClientRect();
          if (rect) {
            createCapsule(
              rect.right + window.scrollX,
              rect.top + window.scrollY,
              text
            );
          }
        } else {
          removeCapsule();
        }
      }, 20);
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

    // 自动探测并向侧边栏上报学术元数据 (针对 arXiv 详情页)
    if (window.location.hostname === 'arxiv.org' && window.location.pathname.startsWith('/abs/')) {
      const titleEl = document.querySelector('h1.title');
      const abstractEl = document.querySelector('blockquote.abstract');
      const authorsEls = document.querySelectorAll('.authors a');

      if (titleEl) {
        const title = titleEl.textContent?.replace(/^Title:\s*/, '').trim() || '';
        const abstract = abstractEl?.textContent?.replace(/^Abstract:\s*/, '').trim() || '';
        const authors = Array.from(authorsEls).map((a) => a.textContent?.trim() || '');

        chrome.runtime.sendMessage({
          action: 'PAPER_METADATA_EXTRACTED',
          payload: { title, abstract, authors, url: window.location.href },
        });
      }
    }
  },
});
