import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('replace mode cannot be emitted as a partial restore', async () => {
  const source = await read('src/components/RestoreModal.svelte');

  // The CLI rejects --replace together with --only because selective restore
  // must leave excluded applications untouched. Keep the UI contract aligned:
  // enabling Replace restores every resource and submit emits no `only` list.
  assert.match(source, /if \(checked\) selectedResources = \[\.\.\.allResourceKeys\]/);
  assert.match(source, /only: replace \|\| selectedResources\.length === resourceOptions\.length/);
  assert.match(source, /disabled=\{replace\}/);
});
