import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('full Save application chooser scrolls internally without a visible scrollbar', async () => {
  const main = await read('src/main.ts');
  const css = await read('src/full-save-scroll.css');
  const save = await read('src/components/SaveModal.svelte');

  assert.match(main, /import '\.\/full-save-scroll\.css';/);
  assert.match(css, /html\[data-window-mode='full'\] \.app-check-list \{[\s\S]*max-height: min\(280px, 38vh\);[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;[\s\S]*scrollbar-width: none;[\s\S]*-ms-overflow-style: none;/);
  assert.match(css, /html\[data-window-mode='full'\] \.app-check-list::\-webkit-scrollbar \{[\s\S]*width: 0;[\s\S]*height: 0;[\s\S]*display: none;/);
  assert.match(save, /class="app-check-list"/);
});
