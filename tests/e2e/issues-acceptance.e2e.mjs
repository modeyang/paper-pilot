import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createAcceptanceContext,
  captureAcceptanceScreenshot,
  FIXTURE_URLS,
} from './helpers/acceptance-env.mjs';

/**
 * Add issue numbers here once implemented so `npm run verify` enforces them as
 * permanent regression checks. Before implementation, run a specific check with:
 *   VERIFY_ISSUES=2 npm run verify:acceptance
 */
const IMPLEMENTED_ISSUES = new Set([2, 3, 4, 5, 6, 7]);

function parseRequestedIssues() {
  const raw = process.env.VERIFY_ISSUES?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'all') return 'all';
  return new Set(
    raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

const REQUESTED = parseRequestedIssues();

function shouldRunIssue(issueNumber) {
  if (REQUESTED === 'all') return true;
  if (REQUESTED instanceof Set) return REQUESTED.has(issueNumber);
  return IMPLEMENTED_ISSUES.has(issueNumber);
}

function issueTest(issueNumber, title, fn) {
  if (!shouldRunIssue(issueNumber)) {
    test(`Issue #${issueNumber}: ${title}`, {
      skip: `Not yet marked implemented (set VERIFY_ISSUES=${issueNumber} to run)`,
    }, () => {});
    return;
  }
  test(`Issue #${issueNumber}: ${title}`, fn);
}

describe('PaperPilot Issue Acceptance Matrix (#2 - #10)', () => {
  let env;

  before(async () => {
    const anyEnabled = [2, 3, 4, 5, 6, 7, 8, 9, 10].some(shouldRunIssue);
    if (anyEnabled) {
      env = await createAcceptanceContext();
    }
  });

  after(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  issueTest(2, 'renders Markdown headings/emphasis, inline & block KaTeX formulas, and sanitizes XSS', async () => {
    env.state.responseMode = 'markdown_latex';
    const arxivPage = await env.context.newPage();
    await arxivPage.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await panel.waitForFunction(() =>
      document.querySelector('#paper-title')?.textContent?.includes('Attention Is All You Need Again')
    );

    await panel.click('#btn-tldr');
    await panel.waitForFunction(
      () => {
        const el = document.querySelector('#overview-output');
        return el && el.querySelector('h3') && el.querySelector('.katex');
      },
      undefined,
      { timeout: 5000 }
    );

    const rendered = await panel.evaluate(() => {
      const out = document.querySelector('#overview-output');
      return {
        hasHeading: Boolean(out.querySelector('h3')),
        hasStrong: Boolean(out.querySelector('strong')),
        hasListItem: Boolean(out.querySelector('li')),
        katexCount: out.querySelectorAll('.katex').length,
        hasDisplayMath: Boolean(out.querySelector('.katex-display')),
        hasScriptTag: Boolean(out.querySelector('script')),
        hasOnClickAttr: Boolean(out.querySelector('[onclick]')),
        xssExecuted: Boolean(window.__xss),
        rawText: out.dataset.rawText || '',
      };
    });

    assert.equal(rendered.hasHeading, true, 'Markdown heading should render as <h3>');
    assert.equal(rendered.hasStrong, true, 'Markdown bold should render as <strong>');
    assert.equal(rendered.hasListItem, true, 'Markdown list should render as <li>');
    assert.ok(rendered.katexCount >= 3, 'Inline (with subscripts) and block LaTeX should render via KaTeX');
    assert.equal(rendered.hasDisplayMath, true, 'Block formula should render with .katex-display');
    assert.equal(rendered.hasScriptTag, false, 'Script tags must be sanitized');
    assert.equal(rendered.hasOnClickAttr, false, 'Inline event handlers must be sanitized');
    assert.equal(rendered.xssExecuted, false, 'Injected script must never execute');
    assert.match(rendered.rawText, /\$E = mc\^2\$/, 'Raw Markdown/LaTeX should be preserved for copy');

    const shotPath = await captureAcceptanceScreenshot(panel, 'issue-2-markdown-katex.png');
    assert.ok(fs.statSync(shotPath).size > 1000, 'Acceptance screenshot should be non-empty');

    await panel.close();
    await arxivPage.close();
  });

  issueTest(3, 'guards empty paper context and extracts metadata from arXiv HTML, bioRxiv, and PubMed', async () => {
    env.state.responseMode = 'default';
    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    // Empty paper state must block outbound LLM calls
    await panel.evaluate(async () => {
      await chrome.storage.session?.clear();
    });
    await panel.reload({ waitUntil: 'domcontentloaded' });

    env.state.recordedRequests.length = 0;
    const tldrDisabled = await panel.isDisabled('#btn-tldr');
    if (!tldrDisabled) {
      await panel.click('#btn-tldr');
      await panel.click('#btn-critique');
    }
    assert.equal(env.state.recordedRequests.length, 0, 'Empty paper must not trigger AI call');
    const guardMsg = await panel.textContent('#overview-output');
    assert.match(guardMsg || '', /未检测到论文标题或摘要/);

    // Manual abstract paste fallback should populate paper card
    await panel.click('#manual-paper-details summary');
    await panel.fill('#input-manual-title', 'Manual PDF Paper Title');
    await panel.fill('#input-manual-abstract', 'Manual abstract content.');
    await panel.click('#btn-apply-manual-paper');
    assert.equal(await panel.textContent('#paper-title'), 'Manual PDF Paper Title');

    // Verify extraction across arXiv HTML, bioRxiv, and PubMed
    const sites = [
      { url: FIXTURE_URLS.arxivHtml, expectedTitle: 'FlashAttention-3' },
      { url: FIXTURE_URLS.biorxiv, expectedTitle: 'Single-Cell Foundation Models' },
      { url: FIXTURE_URLS.pubmed, expectedTitle: 'High-Fidelity CRISPR-Cas9' },
    ];

    for (const site of sites) {
      const page = await env.context.newPage();
      await page.goto(site.url, { waitUntil: 'networkidle' });
      await panel.waitForFunction(
        (expected) => document.querySelector('#paper-title')?.textContent?.includes(expected),
        site.expectedTitle,
        { timeout: 5000 }
      );
      await page.close();
    }
    assert.ok(await panel.isVisible('#btn-refresh-paper'), 'Refresh paper button must be visible');
    const shotPath = await captureAcceptanceScreenshot(panel, 'issue-3-academic-metadata.png');
    assert.ok(fs.statSync(shotPath).size > 1000, 'Issue #3 screenshot should be non-empty');

    await panel.close();
  });

  issueTest(4, 'isolates paper metadata per tabId and updates Side Panel when switching tabs', async () => {
    const page1 = await env.context.newPage();
    await page1.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    const page2 = await env.context.newPage();
    await page2.goto(FIXTURE_URLS.arxivAbsSecond, { waitUntil: 'networkidle' });

    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await page1.bringToFront();
    await panel.waitForFunction(
      () => document.querySelector('#paper-title')?.textContent?.includes('Attention Is All You Need Again'),
      undefined,
      { timeout: 5000 }
    );

    await page2.bringToFront();
    await panel.waitForFunction(
      () => document.querySelector('#paper-title')?.textContent?.includes('Sparse Mixture of Experts'),
      undefined,
      { timeout: 5000 }
    );
    await captureAcceptanceScreenshot(panel, 'issue-4-tab-sync.png');

    await panel.close();
    await page1.close();
    await page2.close();
  });

  issueTest(5, 'allows direct editing in selection input and supports multi-turn follow-up questions', async () => {
    env.state.responseMode = 'default';
    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.click('[data-tab="tab-selection"]');
    const editable = panel.locator('#selected-text-preview');
    await editable.fill('KL(P || Q) = sum P(x) log(P(x)/Q(x))');

    await panel.click('#btn-explain-formula');
    await panel.waitForFunction(
      () => document.querySelector('#selection-output')?.textContent?.includes('从噪声中还原'),
      undefined,
      { timeout: 5000 }
    );

    // Follow-up input must exist and include prior assistant turn in next API call
    const followUpInput = panel.locator('[data-testid="selection-followup-input"]');
    const followUpBtn = panel.locator('[data-testid="selection-followup-send"]');
    await followUpInput.fill('What happens when Q(x) approaches 0?');

    env.state.recordedRequests.length = 0;
    await followUpBtn.click();
    await panel.waitForFunction(() => env.state?.recordedRequests?.length > 0).catch(() => {});
    await panel.waitForTimeout(300);

    assert.ok(env.state.recordedRequests.length >= 1, 'Follow-up should send a request');
    const lastMessages = env.state.recordedRequests.at(-1).body.messages;
    assert.ok(
      lastMessages.some((m) => m.role === 'assistant'),
      'Multi-turn request must include prior assistant turn'
    );
    await captureAcceptanceScreenshot(panel, 'issue-5-editable-followup.png');

    // Verify reset clears history & output
    await panel.click('[data-testid="selection-reset"]');
    assert.match(
      (await panel.textContent('#selection-output')) || '',
      /等待生成直觉解读/
    );

    await panel.close();
  });

  issueTest(6, 'clamps floating capsule inside viewport, accepts short formulas, and avoids non-academic noise', async () => {
    // Top-right edge selection should keep capsule within viewport
    const arxivPage = await env.context.newPage();
    await arxivPage.setViewportSize({ width: 900, height: 600 });
    await arxivPage.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    await arxivPage.evaluate(() => {
      const el = document.getElementById('top-edge-text');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await arxivPage.waitForSelector('#paper-pilot-capsule-root', { timeout: 3000 });
    const box = await arxivPage.evaluate(() => {
      const root = document.getElementById('paper-pilot-capsule-root');
      const rect = root.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    assert.ok(box.top >= 0 && box.left >= 0, 'Capsule must not clip off top/left edge');
    assert.ok(box.right <= box.vw && box.bottom <= box.vh, 'Capsule must stay inside viewport');
    await captureAcceptanceScreenshot(arxivPage, 'issue-6-capsule-viewport.png', {
      width: 900,
      height: 600,
    });

    // Short academic term like "LoRA" (4 chars) should trigger capsule
    await arxivPage.evaluate(() => {
      const el = document.getElementById('short-term');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await arxivPage.waitForSelector('#paper-pilot-capsule-root', { timeout: 3000 });
    await arxivPage.close();

    // Non-academic page should not show capsule by default
    const newsPage = await env.context.newPage();
    await newsPage.goto(FIXTURE_URLS.nonAcademic, { waitUntil: 'networkidle' });
    await newsPage.evaluate(() => {
      const el = document.getElementById('news-para');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await newsPage.waitForTimeout(200);
    const hasCapsuleOnNews = await newsPage.evaluate(
      () => Boolean(document.getElementById('paper-pilot-capsule-root'))
    );
    assert.equal(hasCapsuleOnNews, false, 'Non-academic site should not show capsule by default');
    await newsPage.close();
  });

  issueTest(7, 'provides Stop button for in-flight inference and displays thinking/reasoning status', async () => {
    env.state.responseMode = 'reasoning_slow';
    env.state.slowDelayMs = 2000;

    const arxivPage = await env.context.newPage();
    await arxivPage.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await panel.waitForFunction(() =>
      document.querySelector('#paper-title')?.textContent?.includes('Attention Is All You Need Again')
    );

    await panel.click('#btn-tldr');
    const stopBtn = panel.locator('[data-testid="btn-stop-inference"]');
    await stopBtn.waitFor({ state: 'visible', timeout: 2000 });
    await stopBtn.click();

    await panel.waitForFunction(
      () => !document.querySelector('[data-testid="btn-stop-inference"]')?.offsetParent,
      undefined,
      { timeout: 2000 }
    );

    // Verify fast reasoning_content collapsible rendering
    env.state.slowDelayMs = 50;
    await panel.click('#btn-tldr');
    await panel.waitForFunction(() =>
      document.querySelector('#overview-output')?.textContent?.includes('梯度下降收敛')
    );
    const reasoningVisible = await panel.isVisible('#overview-reasoning');
    assert.equal(reasoningVisible, true, 'Collapsible reasoning block should appear');
    const reasoningSummary = await panel.textContent('#overview-reasoning-summary');
    assert.match(reasoningSummary || '', /思考过程（耗时/);
    await captureAcceptanceScreenshot(panel, 'issue-7-stop-and-reasoning.png');

    await panel.close();
    await arxivPage.close();
  });

  issueTest(8, 'tracks unsaved settings, toggles API key visibility, and allows quick model switching', async () => {
    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.click('[data-tab="tab-settings"]');
    await panel.click('[data-testid="btn-toggle-api-key"]');
    assert.equal(await panel.getAttribute('#input-api-key', 'type'), 'text');

    // Quick model selector in header should list Magpie models & switch directly
    const quickModel = panel.locator('[data-testid="quick-model-select"]');
    await quickModel.waitFor({ state: 'visible', timeout: 3000 });
    await quickModel.selectOption('auto/gemini-3.8-flash');
    assert.equal(await panel.inputValue('#input-model'), 'auto/gemini-3.8-flash');
    await captureAcceptanceScreenshot(panel, 'issue-8-settings-quick-model.png');

    await panel.close();
  });

  issueTest(9, 'adapts colors cleanly under dark color-scheme preference', async () => {
    const panel = await env.context.newPage();
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    const bgRgb = await panel.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const match = bgRgb.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const luminance = (0.299 * match[0] + 0.587 * match[1] + 0.114 * match[2]) / 255;
    assert.ok(luminance < 0.35, `Expected dark background under dark mode, got ${bgRgb}`);
    await captureAcceptanceScreenshot(panel, 'issue-9-dark-mode.png');

    await panel.close();
  });

  issueTest(10, 'supports output language switch and custom system prompt in settings', async () => {
    env.state.responseMode = 'default';
    const arxivPage = await env.context.newPage();
    await arxivPage.goto(FIXTURE_URLS.arxivAbs, { waitUntil: 'networkidle' });

    const panel = await env.context.newPage();
    await panel.goto(env.sidepanelUrl, { waitUntil: 'domcontentloaded' });

    await panel.click('[data-tab="tab-settings"]');
    await panel.selectOption('[data-testid="select-output-language"]', 'en');
    await panel.fill('[data-testid="input-custom-prompt"]', 'Always include Big-O complexity.');
    await panel.click('#btn-save-settings');

    await panel.click('[data-tab="tab-overview"]');
    env.state.recordedRequests.length = 0;
    await panel.click('#btn-tldr');
    await panel.waitForFunction(
      () => document.querySelector('#overview-output')?.textContent?.includes('简化噪声调度目标'),
      undefined,
      { timeout: 5000 }
    );

    const sysMsg = env.state.recordedRequests.at(-1).body.messages.find((m) => m.role === 'system')?.content || '';
    assert.match(sysMsg, /English|english|Always include Big-O complexity/);

    await panel.close();
    await arxivPage.close();
  });
});
