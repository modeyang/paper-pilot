import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAcceptanceContext, FIXTURE_URLS } from './helpers/acceptance-env.mjs';

describe('PaperPilot Baseline E2E Tests (Ego / Chromium)', () => {
  let env;

  before(async () => {
    env = await createAcceptanceContext();
  });

  after(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  test('1. Service worker initializes and configures sidePanel click behavior', async () => {
    assert.ok(env.sw, 'Background service worker should be running');
    assert.match(env.sw.url(), /\/background\.js$/);

    const behavior = await env.sw.evaluate(async () => {
      return chrome.sidePanel.getPanelBehavior();
    });
    assert.equal(behavior.openPanelOnActionClick, true);
  });

  test('2. Settings tab switches provider defaults, normalizes Anthropic URL, and persists BYOK config', async () => {
    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

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

    env.state.recordedRequests.length = 0;
    await panel.click('#btn-test-connection');
    await panel.waitForFunction(
      () => document.querySelector('#settings-status')?.textContent?.includes('连通性测试通过')
    );

    assert.equal(env.state.recordedRequests.length, 1);
    assert.equal(env.state.recordedRequests[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(env.state.recordedRequests[0].headers['x-api-key'], 'sk-ant-test-key');
    assert.equal(env.state.recordedRequests[0].headers['anthropic-version'], '2023-06-01');

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
    const arxivPage = await env.context.newPage();
    await arxivPage.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.waitForFunction(
      () =>
        document
          .querySelector('#paper-title')
          ?.textContent?.includes('Attention Is All You Need Again')
    );
    const authorsText = await panel.textContent('#paper-authors');
    assert.match(authorsText || '', /Alice Zhang, Bob Chen, Carol Wang/);

    env.state.recordedRequests.length = 0;
    await panel.click('#btn-tldr');
    await panel.waitForFunction(() =>
      document.querySelector('#overview-output')?.textContent?.includes('简化噪声调度目标')
    );
    assert.equal(env.state.recordedRequests.length, 1);
    assert.equal(env.state.recordedRequests[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(
      env.state.recordedRequests[0].headers.authorization,
      'Bearer sk-deepseek-e2e-key'
    );

    await panel.click('#btn-critique');
    await panel.waitForFunction(() =>
      document.querySelector('#overview-output')?.textContent?.includes('消融实验需补充更多数据集验证')
    );

    await panel.close();
    await arxivPage.close();
  });

  test('4. Selecting formula on paper renders Shadow DOM capsule and drives Selection Explainer streaming', async () => {
    const arxivPage = await env.context.newPage();
    await arxivPage.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await arxivPage.evaluate(() => {
      const p = document.getElementById('formula-para');
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await arxivPage.waitForSelector('#paper-pilot-capsule-root', { timeout: 5000 });
    const capsuleText = await arxivPage.evaluate(() => {
      const root = document.getElementById('paper-pilot-capsule-root');
      return root?.shadowRoot?.querySelector('button')?.textContent?.trim();
    });
    assert.match(capsuleText || '', /Ask PaperPilot/);

    await arxivPage.evaluate(() => {
      const root = document.getElementById('paper-pilot-capsule-root');
      root.shadowRoot.querySelector('button').click();
    });

    await arxivPage.waitForFunction(() => !document.getElementById('paper-pilot-capsule-root'));

    await panel.waitForFunction(() =>
      document.querySelector('#tab-selection')?.classList.contains('active')
    );
    const preview = await panel.textContent('#selected-text-preview');
    assert.match(preview || '', /eps_theta\(x_t, t\)/);

    await panel.waitForFunction(() =>
      document.querySelector('#selection-output')?.textContent?.includes('让模型学会从噪声中还原原始信号')
    );

    await panel.click('#btn-explain-plain');
    await panel.waitForFunction(() =>
      document.querySelector('#selection-output')?.textContent?.includes('去噪均方误差损失函数')
    );

    await panel.close();
    await arxivPage.close();
  });

  test('5. Missing API key shows warning and blocks outbound request', async () => {
    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.click('[data-tab="tab-settings"]');
    await panel.selectOption('#select-provider', 'deepseek');
    await panel.fill('#input-api-key', '');
    await panel.click('#btn-save-settings');
    await panel.waitForFunction(
      () => document.querySelector('#settings-status')?.textContent?.includes('配置已安全保存')
    );

    env.state.recordedRequests.length = 0;
    await panel.click('[data-tab="tab-overview"]');
    await panel.click('#btn-tldr');

    await panel.waitForFunction(() =>
      document
        .querySelector('#overview-output')
        ?.textContent?.includes('请先切换到【设置】标签页配置你的 API Key')
    );
    assert.equal(env.state.recordedRequests.length, 0);

    await panel.close();
  });
});
