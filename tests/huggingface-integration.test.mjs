import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

test('AI view exposes a dedicated SmolVLM photo-analysis mode', () => {
  assert.match(html, /data-ai-mode="local"/);
  assert.match(html, /data-ai-pane="local"/);
  assert.match(html, /SmolVLM 256M/);
});

test('external model iframe is lazy and user-triggered', () => {
  assert.match(html, /id="local-ai-frame"[^>]*data-src="https:\/\/huggingfacetb-smolvlm-256m-instruct-webgpu\.static\.hf\.space\/"[^>]*loading="lazy"/);
  assert.match(app, /frame\.src = frame\.dataset\.src/);
  assert.match(app, /#load-local-model/);
});

test('UI is transparent about cross-origin limitations and local model setup', () => {
  assert.match(html, /нельзя автоматически передать во встроенный фрейм/);
  assert.match(readme, /веса не переобучаются/);
  assert.match(readme, /cross-origin iframe/);
});

test('AI embed gets responsive styling', () => {
  assert.match(css, /\.local-ai-frame-wrap iframe\{display:block;width:100%;height:100%;border:0;background:#fff\}/);
  assert.match(css, /\.local-ai-frame-wrap\{height:62dvh;min-height:380px\}/);
});


test('text analyzers and cloud sync UI are wired and transparent', () => {
  assert.match(app, /parseHomeworkTextLocally/);
  assert.match(app, /parseScheduleTextLocally/);
  assert.match(app, /Черновик разбора · без ИИ/);
  assert.match(html, /Облачная синхронизация/);
  assert.match(html, /id="connect-cloud-sync"/);
  assert.match(app, /\.netlify\/functions\/cloud-sync/);
  assert.match(css, /\.script-accent/);
});
