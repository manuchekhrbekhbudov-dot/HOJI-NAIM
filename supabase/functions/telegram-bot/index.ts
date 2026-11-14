// HOJI-NAIM CARGO — Telegram bot (Supabase Edge Function «telegram-bot»).
// One function, three kinds of requests:
//   1. Telegram webhook (header X-Telegram-Bot-Api-Secret-Token): /start, customer code (e.g. S-50), «Қарзи ман».
//   2. Database events from pg_net triggers (header x-hook-secret): arrived / paid / delivered.
//   3. The website (Authorization: Bearer <staff session>): manual send, bot info.
// Secrets (Supabase → Edge Functions → Secrets): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, HOOK_SECRET.
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are provided by Supabase.
// Deploy with «Verify JWT» turned OFF (Telegram cannot send a Supabase JWT); this code checks every caller itself.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function makeHandler(env, fetchFn = fetch) {
  const API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const rest = `${env.SUPABASE_URL}/rest/v1`;
  const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", ...(String(env.SUPABASE_SERVICE_ROLE_KEY).startsWith("sb_") ? {} : { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }) };

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  const db = async (path, init = {}) => {
    const r = await fetchFn(`${rest}/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`db ${path.split("?")[0]}: ${r.status} ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const tg = async (method, body) => {
    const r = await fetchFn(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `telegram ${r.status}`);
    return j.result;
  };

  const digits = s => String(s || "").replace(/\D/g, "");
  const phoneKey = s => digits(s).slice(-9);
  const money = n => { const [i, f] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + f; };
  const qty = (n, d = 2) => String(Math.round((Number(n) || 0) * 10 ** d) / 10 ** d);
  const note = (s, key) => { const m = String(s.notes || "").split(";").map(x => x.trim()).find(x => x.toLowerCase().startsWith(key.toLowerCase() + ":")); return m ? m.slice(m.indexOf(":") + 1).trim() : ""; };
  const places = s => Number(note(s, "Ҷойҳо")) || 1;
  // Customer code as typed ("S-50", "s 50", Cyrillic "С-50" → "S50"): Cyrillic letters map to Latin by sound.
  const LOOK = { "А": "A", "Б": "B", "В": "V", "Д": "D", "Е": "E", "З": "Z", "И": "I", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R", "С": "S", "Т": "T", "У": "U", "Ф": "F" };
  const codeKey = v => String(v || "").toUpperCase().replace(/[АБВДЕЗИКЛМНОПРСТУФ]/g, c => LOOK[c]).replace(/[^0-9A-ZА-ЯЁӢӮҚҒҲҶ]/g, "").slice(0, 30);
  const codeOf = s => codeKey(note(s, "Коди муштарӣ"));

  async function shipment(id) {
    const rows = await db(`shipments?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
  }
  async function paidOf(ids) {
    if (!ids.length) return {};
    const rows = await db(`payments?shipment_id=in.(${ids.map(encodeURIComponent).join(",")})&select=shipment_id,amount_tjs`);
    const m = {}; (rows || []).forEach(p => (m[p.shipment_id] = (m[p.shipment_id] || 0) + Number(p.amount_tjs || 0)));
    return m;
  }
  // Subscribers of a shipment: by customer code (main way) or, for old subscriptions, by phone.
  async function subscribersFor(s) {
    const out = new Map(), code = codeOf(s), key = phoneKey(s.client_phone);
    if (code) ((await db(`telegram_subscribers?code_key=eq.${encodeURIComponent(code)}&active=is.true&select=chat_id,first_name`)) || []).forEach(x => out.set(x.chat_id, x));
    if (key.length >= 7) ((await db(`telegram_subscribers?phone_key=eq.${key}&active=is.true&select=chat_id,first_name`)) || []).forEach(x => out.set(x.chat_id, x));
    return [...out.values()];
  }
  const SHIP_COLS = "id,tracking_no,client_name,client_phone,shipment_date,weight_kg,volume_m3,total_tjs,total_original,currency,warehouse_status,notes";
  async function shipmentsByCode(code) {
    // narrow with the longest part of the code (digits usually), then match exactly
    const part = (String(code).match(/[0-9]+|[^0-9]+/g) || [code]).sort((a, b) => b.length - a.length)[0];
    const rows = (await db(`shipments?notes=ilike.*${encodeURIComponent(part)}*&select=${SHIP_COLS}&order=shipment_date.desc&limit=2000`)) || [];
    return rows.filter(s => codeOf(s) === code);
  }
  async function shipmentsFor(sub) {
    if (sub.code_key) return shipmentsByCode(sub.code_key);
    // old subscriptions: shipments whose phone ends with these 9 digits
    const key = sub.phone_key || "";
    if (key.length < 7) return [];
    const rows = (await db(`shipments?client_phone=ilike.*${key.slice(-2)}*&select=${SHIP_COLS}&order=shipment_date.desc&limit=500`)) || [];
    return rows.filter(s => phoneKey(s.client_phone) === key);
  }
  async function log(chat_id, shipment_id, event, text, ok, error = "") {
    try { await db("telegram_log", { method: "POST", body: JSON.stringify({ chat_id, shipment_id, event, text: text.slice(0, 2000), ok, error: String(error).slice(0, 500) }) }); } catch { /* logging must never break sending */ }
  }

  function message(event, s, debt, paidTotal, payment) {
    const usd = s.currency === "USD" ? ` ($${money(s.total_original)})` : "";
    if (event === "arrived") return [
      `📦 Ассалому алейкум${s.client_name ? ", " + s.client_name : ""}!`, "Бори шумо дар Душанбе расид.", "",
      `Рақам: ${s.tracking_no}`, `Ҷой: ${places(s)} · Вазн: ${qty(s.weight_kg, 1)} кг · Ҳаҷм: ${qty(s.volume_m3, 3)} м³`,
      `Маблағ: ${money(s.total_tjs)} сомонӣ${usd}`, paidTotal > 0 ? `Пардохт шуд: ${money(paidTotal)} сомонӣ` : null,
      debt > 0.005 ? `Барои пардохт: ${money(debt)} сомонӣ` : "Бор пурра пардохт шудааст ✅", "", "HOJI-NAIM CARGO",
    ].filter(x => x !== null).join("\n");
    if (event === "paid") return [
      "✅ Пардохт қабул шуд", `Бор: ${s.tracking_no}`, `Маблағ: ${money(payment?.amount_tjs)} сомонӣ`,
      debt > 0.005 ? `Қарзи боқимонда: ${money(debt)} сомонӣ` : "Бор пурра пардохт шуд. Ташаккур!", "", "HOJI-NAIM CARGO",
    ].join("\n");
    if (event === "delivered") return `🤝 Бори ${s.tracking_no} ба шумо супорида шуд.\nТашаккур, ки HOJI-NAIM CARGO-ро интихоб кардед!`;
    return "";
  }

  async function notify(event, shipmentId, paymentId, customText) {
    const s = await shipment(shipmentId);
    if (!s) return { sent: 0, reason: "shipment not found" };
    const subs = await subscribersFor(s);
    if (!subs.length) return { sent: 0, subscribed: false };
    const paid = (await paidOf([s.id]))[s.id] || 0;
    const debt = Math.max(0, Number(s.total_tjs || 0) - paid);
    const payment = paymentId ? (await db(`payments?id=eq.${encodeURIComponent(paymentId)}&select=amount_tjs`))?.[0] : null;
    const text = customText || message(event, s, debt, paid, payment);
    if (!text) return { sent: 0, reason: "unknown event" };
    let sent = 0;
    for (const sub of subs) {
      try { await tg("sendMessage", { chat_id: sub.chat_id, text }); sent++; await log(sub.chat_id, s.id, event, text, true); }
      catch (e) {
        await log(sub.chat_id, s.id, event, text, false, e.message);
        if (/blocked|deactivated|chat not found/i.test(e.message)) await db(`telegram_subscribers?chat_id=eq.${sub.chat_id}`, { method: "PATCH", body: JSON.stringify({ active: false }) }).catch(() => {});
      }
    }
    return { sent, subscribed: true };
  }

  const KEYBOARD = { keyboard: [[{ text: "💰 Қарзи ман" }]], resize_keyboard: true };
  const ASK = "Коди муштарии худро нависед (масалан: S-50).\nКодро аз корманди HOJI-NAIM CARGO гирифтан мумкин аст.";
  async function onTelegram(update) {
    const m = update.message;
    if (!m || !m.chat) return;
    const chat = m.chat.id;
    const say = (text, extra = {}) => tg("sendMessage", { chat_id: chat, text, ...extra });
    const subscribe = async (patch) => db("telegram_subscribers?on_conflict=chat_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ chat_id: chat, first_name: m.from?.first_name || "", username: m.from?.username || "", active: true, ...patch }) });
    const byCode = async (raw) => {
      const code = codeKey(raw);
      if (code.length < 2) return say(ASK, { reply_markup: KEYBOARD });
      const ships = await shipmentsByCode(code);
      if (!ships.length) return say(`Код «${String(raw).trim().slice(0, 30)}» ёфт нашуд. Лутфан кодро санҷед ва боз нависед (масалан: S-50).`, { reply_markup: KEYBOARD });
      await subscribe({ code_key: code, phone: "", phone_key: "" });
      return say(`Ташаккур! Шумо обуна шудед ✅\nКод: ${code} · ${ships.length} бор.\nВақте ки бор мерасад, пардохт қабул мешавад ё бор супорида мешавад, ба шумо хабар медиҳем.\n\nБарои дидани қарз «💰 Қарзи ман»-ро пахш кунед.`, { reply_markup: KEYBOARD });
    };
    if (m.contact) {
      if (m.contact.user_id && m.from && m.contact.user_id !== m.from.id) return say(ASK, { reply_markup: KEYBOARD });
      await subscribe({ phone: m.contact.phone_number, phone_key: phoneKey(m.contact.phone_number) });
      return say("Ташаккур! Шумо обуна шудед ✅", { reply_markup: KEYBOARD });
    }
    const text = String(m.text || "").trim();
    if (text.startsWith("/start")) {
      const payload = text.slice(6).trim();          // t.me/<bot>?start=S-50
      if (payload) return byCode(payload);
      return say("Ассалому алейкум! Ин боти HOJI-NAIM CARGO аст.\n\n" + ASK, { reply_markup: KEYBOARD });
    }
    if (text === "💰 Қарзи ман" || text.startsWith("/qarz") || text.startsWith("/debt")) {
      const sub = (await db(`telegram_subscribers?chat_id=eq.${chat}&select=phone_key,code_key`))?.[0];
      if (!sub) return say(ASK, { reply_markup: KEYBOARD });
      const ships = await shipmentsFor(sub);
      if (!ships.length) return say("Бо коди шумо бор ёфт нашуд.");
      const paid = await paidOf(ships.map(s => s.id));
      let total = 0;
      const lines = ships.slice(0, 30).map(s => { const d = Math.max(0, Number(s.total_tjs || 0) - (paid[s.id] || 0)); total += d; return `• ${s.tracking_no} — ${money(s.total_tjs)}${d > 0.005 ? ` · қарз ${money(d)}` : " · пардохт шуд ✅"}`; });
      ships.slice(30).forEach(s => (total += Math.max(0, Number(s.total_tjs || 0) - (paid[s.id] || 0))));
      return say(`Борҳои шумо (${ships.length}):\n${lines.join("\n")}\n\nҚарзи умумӣ: ${money(total)} сомонӣ`);
    }
    if (text.startsWith("/")) return say(ASK, { reply_markup: KEYBOARD });
    return byCode(text);
  }

  async function staffUser(req) {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return null;
    const r = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY } });
    if (!r.ok) return null;
    const user = await r.json();
    const prof = (await db(`profiles?id=eq.${encodeURIComponent(user.id)}&select=role`))?.[0];
    return ["owner", "admin", "accountant", "operator"].includes(prof?.role) ? user : null;
  }

  return async function handle(req) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ ok: true, service: "HOJI-NAIM telegram-bot" });
    try {
      const body = await req.json().catch(() => ({}));
      // 1. Telegram
      const tgSecret = req.headers.get("x-telegram-bot-api-secret-token");
      if (tgSecret !== null) {
        if (!env.TELEGRAM_WEBHOOK_SECRET || tgSecret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false }, 401);
        await onTelegram(body);
        return json({ ok: true });
      }
      // 2. Database trigger
      const hook = req.headers.get("x-hook-secret");
      if (hook !== null) {
        if (!env.HOOK_SECRET || hook !== env.HOOK_SECRET) return json({ ok: false }, 401);
        if (body.action === "setup") {
          // Connects the bot to this function (same as opening setWebhook in a browser).
          const slug = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "telegram-bot";
          const url = `${env.SUPABASE_URL}/functions/v1/${slug}`;
          await tg("setWebhook", { url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"] });
          await tg("setMyCommands", { commands: [{ command: "start", description: "Оғоз" }, { command: "qarz", description: "Қарзи ман" }] });
          const me = await tg("getMe", {}), info = await tg("getWebhookInfo", {});
          return json({ ok: true, username: me.username, webhook: info.url, pending: info.pending_update_count });
        }
        return json({ ok: true, ...(await notify(body.event, body.shipment_id, body.payment_id)) });
      }
      // 3. Website (staff only)
      const user = await staffUser(req);
      if (!user) return json({ ok: false, error: "Иҷозат нест" }, 401);
      if (body.action === "info") { const me = await tg("getMe", {}); return json({ ok: true, username: me.username }); }
      if (body.action === "send") {
        const text = String(body.text || "").trim().slice(0, 3500);
        return json({ ok: true, ...(await notify(body.event || "custom", body.shipment_id, null, text || null)) });
      }
      return json({ ok: false, error: "unknown action" }, 400);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: String(e.message || e) }, 500);
    }
  };
}

// Supabase Edge runtime
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) {
  const env = Object.fromEntries(["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "HOOK_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"].map(k => [k, D.env.get(k) || ""]));
  // New Supabase API keys (sb_secret_… / sb_publishable_…) are preferred; legacy JWT keys are the fallback.
  const firstKey = name => { try { const v = JSON.parse(D.env.get(name) || "{}"); return v.default || Object.values(v)[0] || ""; } catch { return ""; } };
  env.SUPABASE_SERVICE_ROLE_KEY = firstKey("SUPABASE_SECRET_KEYS") || env.SUPABASE_SERVICE_ROLE_KEY;
  env.SUPABASE_ANON_KEY = firstKey("SUPABASE_PUBLISHABLE_KEYS") || env.SUPABASE_ANON_KEY;
  D.serve(makeHandler(env));
}
