# PaperPilot 端到端验收环境与标准（Acceptance Criteria）

本文档定义了在实现 GitHub Issue `#2`–`#10` 之前构建的自动化端到端验收环境、质量门禁及每个 Issue 的验收标准。

---

## 1. 验收环境架构

- **浏览器运行时**：[tests/e2e/helpers/acceptance-env.mjs](../tests/e2e/helpers/acceptance-env.mjs)
  - 本地优先使用 **Ego Lite**（`/Applications/ego lite.app/Contents/MacOS/ego lite`），支持 `EGO_BROWSER_PATH` 覆盖，并在 Linux/CI 自动回退至 Chrome / Chromium。
  - 通过 `--load-extension=.output/chrome-mv3` 加载真实编译产物，运行完整的 MV3 Service Worker、Content Script Shadow DOM 与 Side Panel 上下文。
- **离线确定性站点夹具（Fixtures）**：
  - `https://arxiv.org/abs/*`（两篇独立论文用于验证多标签页切换）
  - `https://arxiv.org/html/*`
  - `https://www.biorxiv.org/content/*`
  - `https://pubmed.ncbi.nlm.nih.gov/*`
  - `https://example.com/*`（非学术站点对照组）
- **可控 SSE 大模型模拟路由**：
  - 覆盖 DeepSeek、OpenAI、Anthropic、Ollama 与本地 Magpie 网关（含 `/v1/models`、`reasoning_content`、`markdown_latex` + `<script>` XSS 载荷、`reasoning_slow` 慢响应模式）。

---

## 2. 验证流水线命令

```bash
# 全量基线验收（类型检查 + 生产构建 + MV3 合规门禁 + 基线 E2E + 已实现 Issue 回归）
npm run verify

# 单项预览/红灯验证（例如开始实现 Issue #2 前先验证其测试可捕获缺失）
VERIFY_ISSUES=2 npm run verify:acceptance

# 运行全部 Issue 验收矩阵（用于阶段性全量排查）
VERIFY_ISSUES=all npm run verify:acceptance

# 有界面直观调试 Ego 浏览器执行过程
EGO_HEADLESS=false npm run test:e2e
```

---

## 3. 各阶段门禁与 Issue 验收标准

### 门禁 A：构建与 MV3 合规检查（`tests/e2e/verify-bundle.mjs`）
1. `tsc --noEmit` 必须 0 报错通过。
2. `.output/chrome-mv3/manifest.json` 必须为 MV3，正确声明 `side_panel.default_path` 与 `background.service_worker`，且权限保持最小化（禁止重新引入广泛权限）。
3. 扩展总包体积 `< 3 MB`。
4. 构建产物 HTML 中不得包含外部 `http(s)://` CDN `<script>` 或 `<link>` 标签（满足 MV3 CSP 与离线安全）。

### 门禁 B：基线功能回归（`tests/e2e/paper-pilot.e2e.mjs`）
1. Service Worker 初始化并配置 `openPanelOnActionClick: true`。
2. 设置页 Provider 默认值（含 `magpie`）、Anthropic `/v1/messages` URL 规范化、`chrome.storage.local` 持久化。
3. arXiv `/abs/` 元数据冷启动回填与速读/盲评 SSE 流式输出。
4. 页面划词 Shadow DOM 悬浮胶囊弹出、点击触发划词 Tab 切换与公式直觉流式输出。
5. 非本地 Provider 空 API Key 拦截，不发送外部请求。

### 门禁 C：Issue 专项验收矩阵（`tests/e2e/issues-acceptance.e2e.mjs`）

| Issue | 核心验收点 | 约定契约 / 选择器 |
| :--- | :--- | :--- |
| **#2** | Markdown 标题/加粗、行内与块级 KaTeX 公式渲染、XSS `<script>` 消毒过滤 | `#overview-output` / `#selection-output` 内包含 `h3`/`strong`/`.katex`，无 `script` 执行 |
| **#3** | 空论文禁用/拦截外发请求；支持 arXiv HTML、bioRxiv、PubMed 元数据自动提取 | `#btn-tldr` 禁用或拦截请求；`#paper-title` 自动展示对应站点标题 |
| **#4** | 按 `tabId` 隔离缓存；切换标签页时 Side Panel 同步切换当前论文 | `page1.bringToFront()` / `page2.bringToFront()` 自动更新 `#paper-title` |
| **#5** | `#selected-text-preview` 可直接输入编辑；支持多轮追问并携带 `assistant` 历史 | `[data-testid="selection-followup-input"]`、`[data-testid="selection-followup-send"]` |
| **#6** | 胶囊在视口右上边缘自动防裁切；短术语（如 `LoRA`）可触发；非学术站默认不弹出 | `#paper-pilot-capsule-root` boundingClientRect 位于视口内 |
| **#7** | 流式推理可点击停止按钮中断；支持思考态计时与 `reasoning_content` 展示 | `[data-testid="btn-stop-inference"]` |
| **#8** | 设置页支持 Key 显隐切换、未保存状态提示、头部快速切换模型 | `[data-testid="btn-toggle-api-key"]`、`[data-testid="quick-model-select"]` |
| **#9** | `prefers-color-scheme: dark` 下背景与卡片自动切换深色高对比主题 | `document.body` 计算背景亮度 `< 0.35` |
| **#10** | 支持输出语言切换与自定义 System Prompt 并真实注入 `system` 消息 | `[data-testid="select-output-language"]`、`[data-testid="input-custom-prompt"]` |

---

## 4. 单个 Issue 开发闭环（Red-Green-Refactor）

1. **Red**：执行 `VERIFY_ISSUES=<N> npm run verify:acceptance`，确认对应验收用例在当前代码上失败。
2. **Implement**：完成 Issue `#N` 的编码实现。
3. **Green**：将 `<N>` 加入 `tests/e2e/issues-acceptance.e2e.mjs` 的 `IMPLEMENTED_ISSUES`，执行 `npm run verify`，确认类型检查、构建、合规门禁、基线回归与 Issue `#N` 验收全部通过。
4. **Live Ego Check & Close**：如需真机交互确认，在 Ego Lite 中核验后提交 PR / 关闭对应 GitHub Issue。
