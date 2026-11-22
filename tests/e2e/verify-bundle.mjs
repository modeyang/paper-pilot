import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_PATH } from './helpers/acceptance-env.mjs';

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('MV3 Build & Compliance Gate', () => {
  test('manifest.json declares MV3 sidePanel, minimal permissions, and valid entrypoints', () => {
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist in .output/chrome-mv3');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.side_panel?.default_path, 'side_panel.default_path must be configured');
    assert.ok(
      fs.existsSync(path.join(EXTENSION_PATH, manifest.side_panel.default_path)),
      'side_panel.default_path target file must exist'
    );
    assert.ok(manifest.background?.service_worker, 'background.service_worker must be configured');
    assert.ok(
      fs.existsSync(path.join(EXTENSION_PATH, manifest.background.service_worker)),
      'background.service_worker target file must exist'
    );

    const allowedPermissions = new Set(['sidePanel', 'storage', 'activeTab', 'tabs']);
    for (const perm of manifest.permissions || []) {
      assert.ok(
        allowedPermissions.has(perm),
        `Unexpected permission "${perm}" — keep permissions minimal for CWS compliance`
      );
    }
  });

  test('extension bundle stays under 3MB (PRD NFR)', () => {
    const files = walkDir(EXTENSION_PATH);
    const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
    assert.ok(
      totalBytes < 3 * 1024 * 1024,
      `Bundle size ${totalBytes} bytes exceeds 3MB limit`
    );
  });

  test('HTML entrypoints contain no remote CDN script/stylesheet tags (MV3 CSP)', () => {
    const htmlFiles = walkDir(EXTENSION_PATH).filter((f) => f.endsWith('.html'));
    assert.ok(htmlFiles.length > 0, 'At least one HTML entrypoint should exist');
    for (const htmlFile of htmlFiles) {
      const content = fs.readFileSync(htmlFile, 'utf8');
      assert.doesNotMatch(
        content,
        /<(script|link)[^>]+(src|href)=["']https?:\/\//i,
        `${path.basename(htmlFile)} must not load remote scripts/styles under MV3 CSP`
      );
    }
  });
});
