import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/assistant.mjs';

const makeRequest = (body, method = 'POST') => new Request('http://localhost/.netlify/functions/assistant', {
  method,
  headers: { 'content-type': 'application/json' },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});

async function withoutAiKeys(callback) {
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await callback();
  } finally {
    if (oldGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGemini;
    if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAI;
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
  delete globalThis.Netlify;
  const response = await handler(makeRequest({ type: 'analyze_schedule', adminImport: true, adminPin: '1414', text: 'Пн: Математика' }), { ip: 'test-pin-missing' });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'PIN_NOT_CONFIGURED');
});

test('AI endpoint reports missing server keys instead of returning fake answers', async () => {
  await withoutAiKeys(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-key-missing' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_NOT_CONFIGURED');
  });
});

test('ordinary schedule analysis does not require the admin PIN', async () => {
  await withoutAiKeys(async () => {
    delete globalThis.Netlify;
    const response = await handler(makeRequest({ type: 'analyze_schedule', text: 'Пн — 1. Математика' }), { ip: 'test-regular-schedule' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_NOT_CONFIGURED');
  });
});

test('Gemini provider keeps its API key server-side and parses JSON responses', async () => {
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldModel = process.env.GEMINI_MODEL;
  const oldFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete globalThis.Netlify;

  let observedRequest;
  globalThis.fetch = async (url, options) => {
    observedRequest = { url: String(url), options, payload: JSON.parse(options.body) };
    return Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        answer: '4', explanation: 'Два плюс два равно четырём.', steps: [], check: 'Посчитай по одному.'
      }) }] } }]
    });
  };

  try {
    const response = await handler(makeRequest({ type: 'chat', question: 'Сколько будет 2+2?' }), { ip: 'test-gemini-key' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.model, 'gemini-3.5-flash-lite');
    assert.equal(body.result.answer, '4');
    assert.match(observedRequest.url, /models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(observedRequest.options.headers['x-goog-api-key'], 'test-key-not-real');
    assert.equal(observedRequest.payload.generationConfig.responseMimeType, 'application/json');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGemini;
    if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAI;
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
  }
});
