import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';

interface MathToken {
  expr: string;
  displayMode: boolean;
}

const MATH_PLACEHOLDER_RE = /<span data-pp-math="(\d+)"><\/span>/g;

/**
 * Renders Markdown + LaTeX ($...$, $$...$$, \(...\), \[...\]) safely into HTML.
 * Protects code spans/blocks from math parsing, protects math from Markdown
 * emphasis rules, sanitizes HTML via DOMPurify, and renders math locally via KaTeX.
 */
export function renderMarkdownWithMath(input: string): string {
  if (!input) return '';

  const codeTokens: string[] = [];
  const mathTokens: MathToken[] = [];

  // 1. Mask fenced code blocks and inline code spans so $ inside code is untouched
  let masked = input.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const idx = codeTokens.push(match) - 1;
    return `PPXCODE${idx}XEND`;
  });

  const stashMath = (expr: string, displayMode: boolean): string => {
    const idx = mathTokens.push({ expr, displayMode }) - 1;
    return `<span data-pp-math="${idx}"></span>`;
  };

  // 2. Extract block math ($$...$$ and \[...\]) before inline math
  masked = masked.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => stashMath(expr, true));
  masked = masked.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr: string) => stashMath(expr, true));

  // 3. Extract inline math (\(...\) and $...$)
  masked = masked.replace(/\\\(([^\n]+?)\\\)/g, (_, expr: string) => stashMath(expr, false));
  masked = masked.replace(/(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_, expr: string) =>
    stashMath(expr, false)
  );

  // 4. Restore code blocks/spans before Markdown parsing
  const restoredForMarkdown = masked.replace(/PPXCODE(\d+)XEND/g, (_, idxStr: string) => {
    return codeTokens[Number(idxStr)] ?? '';
  });

  // 5. Parse Markdown synchronously and sanitize untrusted HTML
  const parsedHtml = marked.parse(restoredForMarkdown, {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;

  const cleanHtml = DOMPurify.sanitize(parsedHtml, {
    USE_PROFILES: { html: true },
  });

  // 6. Substitute math placeholders with KaTeX output (trust: false prevents \url XSS)
  return cleanHtml.replace(MATH_PLACEHOLDER_RE, (_, idxStr: string) => {
    const token = mathTokens[Number(idxStr)];
    if (!token) return '';
    return katex.renderToString(token.expr.trim(), {
      displayMode: token.displayMode,
      throwOnError: false,
      trust: false,
    });
  });
}

/**
 * Renders Markdown + LaTeX into an output element and preserves raw text for copy.
 */
export function renderMarkdownInto(targetEl: HTMLElement, markdown: string): void {
  targetEl.dataset.rawText = markdown;
  targetEl.innerHTML = renderMarkdownWithMath(markdown);
}
