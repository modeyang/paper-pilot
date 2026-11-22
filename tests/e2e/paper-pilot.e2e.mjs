import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const EXTENSION_PATH = path.join(PROJECT_ROOT, '.output/chrome-mv3');
const EGO_EXECUTABLE_PATH =
  process.env.EGO_BROWSER_PATH || '/Applications/ego lite.app/Contents/MacOS/ego lite';
const HEADLESS = process.env.EGO_HEADLESS !== 'false';

const ARXIV_TEST_URL = 'https://arxiv.org/abs/2401.12345';
const ARXIV_HTML_FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>[2401.12345] Attention Is All You Need Again</title></head>
<body>
  <div id="abs">
    <h1 class="title mathjax"><span class="descriptor">Title:</span>Attention Is All You Need Again: Fast Diffusion Scaling</h1>
    <div class="authors">
      <span class="descriptor">Authors:</span>
      <a href="#a1">Alice Zhang</a>,
      <a href="#a2">Bob Chen</a>,
      <a href="#a3">Carol Wang</a>,
      <a href="#a4">Dave Liu</a>
    </div>
    <blockquote class="abstract mathjax">
      <span class="descriptor">Abstract:</span>
      We propose a simplified diffusion objective that improves FID by 18% while cutting FLOPs in half.
    </blockquote>
    <p id="formula-para">
      The training loss is defined as L(theta) = E_{x,t}[||eps - eps_theta(x_t, t)||^2] over Gaussian noise schedules.
    </p>
  </div>
</body>
</html>`;

function createOpenAISSE(chunks) {
  const lines = chunks.map(
    (delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`
  );
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

function createAnthropicSSE(chunks) {
  const lines = chunks.map(
    (text) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`
  );
  lines.push('data: {"type":"message_stop"}\n\n');
  return lines.join('');
}

describe('PaperPilot E2E Tests (Ego Browser)', () => {
  let context;
  let userDataDir;
  let extensionId;
  let sidepanelUrl;
  const recordedRequests = [];

  before(async () => {
    assert.ok(
      fs.existsSync(EXTENSION_PATH),
      `Built extension not found at ${EXTENSION_PATH}. Run "npm run build" first.`
    );
    assert.ok(
      fs.existsSync(EGO_EXECUTABLE_PATH),
      `Ego browser binary not found at ${EGO_EXECUTABLE_PATH}. Set EGO_BROWSER_PATH if installed elsewhere.`
    );

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-pilot-ego-e2e-'));

    const launchArgs = [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (HEADLESS) {
      launchArgs.unshift('--headless=new');
    }

    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: EGO_EXECUTABLE_PATH,
      headless: false,
      args: launchArgs,
    });

    // Mock arXiv abstract page so tests run offline & deterministically
    await context.route('https://arxiv.org/abs/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: ARXIV_HTML_FIXTURE,
      });
    });

    // Mock AI provider APIs (Anthropic & DeepSeek) and record requests
    await context.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request();
      const postData = req.postDataJSON?.() ?? null;
      recordedRequests.push({
        provider: 'anthropic',
        url: req.url(),
        headers: req.headers(),
        body: postData,
      });

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: createAnthropicSSE(['Connection ', 'successful!']),
      });
    });

    await context.route('https://api.deepseek.com/**', async (route) => {
      const req = route.request();
      const postData = req.postDataJSON?.() ?? null;
      recordedRequests.push({
        provider: 'deepseek',
        url: req.url(),
        headers: req.headers(),
        body: postData,
      });

      const userContent = postData?.messages?.find((m) => m.role === 'user')?.content || '';
      const systemContent = postData?.messages?.find((m) => m.role === 'system')?.content || '';

      let replyChunks = ['OK'];
      if (userContent.includes('Connection successful')) {
        replyChunks = ['Connection ', 'successful!'];
      } else if (systemContent.includes('4 维提炼')) {
        replyChunks = ['🎯 【核心解决痛点】：传统扩散模型采样开销过高。\n', '💡 【关键创新解法】：简化噪声调度目标。'];
      } else if (systemContent.includes('审稿人')) {
        replyChunks = ['1. 【创新性质疑】：消融实验需补充更多数据集验证。'];
      } else if (systemContent.includes('几何直觉')) {
        replyChunks = ['📐 公式直觉：让模型学会从噪声中还原原始信号。'];
      } else {
        replyChunks = ['💡 大白话：这就是一个去噪均方误差损失函数。'];
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: createOpenAISSE(replyChunks),
      });
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const swUrl = new URL(sw.url());
    extensionId = swUrl.hostname;
    sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  });

  after(async () => {
    if (context) {
      await context.close();
    }
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('1. Service worker initializes and configures sidePanel click behavior', async () => {
    const [sw] = context.serviceWorkers();
    assert.ok(sw, 'Background service worker should be running');
    assert.match(sw.url(), /\/background\.js$/);

    const behavior = await sw.evaluate(async () => {
      return chrome.sidePanel.getPanelBehavior();
    });
    assert.equal(behavior.openPanelOnActionClick, true);
  });

  test('2. Settings tab switches provider defaults, normalizes Anthropic URL, and persists BYOK config', async () => {
    const panel = await context.newPage();
    await panel.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.click('[data-tab="tab-settings"]');

    // Verify provider default auto-fill (including local Magpie gateway)
    await panel.selectOption('#select-provider', 'magpie');
    assert.equal(await panel.inputValue('#input-base-url'), 'http://127.0.0.1:3425/v1');
    assert.equal(await panel.inputValue('#input-model'), 'auto/deepseek-v4.1-flash');

    await panel.selectOption('#select-provider', 'openai');
    assert.equal(await panel.inputValue('#input-base-url'), 'https://api.openai.com/v1');
    assert.equal(await panel.inputValue('#input-model'), 'gpt-4o-mini');

    await panel.selectOption('#select-provider', 'ollama');
    assert.equal(await panel.inputValue('#input-base-url'), 'http://localhost:11434');
    assert.equal(await panel.inputValue('#input-model'), 'llama3:latest');

    // Test Anthropic connection & verify no /v1/v1/messages duplication
    await panel.selectOption('#select-provider', 'anthropic');
    assert.equal(await panel.inputValue('#input-base-url'), 'https://api.anthropic.com/v1');
    await panel.fill('#input-api-key', 'sk-ant-test-key');

    recordedRequests.length = 0;
    await panel.click('#btn-test-connection');
    await panel.waitForFunction(
      () => document.querySelector('#settings-status')?.textContent?.includes('连通性测试通过')
    );

    assert.equal(recordedRequests.length, 1);
    assert.equal(recordedRequests[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(recordedRequests[0].headers['x-api-key'], 'sk-ant-test-key');
    assert.equal(recordedRequests[0].headers['anthropic-version'], '2023-06-01');

    // Save DeepSeek config and verify persistence across reload
    await panel.selectOption('#select-provider', 'deepseek');
    await panel.fill('#input-api-key', 'sk-deepseek-e2e-key');
    await panel.click('#btn-save-settings');
    await panel.waitForFunction(
      () => document.querySelector('#settings-status')?.textContent?.includes('配置已安全保存')
    );

    await panel.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await panel.textContent('#provider-badge'), 'deepseek');
    await panel.click('[data-tab="tab-settings"]');
    assert.equal(await panel.inputValue('#select-provider'), 'deepseek');
    assert.equal(await panel.inputValue('#input-api-key'), 'sk-deepseek-e2e-key');

    await panel.close();
  });

  test('3. arXiv metadata extraction hydrates side panel on cold start and streams TL;DR & Critique', async () => {
    // Open arXiv page BEFORE opening the side panel to verify cold-start hydration
    const arxivPage = await context.newPage();
    await arxivPage.goto(ARXIV_TEST_URL, { waitUntil: 'networkidle' });

    const panel = await context.newPage();
    await panel.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.waitForFunction(
      () =>
        document
          .querySelector('#paper-title')
          ?.textContent?.includes('Attention Is All You Need Again')
    );
    const authorsText = await panel.textContent('#paper-authors');
    assert.match(authorsText || '', /Alice Zhang, Bob Chen, Carol Wang/);

    // Trigger 4D TL;DR
    recordedRequests.length = 0;
    await panel.click('#btn-tldr');
    await panel.waitForFunction(() =>
      document.querySelector('#overview-output')?.textContent?.includes('简化噪声调度目标')
    );
    assert.equal(recordedRequests.length, 1);
    assert.equal(recordedRequests[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(recordedRequests[0].headers.authorization, 'Bearer sk-deepseek-e2e-key');

    // Trigger Peer Review Critique
    await panel.click('#btn-critique');
    await panel.waitForFunction(() =>
      document.querySelector('#overview-output')?.textContent?.includes('消融实验需补充更多数据集验证')
    );

    await panel.close();
    await arxivPage.close();
  });

  test('4. Selecting formula on paper renders Shadow DOM capsule and drives Selection Explainer streaming', async () => {
    const arxivPage = await context.newPage();
    await arxivPage.goto(ARXIV_TEST_URL, { waitUntil: 'networkidle' });

    const panel = await context.newPage();
    await panel.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });

    // Select formula paragraph on arXiv page and fire mouseup
    await arxivPage.evaluate(() => {
      const p = document.getElementById('formula-para');
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // Verify Shadow DOM floating capsule appears
    await arxivPage.waitForSelector('#paper-pilot-capsule-root', { timeout: 5000 });
    const capsuleText = await arxivPage.evaluate(() => {
      const root = document.getElementById('paper-pilot-capsule-root');
      return root?.shadowRoot?.querySelector('button')?.textContent?.trim();
    });
    assert.match(capsuleText || '', /Ask PaperPilot/);

    // Click the button inside Shadow DOM
    await arxivPage.evaluate(() => {
      const root = document.getElementById('paper-pilot-capsule-root');
      root.shadowRoot.querySelector('button').click();
    });

    // Capsule should close and Side Panel should switch to Selection tab & stream formula intuition
    await arxivPage.waitForFunction(
      () => !document.getElementById('paper-pilot-capsule-root')
    );

    await panel.waitForFunction(() =>
      document.querySelector('#tab-selection')?.classList.contains('active')
    );
    const preview = await panel.textContent('#selected-text-preview');
    assert.match(preview || '', /eps_theta\(x_t, t\)/);

    await panel.waitForFunction(() =>
      document.querySelector('#selection-output')?.textContent?.includes('让模型学会从噪声中还原原始信号')
    );

    // Trigger Plain-Language Explanation
    await panel.click('#btn-explain-plain');
    await panel.waitForFunction(() =>
      document.querySelector('#selection-output')?.textContent?.includes('去噪均方误差损失函数')
    );

    await panel.close();
    await arxivPage.close();
  });

  test('5. Missing API key shows warning and blocks outbound request', async () => {
    const panel = await context.newPage();
    await panel.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.click('[data-tab="tab-settings"]');
    await panel.selectOption('#select-provider', 'deepseek');
    await panel.fill('#input-api-key', '');
    await panel.click('#btn-save-settings');
    await panel.waitForFunction(
      () => document.querySelector('#settings-status')?.textContent?.includes('配置已安全保存')
    );

    recordedRequests.length = 0;
    await panel.click('[data-tab="tab-overview"]');
    await panel.click('#btn-tldr');

    await panel.waitForFunction(() =>
      document.querySelector('#overview-output')?.textContent?.includes('请先切换到【设置】标签页配置你的 API Key')
    );
    assert.equal(recordedRequests.length, 0);

    await panel.close();
  });
});
