import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/assistant.mjs';

const makeRequest = (body, method = 'POST') => new Request('http://localhost/.netlify/functions/assistant', {
  method,
  headers: { 'content-type': 'application/json' },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});

const envKeys = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_MODEL', 'SCHEDULE_ADMIN_PIN'];
async function withoutCloudflareConfig(callback) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  try {
    return await callback();
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('ИИ endpoint only accepts POST', async () => {
  const response = await handler(makeRequest({}, 'GET'), { ip: 'test-method' });
  assert.equal(response.status, 405);
});

test('ИИ endpoint rejects unknown operation names', async () => {
  const response = await handler(makeRequest({ type: 'guess' }), { ip: 'test-type' });
  assert.equal(response.status, 400);
});

test('protected schedule import is disabled when a server PIN is not configured', async () => {
  await withoutCloudflareConfig(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'analyze_schedule', adminImport: true, adminPin: '1414', text: 'Пн: Математика' }), { ip: 'test-pin-missing' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'PIN_NOT_CONFIGURED');
  });
});

test('AI endpoint reports missing Cloudflare credentials instead of returning fake answers', async () => {
  await withoutCloudflareConfig(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-key-missing' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_NOT_CONFIGURED');
  });
});

test('ordinary schedule analysis does not require the admin PIN', async () => {
  await withoutCloudflareConfig(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'analyze_schedule', text: 'Пн — 1. Математика' }), { ip: 'test-regular-schedule' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_NOT_CONFIGURED');
  });
});

test('Cloudflare Workers AI provider uses the secret server token and returns JSON result', async () => {
  const previous = Object.fromEntries(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_MODEL'].map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  process.env.CLOUDFLARE_API_TOKEN = 'test-token-not-real';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32);
  process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';
  delete globalThis.Netlify;

  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json({
      id: 'cf-test',
      model: '@cf/google/gemma-4-26b-a4b-it',
      choices: [{ message: { role: 'assistant', content: JSON.stringify({
        answer: '4', explanation: 'Два плюс два равно четырём.', steps: [], check: 'Сосчитай по одному.'
      }) }, finish_reason: 'stop', index: 0 }],
    });
  };

  try {
    const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-cloudflare' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.answer, '4');
    assert.equal(body.model, '@cf/google/gemma-4-26b-a4b-it');
    assert.match(captured.url, /accounts\/[a-f0-9]{32}\/ai\/v1\/chat\/completions$/);
    assert.equal(captured.options.headers.get('authorization'), 'Bearer test-token-not-real');
    assert.equal(captured.body.model, '@cf/google/gemma-4-26b-a4b-it');
    assert.equal(captured.body.messages[1].content.some(part => part.type === 'text' && part.text.includes('Сколько будет 2+2?')), true);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_MODEL']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
