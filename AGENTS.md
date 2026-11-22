# PaperPilot — AGENTS.md

This file provides guidance to AI coding agents working in the `paper-pilot` repository.

## Project Overview

**PaperPilot** (`v1.0.0`) is a Chrome Manifest V3 browser extension built with **WXT** and **TypeScript**. It provides a persistent **Chrome Side Panel** companion for reading academic papers (e.g., arXiv, bioRxiv, PubMed) using a **BYOK (Bring Your Own Key)** architecture—all API keys stay in `chrome.storage.local` and LLM requests are sent directly from the extension to the configured AI provider with no intermediate backend.

## Tech Stack & Dependencies

- **Framework**: [WXT](https://wxt.dev) (`^0.19.0`)
- **Language**: TypeScript (`^5.4.5`, `"strict": true`, ESM `"type": "module"`)
- **Types & Testing**: `@types/chrome`, `@types/node`, `playwright-core` (for Ego/Chromium E2E tests in `tests/e2e/paper-pilot.e2e.mjs`)
- **UI & Rendering**: Vanilla TypeScript + HTML/CSS (`entrypoints/sidepanel/`) with `marked` + `dompurify` + `katex` (`src/utils/markdown.ts`) bundled locally (no frontend framework or TailwindCSS).
- **Path Resolution**: `tsconfig.json` defines `@/* -> ./src/*`, while WXT defaults `srcDir` to the repo root (`.` -> `@/*` maps to `./*` during Vite bundling). Entrypoints under `entrypoints/` import shared modules from `src/` via relative paths (e.g., `../../src/services/storage`).

## Repository Structure

```text
paper-pilot/
├── wxt.config.ts                       # WXT & Manifest V3 configuration (permissions, host_permissions, Alt+P shortcut)
├── package.json                        # Scripts and devDependencies
├── tsconfig.json                       # TypeScript config (@/* -> ./src/*; includes .wxt/types/**)
├── README.md                           # Project overview and local setup
├── .github/workflows/
│   └── build-extension.yml             # CI: install, typecheck, build, zip, upload artifact
├── docs/
│   ├── 01-PRD-REQUIREMENTS.md          # Product requirements & CWS compliance goals
│   ├── 02-ARCHITECTURE.md              # Architecture & message protocol design
│   ├── 03-GITHUB-ISSUES-ROADMAP.md     # Milestone roadmap (#1–#13)
│   └── 04-STORE-PUBLISHING-GUIDE.md    # Chrome Web Store review & assets checklist
├── entrypoints/
│   ├── background.ts                   # MV3 Service Worker: sidePanel behavior & OPEN_SIDEPANEL_REQUEST handler
│   ├── content.ts                      # Content Script: Shadow DOM selection capsule & arXiv /abs/ metadata extraction
│   └── sidepanel/
│       ├── index.html                  # 3-tab Side Panel UI (tab-overview, tab-selection, tab-settings)
│       ├── main.ts                     # Side Panel state, DOM bindings, runtime message listener, streaming UI
│       └── style.css                   # Side Panel CSS
└── src/
    └── services/
        ├── storage.ts                  # UserConfig, PROVIDER_DEFAULTS, chrome.storage.local read/write
        └── ai.ts                       # ACADEMIC_PROMPTS, streamAIChat(), parseSSE()
└── tests/
    └── e2e/
        ├── helpers/
        │   └── acceptance-env.mjs      # Ego/Chromium E2E context, academic & LLM SSE fixtures
        ├── verify-bundle.mjs           # MV3 manifest, bundle size (<3MB), and CSP compliance gate
        ├── paper-pilot.e2e.mjs         # Baseline E2E regression suite
        └── issues-acceptance.e2e.mjs   # Per-issue acceptance matrix (#2–#10, gated by VERIFY_ISSUES)
```

## Common Commands

```bash
# Install dependencies
npm install

# Type-check (run `npx wxt prepare` first if `.wxt/types` does not exist yet)
npx wxt prepare
npm run compile

# Start dev server with HMR (outputs unpacked extension to .output/chrome-mv3)
npm run dev
npm run dev:firefox

# Production build & store zip bundle
npm run build
npm run build:firefox
npm run zip

# End-to-end tests & full verification pipeline (see docs/ACCEPTANCE-CRITERIA.md)
npm run verify
npm run test:e2e
VERIFY_ISSUES=2 npm run verify:acceptance
```

To test in Chrome manually: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3`.

## Architecture & Conventions

### 1. Contexts & Message Passing
- **Background (`entrypoints/background.ts`)**: Enables `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, opens the Side Panel on `OPEN_SIDEPANEL_REQUEST` using `sender.tab.id`, and caches `PAPER_METADATA_EXTRACTED` / `SELECTION_TEXT_CAPTURED` in `chrome.storage.session` (`latestPaperData`, `latestSelection`) so cold-started Side Panel sessions receive captured context on mount.
- **Content Script (`entrypoints/content.ts`)**:
  - Must render injected page UI inside a **Shadow DOM** (`#paper-pilot-capsule-root` with `attachShadow({ mode: 'open' })`) so host page CSS cannot break or leak into the floating `"Ask PaperPilot"` capsule.
  - Emits `OPEN_SIDEPANEL_REQUEST` + `SELECTION_TEXT_CAPTURED` on capsule click, and `PAPER_METADATA_EXTRACTED` on `arxiv.org/abs/*` pages.
- **Side Panel (`entrypoints/sidepanel/main.ts`)**:
  - Hydrates cached paper metadata and pending selection from `chrome.storage.session` on `init()`, and listens via `chrome.runtime.onMessage` for live updates.
  - Uses a shared `AbortController` (`activeAbortController`) to cancel in-flight streaming inference when a new request is triggered.

### 2. BYOK AI & Storage (`src/services/`)
- `storage.ts` persists `UserConfig` under `chrome.storage.local` key `paper_pilot_config`.
- Supported `ProviderType` values: `'magpie' | 'deepseek' | 'openai' | 'anthropic' | 'ollama'` (defaults to local Magpie gateway at `http://127.0.0.1:3425/v1`).
- `ai.ts` normalizes trailing slashes and `/v1` suffixes on `baseUrl` and handles SSE streaming (`parseSSE`) for both:
  - Anthropic Messages API (`x-api-key`, `anthropic-version: 2023-06-01`, `dangerously-allow-browser: true`)
  - OpenAI-compatible Chat Completions API (Magpie, DeepSeek, OpenAI, and Ollama)
- **Privacy & CWS Compliance**: Never send API keys, browsing history, or paper text to any third-party proxy or telemetry endpoint. Keep `manifest.permissions` minimal (`sidePanel`, `storage`, `activeTab`) and declare required API origins in `wxt.config.ts` `host_permissions`.

## Known Discrepancies / Remaining Technical Debt

Agents picking up tasks in this repo should be aware of the following remaining items:
1. **Content Script Match Scope**: `entrypoints/content.ts` includes `'<all_urls>'` in `matches`, whereas `docs/01-PRD-REQUIREMENTS.md` recommends avoiding `<all_urls>` for Chrome Web Store review compliance.
2. **Extension Icons**: `docs/04-STORE-PUBLISHING-GUIDE.md` expects `16`/`48`/`128` px PNG icons in the manifest; currently only `assets/icon.svg` exists and `wxt.config.ts` does not configure `icons`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`modeyang/paper-pilot`, via `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.
