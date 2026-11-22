# 🚀 04-Chrome Web Store 上架与合规审核全流程指南

> **目标**：以最短路径、一次性通过 Google Chrome Web Store 官方人工/机审，避开权限滥用、隐私政策不合规等常见被拒雷区。

---

## 1. 开发者账号准备与前置条件

1. **注册 Google Chrome 开发者账号**：
   * 访问 [Chrome Web Store 开发者信息中心](https://chrome.google.com/webstore/devconsole/)；
   * 使用常用 Google 账号登录，并支付 **$5 美元** 的一次性开发者注册费（支持国内双币 Visa/MasterCard 信用卡）。
2. **两步验证 (2FA)**：
   * Google 强制要求开发者账号开启手机短信或 Authenticator 动态口令二次验证，否则无法发布或更新扩展。

---

## 2. 审核通过的核心命脉：单一用途原则 (Single Purpose)

Google 审核团队拒审最频繁的理由是 **“Violation: Single Purpose Policy”**（违反单一用途政策）。

* ❌ **错误示范**：“*一款集成了学术伴读、电商比价、天气预报、划词翻译的多功能工具箱。*” ➜ **100% 被拒**。
* ✅ **标准合规示范**：“*PaperPilot is an academic paper reading assistant that provides AI-powered formula explanations and paper summaries in the Chrome Side Panel.*” ➜ **聚焦学术阅读伴读，清晰无歧义**。

---

## 3. 权限最小化与说明模板 (Justification)

在 Chrome Developer Console 提交时，若申请了权限，必须向审核员填写“用途解释（Permission Justification）”。请直接复用以下合规文案：

| 申请权限 | 审核员用途解释文案 (Permission Justification) |
| :--- | :--- |
| `sidePanel` | *Used to display the paper reading assistant and formula analysis side-by-side with academic papers without covering the document content.* |
| `storage` | *Used to securely save user's local preferences and API credentials (BYOK) on their own device via chrome.storage.local.* |
| `activeTab` | *Used only when user clicks the extension action icon to detect the current academic paper title and URL for metadata extraction.* |
| `host_permissions` (`api.deepseek.com`, `api.openai.com` 等) | *Required to send direct, user-initiated LLM inference requests to the AI provider APIs using the user's own API key.* |

---

## 4. 隐私政策模板 (Privacy Policy Template)

Google 强制要求提供公开可访问的单页 Privacy Policy URL。可直接通过 GitHub Pages 免费托管：

```markdown
# Privacy Policy for PaperPilot

Last updated: November 2026

PaperPilot ("we", "our", or "the extension") is committed to protecting your privacy.

### 1. Data Collection and Usage
- **No Personal Data Collection**: PaperPilot does not collect, transmit, or store any personal identification data, browsing history, or payment information on any remote servers.
- **BYOK (Bring Your Own Key)**: All API keys provided by the user are stored strictly inside the browser's local sandbox storage (`chrome.storage.local`) and are never sent to any third-party server other than the official AI provider endpoint chosen by the user.
- **Academic Paper Content**: When you use the AI summary or formula explanation feature, only the explicitly selected text or the current paper's abstract is sent directly to your chosen AI provider (e.g., DeepSeek, OpenAI, Anthropic) for real-time inference.

### 2. Third-Party Services
Depending on your configuration, text requests are processed directly by:
- DeepSeek (https://www.deepseek.com)
- OpenAI (https://openai.com)
- Anthropic (https://www.anthropic.com)
- Local Ollama (Processed entirely on your local machine)

### 3. Contact Us
If you have questions regarding this Privacy Policy, please open an issue on our GitHub repository: https://github.com/your-username/paper-pilot.
```

---

## 5. 商店视觉图料规格清单 (Store Assets)

在提交前，请准备好以下标准的图像资源：

1. **扩展图标 (Icons)**：
   * `icon-16.png`：浏览器工具栏展示
   * `icon-48.png`：扩展管理页面展示
   * `icon-128.png`：Chrome Web Store 详情页主展示图
2. **商店屏幕截图 (Screenshots - 必填)**：
   * **分辨率**：**1280 x 800** 或 **640 x 400** 像素（PNG 格式）；
   * **数量**：建议 3 ~ 5 张，分别展示：
     1. arXiv 论文右侧展开 Side Panel 的同屏伴读实景；
     2. 划选复杂公式并给出白话解释的直观对比；
     3. 多模型 BYOK 设置界面。
3. **宣传横幅 (Marquee Promo Tile - 选填但强烈推荐)**：
   * **小尺寸展示图**：440 x 280 像素（用于分类列表和推荐位曝光）。
