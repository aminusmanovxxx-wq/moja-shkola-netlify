import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/assistant.mjs';

const makeRequest = (body, method = 'POST') => new Request('http://localhost/.netlify/functions/assistant', {
  method,
  headers: { 'content-type': 'application/json' },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});

test('ИИ endpoint only accepts POST', async () => {
  const response = await handler(makeRequest({}, 'GET'), { ip: 'test-method' });
  assert.equal(response.status, 405);
});

test('ИИ endpoint rejects unknown operation names', async () => {
  const response = await handler(makeRequest({ type: 'guess' }), { ip: 'test-type' });
  assert.equal(response.status, 400);
});

test('protected schedule import is disabled when a server PIN is not configured', async () => {
  delete globalThis.Netlify;
  const response = await handler(makeRequest({ type: 'analyze_schedule', adminImport: true, adminPin: '1414', text: 'Пн: Математика' }), { ip: 'test-pin-missing' });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'PIN_NOT_CONFIGURED');
});

test('AI features report the missing server key instead of returning fake answers', async () => {
  delete globalThis.Netlify;
  const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-key-missing' });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'AI_NOT_CONFIGURED');
});


test('ordinary schedule analysis does not require the admin PIN', async () => {
  delete globalThis.Netlify;
  const response = await handler(makeRequest({ type: 'analyze_schedule', text: 'Пн — 1. Математика' }), { ip: 'test-regular-schedule' });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'AI_NOT_CONFIGURED');
});
