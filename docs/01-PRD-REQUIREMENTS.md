# 📄 01-需求规格说明书 (PRD & 竞品逆向分析)

> **文档状态**：已批准 (Approved)  
> **所属里程碑**：M1 - 原型与需求确立  
> **面向对象**：产品经理、开发工程师、开源贡献者

---

## 1. 项目背景与老插件逆向调研

### 1.1 现状与市场痛点
在学术论文阅读领域（arXiv, PubMed, IEEE Xplore, Google Scholar），历史上有数个装机量达 5w~10w 级别的学术辅助插件（如部分旧版 arXiv Companion、BibTeX Exporter、PDF Reader 扩展）。

对这些老旧插件近 12 个月的用户评论进行抓取分析，发现以下共性溃败点：
1. **交互硬伤（Fatal UX Flaw）**：采用传统 Popup 机制。用户在弹出窗口中生成了解释，鼠标移开回到论文翻页或点击其他公式，Popup **立刻无条件自动关闭并销毁状态**。用户不得不反复复制、反复点击，体验极其挫败。
2. **MV3 升级断更**：Google 全面废除 Manifest V2 背景页面后，原作者未跟进重构，插件在 Chrome 120+ 版本出现大量权限报错与 Service Worker 睡死 Bug。
3. **隐私顾虑**：现有部分商业化 AI 论文阅读器要求用户先上传整篇 PDF 到其中心化云端服务器。对于高校实验室**尚未发表的预印本或专利前瞻研究**，存在极大的数据泄露担忧。

### 1.2 PaperPilot 的产品定位与价值主张
* **定位**：基于 Chrome 原生 **Side Panel API** 的轻量、开源、极客级论文常驻伴读副驾驶。
* **核心价值主张**：
  * **常驻不扰**：侧边栏与论文同屏常驻，支持动态宽度拖拽，伴随阅读全程。
  * **纯本地隐私（Zero Cloud Leak）**：全部配置保存在本地 `chrome.storage.local`，模型直连，不走任何中转服务器。
  * **划词即解（Zero-friction Ingestion）**：无需在输入框中反复粘贴，页面划词一键同步至侧边栏。

---

## 2. 目标用户画像 (Target Personas)

| 用户角色 | 核心痛点 | 最关注特性 |
| :--- | :--- | :--- |
| **理工科硕士/博士研究生** | 每天需刷大量 arXiv 论文；对公式推导中跳步、复杂符号理解耗时；需要撰写 Related Works。 | 公式白话直觉释疑、实验对比分析、BibTeX 一键格式化。 |
| **高校教授 / 资深科研人员** | 审稿任务繁重；关注未公开实验的保密性；需要快速识别论文的核心增量与局限。 | 同行盲审视角质疑、本地 Ollama 离线运行模式、TL;DR 快速筛选。 |
| **科技企业算法/研发工程师** | 需要迅速评估最新 SOTA 论文是否可工程化落地；对学术术语与工程实现的映射敏感。 | 算法复杂度与工程落地边界评估、代码实现开源仓库联动。 |

---

## 3. 功能需求规格详细说明 (Feature Specifications)

### 3.1 模块 A：Chrome Side Panel 常驻交互
* **FR-A01 扩展图标联动**：点击浏览器右上角插件 Action 图标，自动开启/折叠当前标签页的右侧 Side Panel。
* **FR-A02 侧边栏多 Tab 布局**：
  * `Tab 1: Paper Overview (全文速读与元数据)`
  * `Tab 2: Selection Explainer (划词释疑与公式解析)`
  * `Tab 3: Settings (BYOK 与偏好配置)`

### 3.2 模块 B：划词捕获与公式白话释疑
* **FR-B01 页面划词悬浮胶囊**：在学术页面（arXiv 摘要页、HTML 论文、PDF 阅读器）中高亮选中文本或公式后，在鼠标右上角出现快捷交互胶囊（Tooltip Capsule）：“*Ask PaperPilot*”。
* **FR-B02 一键推送到侧边栏**：点击胶囊或按下快捷键（`Alt + P`），自动将选中内容填充进 Side Panel 的划词解释流，并唤起 AI 流式解答。
* **FR-B03 数学公式推导直觉化**：针对 LaTeX 格式公式，Prompt 强调：“*用物理意义、几何直觉和生活化类比解释该公式的核心作用，指出每个关键参数对最终结果的影响方向*”。

### 3.3 模块 C：全文 TL;DR 与同行评审批判视角
* **FR-C01 结构化摘要提取**：
  * **Problem Statement**：论文旨在解决什么具体缺陷？
  * **Core Innovation**：相比 Baseline 最大的架构/算法创新是什么？
  * **Key Results**：在哪些公开数据集上取得了 SOTA？提升幅度多大？
  * **Limitations**：作者承认或潜在的实验不足是什么？
* **FR-C02 审稿人视角模式 (Reviewer Mode)**：
  * 自动审视消融实验（Ablation Study）是否充分；
  * 指出算力/显存开销是否过高导致无法复现；
  * 提示是否存在针对特定测试集的过拟合可能。

### 3.4 模块 D：多厂商 BYOK 接入与本地存储
* **FR-D01 Provider 自由切换**：支持 DeepSeek, OpenAI, Anthropic, 本地 Ollama。
* **FR-D02 密钥安全**：API Key 仅存放于浏览器沙箱内 `chrome.storage.local`，绝不上传到任何远程数据库。
* **FR-D03 连通性测试 (Test Connection)**：在配置界面提供一键验证接口连通性与余额功能。

---

## 4. 非功能需求 (Non-Functional Requirements)

1. **权限最小化原则 (CWS Compliance)**：
   * 仅申请 `sidePanel`, `storage`, `activeTab` 权限；
   * 不申请广泛的 `<all_urls>`，仅在有明确需求的域名上按需注入，确保 48 小时极速过审。
2. **轻量与响应速度**：
   * 侧边栏包体积小于 3MB；
   * 首屏加载时间 < 150ms；
   * AI 回答采用 Server-Sent Events (SSE) 流式传输（Streaming），用户无需等待全部输出即可开始阅读。
3. **兼容性**：
   * 完美支持 Chrome >= 116（Side Panel 稳定支持版本）；
   * 支持 Edge, Brave 等所有 Chromium 内核浏览器。
