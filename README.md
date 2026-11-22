# 🎓 PaperPilot — AI-Powered Academic Paper Side Panel Copilot

[![Manifest V3 Ready](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?logo=google-chrome)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Framework](https://img.shields.io/badge/Built%20with-WXT-brightgreen)](https://wxt.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **PaperPilot** 是一款基于 Chrome 原生 **Side Panel (侧边栏 API)** 与 **Manifest V3** 现代架构打造的学术论文伴读助手。
> 专门解决老旧学术插件（如旧版 arXiv 伴读扩展）**弹窗频繁意外关闭、不支持内嵌 PDF、年久断更崩溃**等痛点。主打 **BYOK（自带 API Key，零隐私泄露、零服务器成本）**，为科研人员与研究生提供划词公式白话解读、论文创新点提炼与同行评审级深度分析。

---

## 🌟 为什么要做 PaperPilot？（痛点与核心优势）

| 痛点场景 | 传统 10w+ 断更老插件的硬伤 | PaperPilot 的现代解法 |
| :--- | :--- | :--- |
| **交互形态** | 采用旧式 Popup 浮窗，鼠标只要点击正文或翻页，浮窗立刻关闭，笔记瞬间丢失 | **基于 Chrome 原生 Side Panel API**：侧边栏与网页/PDF 并排常驻，永不自动关闭 |
| **PDF 适配** | 只能在 arXiv HTML 页面勉强生效，遇到内嵌 PDF 阅读器直接哑火 | 针对 Chrome 原生 PDF 查看器与学术网站 Content Script 优化，全面支持划词捕获 |
| **数据隐私** | 传统 SaaS 将用户论文和阅读记录上传至未知中心化服务器 | **100% BYOK 纯前端直连**：Key 与 Prompt 本地留存，绝无未公开论文泄露隐患 |
| **模型支持** | 硬编码单一过时接口或依赖不稳定作者自建转发网关 | **多厂商原生适配**：DeepSeek, OpenAI, Claude, 本地 Ollama 开箱即用 |

---

## 🚀 核心功能规划 (Feature Matrix)

- [x] **Chrome Side Panel 常驻交互**：一键右侧展开，支持随网页/PDF 自适应分屏。
- [x] **Paper TL;DR 极速诊断**：一键结构化提取论文 4 大核心维度（背景痛点、核心贡献、方法创新、局限性）。
- [x] **公式白话直觉释疑 (LaTeX Intuition)**：划选数学公式与推导步骤，侧边栏以自然语言给出直觉解释与物理/工程意义。
- [x] **同行评审盲审视角 (Peer Review Critique)**：一键模拟严苛审稿人视角，指出实验设计潜在漏洞与消融实验不足。
- [x] **多厂商 BYOK 支持**：
  - DeepSeek (deepseek-chat / deepseek-reasoner 极高性价比与数学能力)
  - OpenAI (GPT-4o / GPT-4o-mini)
  - Anthropic (Claude 3.5 Sonnet)
  - 本地 Ollama (完全离线科研数据保密)

---

## 📂 项目生命周期文档索引 (GitHub Lifecycle Docs)

本项目按照标准化开源与独立开发规范进行全生命周期管理：

1. 📄 [01-需求规格说明书 (PRD & 用户痛点拆解)](docs/01-PRD-REQUIREMENTS.md)
2. 🏗️ [02-系统架构与技术选型 (MV3 + WXT + BYOK)](docs/02-ARCHITECTURE.md)
3. 📋 [03-GitHub Issue 任务看板与迭代规划 (Roadmap)](docs/03-GITHUB-ISSUES-ROADMAP.md)
4. 🚀 [04-Chrome Web Store 上架与合规审核指南](docs/04-STORE-PUBLISHING-GUIDE.md)

---

## 🛠️ 本地开发指南

### 环境准备
- Node.js >= 18.0.0
- pnpm 或 npm

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/paper-pilot.git
cd paper-pilot

# 2. 安装依赖
npm install

# 3. 启动开发模式 (热重载)
npm run dev

# 4. 加载到 Chrome:
# 打开 chrome://extensions -> 打开右上角开发者模式 (Developer Mode) -> 点击 "Load unpacked" -> 选择 .output/chrome-mv3 目录
```

### 生产打包
```bash
npm run build
# 编译产物位于 .output/chrome-mv3，同时自动生成用于 Chrome Web Store 提交的 release.zip
```

---

## 📄 开源许可证
本项目遵循 [MIT License](LICENSE)。
