import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/assistant.mjs';

const makeRequest = (body, method = 'POST') => new Request('http://localhost/.netlify/functions/assistant', {
  method,
  headers: { 'content-type': 'application/json' },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});

const envKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'SCHEDULE_ADMIN_PIN'];
async function withoutGatewayConfig(callback) {
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
  await withoutGatewayConfig(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'analyze_schedule', adminImport: true, adminPin: '1414', text: 'Пн: Математика' }), { ip: 'test-pin-missing' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'PIN_NOT_CONFIGURED');
  });
});

test('AI Gateway reports first-deploy activation requirement rather than returning fake answers', async () => {
  await withoutGatewayConfig(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-gateway-missing' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_GATEWAY_NOT_READY');
  });
});

test('ordinary schedule analysis does not require the admin PIN', async () => {
  await withoutGatewayConfig(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'analyze_schedule', text: 'Пн — 1. Математика' }), { ip: 'test-regular-schedule' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_GATEWAY_NOT_READY');
  });
});

test('Netlify AI Gateway SDK receives runtime-injected credentials and returns structured JSON', async () => {
  const previous = Object.fromEntries(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'].map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'gateway-test-key-not-real';
  process.env.OPENAI_BASE_URL = 'https://gateway.example.test/v1';
  delete process.env.OPENAI_MODEL;
  delete globalThis.Netlify;

  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json({
      id: 'gateway-test',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        answer: '4', explanation: 'Два плюс два равно четырём.', steps: [], check: 'Сосчитай по одному.'
      }) } }],
    });
  };

  try {
    const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-netlify-gateway' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.answer, '4');
    assert.equal(body.model, 'gpt-4o-mini');
    assert.match(captured.url, /gateway\.example\.test\/v1\/chat\/completions$/);
    assert.equal(captured.options.headers.get('authorization'), 'Bearer gateway-test-key-not-real');
    assert.equal(captured.body.model, 'gpt-4o-mini');
    assert.equal(captured.body.response_format.type, 'json_object');
    assert.equal(captured.body.messages.some(message => JSON.stringify(message.content).includes('Сколько будет 2+2?')), true);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
