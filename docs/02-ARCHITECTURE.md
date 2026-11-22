# 🏗️ 02-系统架构设计说明书 (Architecture Design)

> **文档状态**：已批准 (Approved)  
> **技术标准**：Chrome Manifest V3  
> **核心框架**：WXT (Next-gen Web Extension Framework) + TypeScript + TailwindCSS

---

## 1. 系统全景架构图

```mermaid
flowchart TD
    subgraph Browser Context ["用户浏览器宿主环境"]
        subgraph WebPage ["学术论文页面 (arXiv / PDF Viewer)"]
            CS["Content Script<br>(DOM 解析 / 划词监听)"]
            Capsule["悬浮操作胶囊<br>(Shadow DOM 隔离)"]
        end

        subgraph BackgroundWorker ["MV3 Service Worker"]
            BG["background.ts<br>(扩展生命周期 / 图标事件)"]
        end

        subgraph ChromeSidePanel ["Chrome 原生侧边栏 (Side Panel)"]
            UI["Side Panel 视图 (Vue / React / HTML)"]
            StateMgr["状态中心 (Active Tab 绑定)"]
            AIService["BYOK AI 统一适配器<br>(SSE 流式处理)"]
            Storage["本地安全存储<br>(chrome.storage.local)"]
        end
    end

    subgraph ExternalAI ["AI 提供商 (纯前端本地直连)"]
        DeepSeek["DeepSeek API<br>(数学/性价比)"]
        OpenAI["OpenAI API<br>(GPT-4o)"]
        Claude["Anthropic API<br>(Claude 3.5 Sonnet)"]
        Ollama["本地 Ollama 服务<br>(http://localhost:11434)"]
    end

    %% 交互链路
    CS -->|"划词选中文本 / 公式"| Capsule
    Capsule -->|"chrome.runtime.sendMessage"| UI
    BG -->|"chrome.sidePanel.open"| ChromeSidePanel
    UI -->|"读取 API Key / 配置"| Storage
    UI --> StateMgr
    StateMgr --> AIService
    AIService -->|"直连 API (SSE 流式输出)"| DeepSeek
    AIService -->|"直连 API (SSE 流式输出)"| OpenAI
    AIService -->|"直连 API (SSE 流式输出)"| Claude
    AIService -->|"本地局域网连接"| Ollama
```

---

## 2. 关键架构技术选型

### 2.1 为什么采用 WXT？
传统 Web 扩展开发面临以下工程痛点：
1. **Manifest V3 打包繁琐**：传统的 Webpack / Rollup 配置难以优雅处理 Service Worker 的单入口机制与 Side Panel 声明。
2. **样式污染**：注入页面的 Content Script CSS 经常与宿主页面冲突。
3. **多浏览器适配难度高**：
* **WXT 的解决方式**：
  * 基于 Vite 驱动，原生提供毫秒级 HMR（热模块重载）；
  * 开箱即用的 `entrypoints/` 约定式路由，自动生成严格符合 MV3 规范的 `manifest.json`；
  * 内置针对 Content Script 的 **Shadow DOM API**，实现完全沙箱化的样式隔离；
  * 支持一键构建 Chrome、Firefox、Edge 跨浏览器产物。

### 2.2 Chrome Side Panel API 原生集成
* 在 `manifest.json` 中声明：
  ```json
  "permissions": ["sidePanel", "storage", "activeTab"],
  "side_panel": {
    "default_path": "sidepanel/index.html"
  }
  ```
* **生命周期策略**：
  * 在 `background.ts` 中配置 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`，用户点击扩展图标时，直接呼出原生侧边栏，不再弹出任何浮动 Popup。

---

## 3. 跨上下文通信协议 (Message Passing Protocol)

为确保 Content Script、Background 与 Side Panel 之间的高内聚低耦合，采用标准化的 Action 消息总线：

```typescript
// 消息协议定义 (src/types/messages.ts)
export interface SelectionMessage {
  action: 'SELECTION_TEXT_CAPTURED';
  payload: {
    selectedText: string;
    pageTitle: string;
    pageUrl: string;
    isFormula: boolean;
  };
}

export interface PaperMetadataMessage {
  action: 'PAPER_METADATA_EXTRACTED';
  payload: {
    title: string;
    authors: string[];
    abstract: string;
    arxivId?: string;
    pdfUrl?: string;
  };
}
```

---

## 4. BYOK (Bring Your Own Key) 统一适配器设计模式

为实现 0 服务器开销并支持多个主流大模型，采用策略模式（Strategy Pattern）封装统一流式接口：

```typescript
// 核心接口规范
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onError: (error: Error) => void;
  onFinish: (fullText: string) => void;
}

export interface AIProvider {
  streamChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    options?: { model?: string; temperature?: number }
  ): Promise<void>;
}
```

### 安全模型说明
1. **本地存储隔离**：用户输入的 API Key 严格使用 `chrome.storage.local` 进行加密存储，不在任何代码或网络请求中上传至第三方服务器。
2. **直连免中转**：前端直接利用 `fetch` API 发送包含 `Authorization: Bearer <KEY>` 的 SSE 请求。
3. **CORS 跨域解决方案**：
   * 在 Manifest V3 中，Side Panel 运行在独立的扩展扩展源（`chrome-extension://<EXTENSION_ID>/`）下；
   * 通过在 `manifest.json` 中的 `host_permissions` 声明相应的 API 域名（如 `https://api.deepseek.com/*`, `https://api.openai.com/*`, `https://api.anthropic.com/*`），扩展拥有直接跨域发起请求的原生能力，**无需借助任何后端代理服务器**。
