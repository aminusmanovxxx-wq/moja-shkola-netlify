import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const validToken = token => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

export default async (request) => {
  if (!["POST", "PUT"].includes(request.method)) return json({ error: "Используй POST или PUT." }, 405);
  const token = request.headers.get("x-sync-token") || "";
  if (!validToken(token)) return json({ error: "Неверный облачный код." }, 401);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Некорректный JSON." }, 400); }
  const store = getStore({ name: "moja-shkola-user-sync", consistency: "strong" });
  if (request.method === "POST") {
    const data = await store.get(token, { type: "json" });
    if (!data) return json({ error: "Пока нет сохранённых данных в облаке." }, 404);
    return json({ ok: true, data });
  }
  if (!payload || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) return json({ error: "Нет данных для сохранения." }, 400);
  const serialized = JSON.stringify(payload.data);
  if (serialized.length > 200_000) return json({ error: "Облачная копия превышает лимит 200 КБ." }, 413);
  await store.setJSON(token, payload.data);
  return json({ ok: true, savedAt: new Date().toISOString() });
};
