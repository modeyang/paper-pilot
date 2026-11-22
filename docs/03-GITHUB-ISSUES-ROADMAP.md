# 📋 03-GitHub Issue 任务看板与迭代规划 (Roadmap)

> **项目管理规范**：遵循 GitHub Projects (Kanban) 与标准化 Issue/PR 流程。  
> 每个 Issue 对应一个独立的 Git Feature 分支，合并需通过 CI 自动化构建检测。

---

## 🎯 里程碑全景规划 (Milestones)

```mermaid
flowchart LR
    M1["Milestone 1:<br>工程脚手架与 MV3 原生侧边栏"] --> M2["Milestone 2:<br>页面元数据与划词通信"]
    M2 --> M3["Milestone 3:<br>多模型 BYOK 适配与流式输出"]
    M3 --> M4["Milestone 4:<br>学术 Prompt 深度工程"]
    M4 --> M5["Milestone 5:<br>合规审核与商店正式发布"]
```

---

## 📌 详细 Issue 任务分解清单

### Milestone 1: 工程脚手架与 MV3 原生侧边栏 (Foundations)
- [x] **#1 [Chore] 初始化 WXT + TypeScript + TailwindCSS 开发环境**
  - **目标**：搭建工程基础，配置 `wxt.config.ts`、`tsconfig.json` 与自动化构建脚本。
  - **验收标准**：执行 `npm run dev` 能够正常生成 `.output/chrome-mv3`，并可在 Chrome 中加载解包扩展。
- [x] **#2 [Feature] 实现 Background Service Worker 与 Side Panel 图标联动**
  - **目标**：配置 `chrome.sidePanel.setPanelBehavior`，实现点击 Action 图标默认呼出右侧原生面板。
  - **验收标准**：点击浏览器右上角图标时，平滑展开原生 Side Panel，无报错弹窗。

---

### Milestone 2: 论文元数据提取与划词通信 (Content Ingestion)
- [ ] **#3 [Feature] 开发 Content Script 划词监听与悬浮胶囊 UI**
  - **目标**：在 arXiv 论文页面选中文本或公式后，在鼠标光标右上方展示优雅悬浮胶囊“Ask PaperPilot”。
  - **技术要点**：使用 Shadow DOM 挂载悬浮胶囊，保证不被页面原有的 CSS 样式污染或覆盖。
- [ ] **#4 [Feature] 实现跨上下文 Message Passing 通信机制**
  - **目标**：点击悬浮胶囊后，通过 `chrome.runtime.sendMessage` 将划选文本、页面标题、当前 URL 实时推送至 Side Panel。
  - **验收标准**：Side Panel 收到消息后自动切换至“Selection Explainer”标签页并填充文本。
- [ ] **#5 [Feature] arXiv 与通用学术页面元数据自动提取器**
  - **目标**：自动识别当前页面的论文标题、作者列表、摘要、arXiv ID 并展示在侧边栏顶部卡片中。

---

### Milestone 3: 多模型 BYOK 适配与流式输出 (AI Engine)
- [x] **#6 [Feature] 本地安全配置面板 (Settings Panel)**
  - **目标**：提供友好直观的 UI，允许用户配置 API Key、Base URL、Model Name，保存在 `chrome.storage.local`。
  - **验收标准**：包含密码输入框可见性切换、一键“测试连通性”反馈。
- [x] **#7 [Feature] 统一的多模型 SSE 流式请求客户端 (AI Service)**
  - **目标**：实现统一封装的 `streamChat` 函数，同时兼容 OpenAI 规范接口（含 DeepSeek、本地 Ollama）与 Anthropic 原生规范。
  - **验收标准**：支持打字机效果流式输出（Streaming），支持长推导中断取消（AbortController）。
- [ ] **#8 [Feature] Markdown 与 LaTeX 公式排版美化渲染**
  - **目标**：在侧边栏中集成 KaTeX 或 MathJax，对大模型输出的数学公式（如 `$\int f(x)dx$`）进行高清原生渲染。

---

### Milestone 4: 学术 Prompt 深度工程 (Academic Personas)
- [ ] **#9 [Feature] 公式白话直觉释疑系统提示词 (Intuition Prompt)**
  - **目标**：优化针对数学/算法公式的 Prompt，要求模型杜绝复读术语，必须以物理意义、几何直觉和通俗比喻剖析公式。
- [ ] **#10 [Feature] 一键“同行评审批判”模式 (Peer Review Critique)**
  - **目标**：提供预设按钮，要求模型从严苛顶会（NeurIPS/ICLR/CVPR）审稿人视角对论文的方法假设、消融充分性与复现可行性进行挑刺。

---

### Milestone 5: 合规审核与商店正式发布 (Publishing & Launch)
- [ ] **#11 [Docs] 编写完整的 Chrome Web Store 隐私权政策 (Privacy Policy)**
  - **目标**：单页部署 GitHub Pages，明确说明“无中心化数据搜集”、“API 凭证仅本地保存”。
- [ ] **#12 [Chore] 准备商店宣传图料与 1280x800 Promo 展台图**
  - **目标**：制作 16/48/128 像素高清 Icon，以及符合 Google 商店展示规范的截图。
- [ ] **#13 [CI/CD] 配置 GitHub Actions 自动化打包 Release ZIP**
  - **目标**：每次打 Git Tag（如 `v1.0.0`），自动编译并附加上传可直接提交至 CWS 的 ZIP 压缩包。
