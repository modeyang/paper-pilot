import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');
export const EXTENSION_PATH = path.join(PROJECT_ROOT, '.output/chrome-mv3');
export const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'tests/e2e/artifacts');
export const HEADLESS = process.env.EGO_HEADLESS !== 'false';

export async function captureAcceptanceScreenshot(
  page,
  filename,
  { width = 420, height = 720, fullPage = false } = {}
) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const outPath = path.join(ARTIFACTS_DIR, filename);
  await page.screenshot({ path: outPath, fullPage });
  return outPath;
}

const BROWSER_CANDIDATES = [
  process.env.EGO_BROWSER_PATH,
  '/Applications/ego lite.app/Contents/MacOS/ego lite',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function resolveBrowserExecutable() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export const FIXTURE_URLS = {
  arxivAbs: 'https://arxiv.org/abs/2401.12345',
  arxivAbsSecond: 'https://arxiv.org/abs/2402.99999',
  arxivHtml: 'https://arxiv.org/html/2401.12345v1',
  biorxiv: 'https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1',
  pubmed: 'https://pubmed.ncbi.nlm.nih.gov/38123456/',
  nonAcademic: 'https://example.com/article',
};

export const FIXTURES = {
  arxivAbs: `<!DOCTYPE html>
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
    <p id="short-term">LoRA</p>
    <div id="top-edge-text" style="position:fixed;top:4px;right:4px;width:160px;">Edge formula $E=mc^2$ near viewport top-right</div>
  </div>
</body>
</html>`,

  arxivAbsSecond: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>[2402.99999] Sparse Mixture of Experts at Scale</title></head>
<body>
  <div id="abs">
    <h1 class="title mathjax"><span class="descriptor">Title:</span>Sparse Mixture of Experts at Scale</h1>
    <div class="authors">
      <span class="descriptor">Authors:</span>
      <a href="#a1">Eve Lin</a>,
      <a href="#a2">Frank Wu</a>
    </div>
    <blockquote class="abstract mathjax">
      <span class="descriptor">Abstract:</span>
      Token-level routing reduces inference FLOPs by 4x on 100B parameter models.
    </blockquote>
  </div>
</body>
</html>`,

  arxivHtml: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>HTML Paper: FlashAttention-3</title></head>
<body>
  <article class="ltx_document">
    <h1 class="ltx_title ltx_title_document">FlashAttention-3: Fast and Accurate Attention with Asynchrony</h1>
    <div class="ltx_authors"><span class="ltx_personname">Jay Shah</span>, <span class="ltx_personname">Tri Dao</span></div>
    <div class="ltx_abstract">
      <h6>Abstract</h6>
      <p class="ltx_p">We exploit Hopper GPU warp specialization to achieve 75% H100 tensor core utilization.</p>
    </div>
  </article>
</body>
</html>`,

  biorxiv: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Single-cell foundation models | bioRxiv</title>
  <meta name="citation_title" content="Single-Cell Foundation Models for Perturbation Prediction" />
  <meta name="citation_author" content="Grace Li" />
  <meta name="citation_author" content="Henry Park" />
</head>
<body>
  <h1 id="page-title" class="highwire-cite-title">Single-Cell Foundation Models for Perturbation Prediction</h1>
  <div class="section abstract" id="abstract-1">
    <p>We train a 50M-cell transformer that predicts unseen genetic perturbations across tissues.</p>
  </div>
</body>
</html>`,

  pubmed: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>CRISPR-Cas9 specificity - PubMed</title></head>
<body>
  <h1 class="heading-title">High-Fidelity CRISPR-Cas9 Base Editing in Primary T Cells</h1>
  <div class="authors-list"><a class="full-name">Iris Patel</a>, <a class="full-name">John Kim</a></div>
  <div class="abstract-content selected" id="eng-abstract">
    <p>Engineered Cas9 variants reduce off-target indels by 95% while maintaining on-target editing efficiency.</p>
  </div>
</body>
</html>`,

  nonAcademic: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Example Non-Academic News Page</title></head>
<body>
  <article>
    <h1>Daily Tech Digest</h1>
    <p id="news-para">This is a regular non-academic news paragraph with more than five characters.</p>
  </article>
</body>
</html>`,
};

export function createOpenAISSE(chunks, { reasoningChunks = [] } = {}) {
  const lines = [];
  for (const r of reasoningChunks) {
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: r } }] })}\n\n`);
  }
  for (const delta of chunks) {
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
  }
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

export function createAnthropicSSE(chunks) {
  const lines = chunks.map(
    (text) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`
  );
  lines.push('data: {"type":"message_stop"}\n\n');
  return lines.join('');
}

/**
 * Launches Ego Lite (or Chromium fallback) with the built MV3 extension and
 * installs deterministic offline routes for academic pages and LLM providers.
 */
export async function createAcceptanceContext(options = {}) {
  assert.ok(
    fs.existsSync(EXTENSION_PATH),
    `Built extension not found at ${EXTENSION_PATH}. Run "npm run build" first.`
  );

  const executablePath = resolveBrowserExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-pilot-accept-'));
  const launchArgs = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (HEADLESS) {
    launchArgs.unshift('--headless=new');
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : {}),
    headless: false,
    args: launchArgs,
  });

  const state = {
    recordedRequests: [],
    responseMode: options.responseMode || 'default', // 'default' | 'markdown_latex' | 'reasoning_slow'
    slowDelayMs: options.slowDelayMs ?? 1500,
  };

  await context.route('https://arxiv.org/abs/2401.12345', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURES.arxivAbs })
  );
  await context.route('https://arxiv.org/abs/2402.99999', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURES.arxivAbsSecond,
    })
  );
  await context.route('https://arxiv.org/html/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURES.arxivHtml })
  );
  await context.route('https://www.biorxiv.org/content/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURES.biorxiv })
  );
  await context.route('https://pubmed.ncbi.nlm.nih.gov/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURES.pubmed })
  );
  await context.route('https://example.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURES.nonAcademic,
    })
  );

  // Mock Anthropic API
  await context.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const postData = req.postDataJSON?.() ?? null;
    state.recordedRequests.push({
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

  // Mock OpenAI-compatible APIs (DeepSeek, OpenAI, Magpie, Ollama)
  const handleOpenAICompatible = (providerName) => async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.endsWith('/models')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: 'list',
          data: [
            { id: 'auto/deepseek-v4.1-flash', display_name: 'Deepseek-V4.1-Flash' },
            { id: 'auto/gemini-3.8-flash', display_name: 'Gemini 3.8 Flash' },
            { id: 'auto/gemini-4-hydrogen', display_name: 'Gemini 4 Hydrogen' },
          ],
        }),
      });
      return;
    }

    const postData = req.postDataJSON?.() ?? null;
    state.recordedRequests.push({
      provider: providerName,
      url,
      headers: req.headers(),
      body: postData,
    });

    if (state.responseMode === 'reasoning_slow') {
      await new Promise((r) => setTimeout(r, state.slowDelayMs));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: createOpenAISSE(['最终结论：梯度下降收敛。'], {
          reasoningChunks: ['第一步分析损失函数凸性...', '第二步验证学习率上界。'],
        }),
      });
      return;
    }

    if (state.responseMode === 'markdown_latex') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: createOpenAISSE([
          '### 核心公式解析\n\n',
          '这里的 **核心能量关系** 为 $E = mc^2$，带下标变量 $x_i + y_j$，积分形式如下：\n\n',
          '$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n',
          '- 要点一：能量与质量等价\n',
          '<span onclick="window.__xss=true">安全校验文本</span><script>window.__xss=true</script>',
        ]),
      });
      return;
    }

    const userContent = postData?.messages?.find((m) => m.role === 'user')?.content || '';
    const systemContent = postData?.messages?.find((m) => m.role === 'system')?.content || '';
    let replyChunks = ['OK'];
    if (userContent.includes('Connection successful')) {
      replyChunks = ['Connection ', 'successful!'];
    } else if (systemContent.includes('4 维提炼')) {
      replyChunks = [
        '🎯 【核心解决痛点】：传统扩散模型采样开销过高。\n',
        '💡 【关键创新解法】：简化噪声调度目标。',
      ];
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
  };

  await context.route('https://api.deepseek.com/**', handleOpenAICompatible('deepseek'));
  await context.route('https://api.openai.com/**', handleOpenAICompatible('openai'));
  await context.route('http://127.0.0.1:3425/**', handleOpenAICompatible('magpie'));
  await context.route('http://localhost:11434/**', handleOpenAICompatible('ollama'));

  let [sw] = context.serviceWorkers();
  if (!sw) {
    sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const extensionId = new URL(sw.url()).hostname;
  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;

  async function cleanup() {
    await context.close();
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }

  return {
    context,
    sw,
    extensionId,
    sidepanelUrl,
    executablePath,
    state,
    cleanup,
  };
}
