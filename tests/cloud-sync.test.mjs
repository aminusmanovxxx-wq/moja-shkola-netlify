import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../netlify/functions/cloud-sync.mjs', import.meta.url), 'utf8');

test('cloud sync validates a high-entropy sync token and bounds payload size', () => {
  assert.match(source, /x-sync-token/i);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(source, /200_000/);
  assert.match(source, /setJSON/);
  assert.match(source, /get\(token, \{ type: "json" \}\)/);
});
