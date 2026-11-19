// HOJI-NAIM CARGO — Telegram bot (Supabase Edge Function «telegram-bot», deployed as «quick-task»).
// One function, four kinds of requests:
//   1. Telegram webhook (header X-Telegram-Bot-Api-Secret-Token):
//      customers: /start, «📱 send my phone», menu (борҳо, қарз, пардохт, акт, нархҳо, суроға, оператор, забон),
//      free messages go to the staff group; staff reply there and the bot carries the answer back.
//   2. Database events from pg_net triggers / pg_cron (header x-hook-secret):
//      registered / arrived / paid / delivered, batch status (loading / in_transit / arrived), weekly debt reminder.
//   3. Customer page telegram.html (public): code + phone → personal bot link.
//   4. The website (Authorization: Bearer <staff session>): manual send, batch message, reminder, broadcast, bot info.
// Secrets (Supabase → Edge Functions → Secrets): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, HOOK_SECRET.
// SUPABASE_URL and the service key are provided by Supabase. Deploy with «Verify JWT» OFF; every caller is checked here.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ---------- Texts in two languages (tg = тоҷикӣ, ru = русский) ---------- */
const L = {
  tg: {
    b: { contact: "📱 Рақамро фиристодан", ships: "📦 Борҳои ман", debt: "💰 Қарзи ман", pay: "💳 Пардохт", akt: "📄 Акт сверка", prices: "💵 Нархҳо", address: "📍 Суроғаи анбор", operator: "☎️ Оператор", lang: "🌐 Русский" },
    hello: "Ассалому алейкум! Ин боти HOJI-NAIM CARGO аст.",
    ask: "Барои дидани борҳо ва гирифтани хабар тугмаи «📱 Рақамро фиристодан»-ро дар поён пахш кунед.\nTelegram рақами худи шуморо мефиристад — дигар чизе навиштан лозим нест.",
    already: "Шумо обуна ҳастед ✅ Менюи поёнро истифода баред.",
    ownPhone: "Лутфан рақами худатонро бо тугмаи поён фиристед.",
    subscribed: n => n ? `Ташаккур! Шумо обуна шудед ✅\nБо рақами шумо ${n} бор ёфт шуд.\nВақте ки бор қабул мешавад, дар роҳ аст, мерасад, пардохт мешавад ё супорида мешавад, хабар медиҳем.\n\nМенюи поёнро истифода баред.` : "Ташаккур! Шумо обуна шудед ✅\nҲоло бо ин рақам бор ёфт нашуд. Вақте ки бори шумо бо ҳамин рақам сабт мешавад, хабар медиҳем.\nАгар бор бо рақами дигар сабт шуда бошад, ҳамин ҷо нависед — оператор ҷавоб медиҳад.",
    subscribedCode: (c, n) => `Ташаккур! Шумо обуна шудед ✅\nКод: ${c} · ${n} бор.`,
    badLink: "Пайванд нодуруст аст. Тугмаи «📱 Рақамро фиристодан»-ро пахш кунед.",
    useMenu: "Менюи поёнро истифода баред 👇",
    noLoads: "Бо рақами шумо бор ёфт нашуд. Агар бор бо рақами дигар сабт шуда бошад, ҳамин ҷо нависед — оператор ҷавоб медиҳад.",
    status: { in_warehouse: "дар анбор", delivered: "супорида шуд", other: "дар роҳ" },
    places: "Ҷой", kg: "кг", som: "сомонӣ", debtWord: "қарз", paidOk: "пардохт шуд ✅",
    shipsHead: (n, more) => `Борҳои шумо (${n}${more ? ", 15-тои охирин" : ""}):`,
    totalDebt: "Қарзи умумӣ", noDebt: n => `💰 Шумо қарз надоред ✅\nҲамаи ${n} бор пардохт шудаанд. Раҳмат!`, debtHead: "💰 Қарзи шумо",
    pricesHead: "💵 Нархҳо", pricesNone: "💵 Нархҳоро аз оператор пурсед (☎️ Оператор).",
    addressHead: "📍 Суроғаи анбор", addressNone: "📍 Суроғаро аз оператор пурсед (☎️ Оператор).",
    payHead: "💳 Чӣ тавр пардохт кунам", payNone: "💳 Тарзи пардохтро аз оператор пурсед (☎️ Оператор).",
    opHead: "☎️ Тамос бо оператор", opNone: "☎️ Рақами операторро дар офиси HOJI-NAIM CARGO пурсед.", opChat: "Ё ҳамин ҷо паём нависед — оператор ҷавоб медиҳад.", wa: "💬 WhatsApp",
    sentToOp: "✅ Паёми шумо ба оператор фиристода шуд. Ҷавобро дар ҳамин ҷо мегиред.", opReply: "☎️ Оператор:",
    aktCaption: (d, usd) => `📄 Акт сверка · ${d}\nҚарзи умумӣ: ${usd}\nФайлро дар Excel кушоед.`, aktNone: "Ҳоло бор ё пардохт нест.",
    langSet: "Забон: тоҷикӣ ✅",
    remind: (lines, total) => `⏰ Ёдраскунӣ: қарзи шумо\n\n${lines}\n\nҚарзи умумӣ: ${total}\n\nБарои тарзи пардохт «💳 Пардохт»-ро пахш кунед. Раҳмат!`,
    news: "📢 HOJI-NAIM CARGO",
    hi: n => `Ассалому алейкум${n ? ", " + n : ""}!`,
    registered: "Бори шумо қабул ва сабт шуд.", registeredTail: "Вақте ки бор ба мошин бор мешавад, дар роҳ аст ва ба Душанбе мерасад, хабар медиҳем.",
    arrived: "Бори шумо дар Душанбе расид.", item: "Мол", date: "Сана", number: "Рақам", weight: "Вазн", volume: "Ҳаҷм", sum: "Маблағ",
    paidSoFar: "Пардохт шуд", toPay: "Барои пардохт", allPaid: "Бор пурра пардохт шудааст ✅",
    paidHead: "Пардохти шумо қабул шуд", load: "Бор", paidOf: (a, b) => `Ҳамагӣ пардохт шуд: ${a} аз ${b}`, left: "Қарзи боқимонда", fullyPaid: "Бор пурра пардохт шуд ✅", thanks: "Раҳмат!",
    delivered: t => `Бори ${t} ба шумо супорида шуд.`, chose: "Раҳмат, ки HOJI-NAIM CARGO-ро интихоб кардед!",
    batch: { loading: ["📦 Бори шумо ба мошин бор шуда истодааст.", "Вақте ки мошин ба роҳ мебарояд, хабар медиҳем."], in_transit: ["🚚 Бори шумо дар роҳ аст.", "Вақте ки ба Душанбе мерасад, хабар медиҳем."], arrived: ["✅ Бори шумо дар Душанбе расид!", ""] },
    car: "Мошин", sentOn: "Фиристода шуд", arrivedOn: "Расид", andMore: n => `… ва боз ${n} бор`, total: "Ҳамагӣ", loadsWord: "бор", allPaidAll: "Ҳамааш пардохт шудааст ✅",
  },
  ru: {
    b: { contact: "📱 Отправить номер", ships: "📦 Мои грузы", debt: "💰 Мой долг", pay: "💳 Оплата", akt: "📄 Акт сверки", prices: "💵 Цены", address: "📍 Адрес склада", operator: "☎️ Оператор", lang: "🌐 Тоҷикӣ" },
    hello: "Здравствуйте! Это бот HOJI-NAIM CARGO.",
    ask: "Чтобы видеть свои грузы и получать уведомления, нажмите кнопку «📱 Отправить номер» внизу.\nTelegram отправит ваш собственный номер — больше ничего писать не нужно.",
    already: "Вы подписаны ✅ Пользуйтесь меню внизу.",
    ownPhone: "Пожалуйста, отправьте свой номер кнопкой внизу.",
    subscribed: n => n ? `Спасибо! Вы подписаны ✅\nПо вашему номеру найдено грузов: ${n}.\nМы сообщим, когда груз принят, в пути, прибыл, оплачен или выдан.\n\nПользуйтесь меню внизу.` : "Спасибо! Вы подписаны ✅\nПо этому номеру пока грузов нет. Сообщим, когда груз будет записан на этот номер.\nЕсли груз записан на другой номер, напишите сюда — оператор ответит.",
    subscribedCode: (c, n) => `Спасибо! Вы подписаны ✅\nКод: ${c} · грузов: ${n}.`,
    badLink: "Ссылка неверна. Нажмите «📱 Отправить номер».",
    useMenu: "Пользуйтесь меню внизу 👇",
    noLoads: "По вашему номеру грузов нет. Если груз записан на другой номер, напишите сюда — оператор ответит.",
    status: { in_warehouse: "на складе", delivered: "выдан", other: "в пути" },
    places: "Мест", kg: "кг", som: "сомони", debtWord: "долг", paidOk: "оплачено ✅",
    shipsHead: (n, more) => `Ваши грузы (${n}${more ? ", последние 15" : ""}):`,
    totalDebt: "Общий долг", noDebt: n => `💰 У вас нет долга ✅\nВсе ${n} грузов оплачены. Спасибо!`, debtHead: "💰 Ваш долг",
    pricesHead: "💵 Цены", pricesNone: "💵 Цены уточните у оператора (☎️ Оператор).",
    addressHead: "📍 Адрес склада", addressNone: "📍 Адрес уточните у оператора (☎️ Оператор).",
    payHead: "💳 Как оплатить", payNone: "💳 Способ оплаты уточните у оператора (☎️ Оператор).",
    opHead: "☎️ Связь с оператором", opNone: "☎️ Номер оператора уточните в офисе HOJI-NAIM CARGO.", opChat: "Или напишите сообщение сюда — оператор ответит.", wa: "💬 WhatsApp",
    sentToOp: "✅ Ваше сообщение отправлено оператору. Ответ придёт сюда.", opReply: "☎️ Оператор:",
    aktCaption: (d, usd) => `📄 Акт сверки · ${d}\nОбщий долг: ${usd}\nОткройте файл в Excel.`, aktNone: "Пока нет грузов и оплат.",
    langSet: "Язык: русский ✅",
    remind: (lines, total) => `⏰ Напоминание: ваш долг\n\n${lines}\n\nОбщий долг: ${total}\n\nКак оплатить — кнопка «💳 Оплата». Спасибо!`,
    news: "📢 HOJI-NAIM CARGO",
    hi: n => `Здравствуйте${n ? ", " + n : ""}!`,
    registered: "Ваш груз принят и записан.", registeredTail: "Сообщим, когда груз погрузят в машину, он будет в пути и прибудет в Душанбе.",
    arrived: "Ваш груз прибыл в Душанбе.", item: "Товар", date: "Дата", number: "Номер", weight: "Вес", volume: "Объём", sum: "Сумма",
    paidSoFar: "Оплачено", toPay: "К оплате", allPaid: "Груз полностью оплачен ✅",
    paidHead: "Ваша оплата принята", load: "Груз", paidOf: (a, b) => `Всего оплачено: ${a} из ${b}`, left: "Остаток долга", fullyPaid: "Груз полностью оплачен ✅", thanks: "Спасибо!",
    delivered: t => `Груз ${t} выдан вам.`, chose: "Спасибо, что выбрали HOJI-NAIM CARGO!",
    batch: { loading: ["📦 Ваш груз грузится в машину.", "Сообщим, когда машина выедет."], in_transit: ["🚚 Ваш груз в пути.", "Сообщим, когда прибудет в Душанбе."], arrived: ["✅ Ваш груз прибыл в Душанбе!", ""] },
    car: "Машина", sentOn: "Отправлена", arrivedOn: "Прибыла", andMore: n => `… и ещё ${n}`, total: "Итого", loadsWord: "грузов", allPaidAll: "Всё оплачено ✅",
  },
};
// any button text (both languages) → action
const ACTION = {};
for (const lang of ["tg", "ru"]) for (const [k, v] of Object.entries(L[lang].b)) ACTION[v] = k;

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
  const tgFile = async (method, form) => {
    const r = await fetchFn(`${API}/${method}`, { method: "POST", body: form });
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
  const fmtDate = d => { const v = String(d || "").slice(0, 10).split("-"); return v.length === 3 ? `${v[2]}.${v[1]}.${v[0]}` : ""; };
  // Dushanbe time (UTC+5): after midnight there the date must already be the new day.
  const localDate = (d) => new Date(new Date(d).getTime() + 5 * 3600e3).toISOString().slice(0, 10);
  const today = () => localDate(Date.now());
  // The date a customer sees for a load = the day it was saved in the system (not the «Дата» typed in the sheet).
  const regDate = (s) => (s.created_at ? localDate(s.created_at) : String(s.shipment_date || "").slice(0, 10));
  // Customer code as typed ("S-50", "s 50", Cyrillic "С-50" → "S50"): Cyrillic letters map to Latin by sound.
  const LOOK = { "А": "A", "Б": "B", "В": "V", "Д": "D", "Е": "E", "З": "Z", "И": "I", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R", "С": "S", "Т": "T", "У": "U", "Ф": "F" };
  const codeKey = v => String(v || "").toUpperCase().replace(/[АБВДЕЗИКЛМНОПРСТУФ]/g, c => LOOK[c]).replace(/[^0-9A-ZА-ЯЁӢӮҚҒҲҶ]/g, "").slice(0, 30);
  const codeOf = s => codeKey(note(s, "Коди муштарӣ"));
  // Debt in dollars: TJS ÷ the shipment's own rate (only when it was billed in $).
  const usdOf = (s, tjs) => (s.currency === "USD" && Number(s.fx_rate) > 0 ? tjs / Number(s.fx_rate) : null);
  const withUsd = (tjs, usd, T) => `${money(tjs)} ${T.som}${usd !== null && usd > 0.005 ? ` (≈ $${money(usd)})` : ""}`;

  async function shipment(id) {
    const rows = await db(`shipments?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
  }
  async function paymentsOf(ids) {
    if (!ids.length) return [];
    return (await db(`payments?shipment_id=in.(${ids.map(encodeURIComponent).join(",")})&select=shipment_id,amount_tjs,payment_date`)) || [];
  }
  async function paidOf(ids) {
    const m = {}; (await paymentsOf(ids)).forEach(p => (m[p.shipment_id] = (m[p.shipment_id] || 0) + Number(p.amount_tjs || 0)));
    return m;
  }
  // Subscribers (with their language). Works also before the «lang» column exists.
  async function subscribers(filter) {
    try { return (await db(`telegram_subscribers?${filter}&active=is.true&select=chat_id,first_name,phone_key,code_key,lang`)) || []; }
    catch { return ((await db(`telegram_subscribers?${filter}&active=is.true&select=chat_id,first_name,phone_key,code_key`)) || []).map(x => ({ ...x, lang: "tg" })); }
  }
  async function subscribersFor(s) {
    const out = new Map(), code = codeOf(s), key = phoneKey(s.client_phone);
    if (code) (await subscribers(`code_key=eq.${encodeURIComponent(code)}`)).forEach(x => out.set(x.chat_id, x));
    if (key.length >= 7) (await subscribers(`phone_key=eq.${key}`)).forEach(x => out.set(x.chat_id, x));
    return [...out.values()];
  }
  const SHIP_COLS = "id,tracking_no,client_name,client_phone,shipment_date,created_at,weight_kg,volume_m3,total_tjs,total_original,currency,fx_rate,warehouse_status,notes";
  async function shipmentsByCode(code) {
    // narrow with the longest part of the code (digits usually), then match exactly
    const part = (String(code).match(/[0-9]+|[^0-9]+/g) || [code]).sort((a, b) => b.length - a.length)[0];
    const rows = (await db(`shipments?notes=ilike.*${encodeURIComponent(part)}*&select=${SHIP_COLS}&order=shipment_date.desc&limit=2000`)) || [];
    return rows.filter(s => codeOf(s) === code);
  }
  async function shipmentsFor(sub) {
    if (sub.code_key) return shipmentsByCode(sub.code_key);
    const key = sub.phone_key || "";
    if (key.length < 7) return [];
    const rows = (await db(`shipments?client_phone=ilike.*${key.slice(-2)}*&select=${SHIP_COLS}&order=shipment_date.desc&limit=500`)) || [];
    return rows.filter(s => phoneKey(s.client_phone) === key);
  }
  async function log(chat_id, shipment_id, event, text, ok, error = "") {
    try { await db("telegram_log", { method: "POST", body: JSON.stringify({ chat_id, shipment_id, event, text: String(text).slice(0, 2000), ok, error: String(error).slice(0, 500) }) }); } catch { /* logging must never break sending */ }
  }
  async function deliver(chat, text, event, shipmentId = null, extra = {}) {
    try { await tg("sendMessage", { chat_id: chat, text, ...extra }); await log(chat, shipmentId, event, text, true); return true; }
    catch (e) {
      await log(chat, shipmentId, event, text, false, e.message);
      if (/blocked|deactivated|chat not found/i.test(e.message)) await db(`telegram_subscribers?chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ active: false }) }).catch(() => {});
      return false;
    }
  }
  // Settings written in Админ-панел → Telegram (app_settings).
  async function setting(key) {
    try { return String((await db(`app_settings?key=eq.${key}&select=value`))?.[0]?.value || "").trim(); } catch { return ""; }
  }
  async function saveSetting(key, value) {
    await db("app_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, value: String(value) }) });
  }

  /* ---------- Event messages ---------- */
  function message(event, s, debt, paidTotal, payment, T) {
    const usd = s.currency === "USD" ? ` ($${money(s.total_original)})` : "";
    const dims = `${T.places}: ${places(s)} · ${T.weight}: ${qty(s.weight_kg, 1)} ${T.kg} · ${T.volume}: ${qty(s.volume_m3, 3)} м³`;
    const debtUsd = usdOf(s, debt);
    if (event === "registered") return ["📝 " + T.hi(s.client_name), T.registered, "", note(s, "Мол") ? `${T.item}: ${note(s, "Мол")}` : null, `${T.date}: ${fmtDate(regDate(s))}`, dims, `${T.sum}: ${money(s.total_tjs)} ${T.som}${usd}`, "", T.registeredTail, "", "HOJI-NAIM CARGO"].filter(x => x !== null).join("\n");
    if (event === "arrived") return ["📦 " + T.hi(s.client_name), T.arrived, "", `${T.number}: ${s.tracking_no}`, dims, `${T.sum}: ${money(s.total_tjs)} ${T.som}${usd}`, paidTotal > 0 ? `${T.paidSoFar}: ${money(paidTotal)} ${T.som}` : null, debt > 0.005 ? `${T.toPay}: ${withUsd(debt, debtUsd, T)}` : T.allPaid, "", "HOJI-NAIM CARGO"].filter(x => x !== null).join("\n");
    const left = debt > 0.005 ? `${T.left}: ${withUsd(debt, debtUsd, T)}` : T.fullyPaid;
    if (event === "paid") return ["✅ " + T.hi(s.client_name), `${T.paidHead}: ${money(payment?.amount_tjs)} ${T.som}.`, "", `${T.load}: ${s.tracking_no}`, T.paidOf(money(paidTotal), `${money(s.total_tjs)} ${T.som}`), left, "", `${T.thanks} HOJI-NAIM CARGO`].join("\n");
    if (event === "delivered") return ["🤝 " + T.hi(s.client_name), T.delivered(s.tracking_no), "", `${T.places}: ${places(s)} · ${T.weight}: ${qty(s.weight_kg, 1)} ${T.kg}`, `${T.paidSoFar}: ${money(paidTotal)} ${T.som}`, left, "", T.chose].join("\n");
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
    let sent = 0;
    for (const sub of subs) {
      const text = customText || message(event, s, debt, paid, payment, L[sub.lang] || L.tg);
      if (!text) return { sent: 0, reason: "unknown event" };
      if (await deliver(sub.chat_id, text, event, s.id)) sent++;
    }
    return { sent, subscribed: true };
  }

  /* ---------- Batch (мошин) status → one message per customer with all their loads in it ---------- */
  async function notifyBatch(batchId, status) {
    if (!["loading", "in_transit", "arrived"].includes(status) || !batchId) return { sent: 0, reason: "no message for this status" };
    const batch = (await db(`batches?id=eq.${encodeURIComponent(batchId)}&select=id,name,vehicle,sent_date,arrived_date`))?.[0];
    if (!batch) return { sent: 0, reason: "batch not found" };
    const ships = ((await db(`shipments?batch_id=eq.${encodeURIComponent(batchId)}&select=${SHIP_COLS}&order=shipment_date.asc&limit=2000`)) || []).filter(s => s.warehouse_status !== "delivered");
    if (!ships.length) return { sent: 0, reason: "no loads" };
    const subs = await subscribers("chat_id=gt.0");
    const byChat = new Map();
    for (const s of ships) {
      const code = codeOf(s), key = phoneKey(s.client_phone);
      subs.filter(x => (x.code_key && x.code_key === code) || (key.length >= 7 && x.phone_key === key))
        .forEach(x => { if (!byChat.has(x.chat_id)) byChat.set(x.chat_id, { sub: x, list: [] }); byChat.get(x.chat_id).list.push(s); });
    }
    if (!byChat.size) return { sent: 0, subscribed: false };
    const paid = status === "arrived" ? await paidOf(ships.map(s => s.id)) : {};
    const address = status === "arrived" ? await setting("tg_address") : "";
    const car = batch.name + (batch.vehicle ? ` (${batch.vehicle})` : "");
    let sent = 0;
    for (const [chat, { sub, list }] of byChat) {
      const T = L[sub.lang] || L.tg, [head, tail] = T.batch[status];
      const sum = k => list.reduce((n, s) => n + Number(s[k] || 0), 0);
      const debt = list.reduce((n, s) => n + Math.max(0, Number(s.total_tjs || 0) - (paid[s.id] || 0)), 0);
      const debtUsd = list.reduce((n, s) => n + (usdOf(s, Math.max(0, Number(s.total_tjs || 0) - (paid[s.id] || 0))) || 0), 0);
      const lines = list.slice(0, 20).map(s => `• ${fmtDate(regDate(s))} · ${note(s, "Мол") || s.tracking_no} — ${places(s)} · ${qty(s.weight_kg, 1)} ${T.kg} · ${qty(s.volume_m3, 3)} м³`);
      const text = [
        T.hi(list[0].client_name), head, "",
        `${T.car}: ${car}`, status === "in_transit" && batch.sent_date ? `${T.sentOn}: ${fmtDate(batch.sent_date)}` : null, status === "arrived" && batch.arrived_date ? `${T.arrivedOn}: ${fmtDate(batch.arrived_date)}` : null, "",
        ...lines, list.length > 20 ? T.andMore(list.length - 20) : null, "",
        `${T.total}: ${list.length} ${T.loadsWord} · ${T.places}: ${list.reduce((n, s) => n + places(s), 0)} · ${qty(sum("weight_kg"), 1)} ${T.kg} · ${qty(sum("volume_m3"), 3)} м³`,
        status === "arrived" ? (debt > 0.005 ? `${T.toPay}: ${withUsd(debt, debtUsd || null, T)}` : T.allPaidAll) : null,
        status === "arrived" && address ? `\n📍 ${address}` : null,
        tail || null, "", "HOJI-NAIM CARGO",
      ].filter(x => x !== null).join("\n").replace(/\n{3,}/g, "\n\n");
      if (await deliver(chat, text, "batch_" + status, list[0].id)) sent++;
    }
    return { sent, subscribed: true };
  }

  /* ---------- Debts of one customer ---------- */
  async function debtsOf(sub) {
    const ships = await shipmentsFor(sub);
    const paid = await paidOf(ships.map(s => s.id));
    const rows = ships.map(s => { const d = Math.max(0, Number(s.total_tjs || 0) - (paid[s.id] || 0)); return { s, debt: d, usd: usdOf(s, d) }; });
    const owing = rows.filter(r => r.debt > 0.005);
    return { ships, paid, rows, owing, total: owing.reduce((n, r) => n + r.debt, 0), totalUsd: owing.reduce((n, r) => n + (r.usd || 0), 0) };
  }
  // Weekly reminder (pg_cron) or «Ҳозир фиристодан» in Админ-панел.
  async function remindAll(fromSchedule) {
    if (fromSchedule && (await setting("tg_remind")) === "off") return { sent: 0, reason: "reminders are off" };
    const subs = await subscribers("chat_id=gt.0");
    let sent = 0, owing = 0;
    for (const sub of subs) {
      const T = L[sub.lang] || L.tg, d = await debtsOf(sub);
      if (!d.owing.length) continue;
      owing++;
      const lines = d.owing.slice(0, 10).map(r => `• ${fmtDate(regDate(r.s))} · ${note(r.s, "Мол") || r.s.tracking_no} — ${withUsd(r.debt, r.usd, T)}`).join("\n");
      if (await deliver(sub.chat_id, T.remind(lines, withUsd(d.total, d.totalUsd || null, T)), "remind", d.owing[0].s.id)) sent++;
    }
    return { sent, owing };
  }
  async function broadcast(text) {
    const subs = await subscribers("chat_id=gt.0");
    let sent = 0;
    for (const sub of subs) if (await deliver(sub.chat_id, `${(L[sub.lang] || L.tg).news}\n\n${text}`, "broadcast")) sent++;
    return { sent, total: subs.length };
  }

  /* ---------- Акт сверки as a CSV file (opens in Excel) ---------- */
  async function sendStatement(chat, sub, T) {
    const d = await debtsOf(sub);
    if (!d.ships.length) return tg("sendMessage", { chat_id: chat, text: T.aktNone });
    const pays = await paymentsOf(d.ships.map(s => s.id));
    const byId = new Map(d.ships.map(s => [s.id, s]));
    const lines = [
      ...d.ships.map(s => ({ date: regDate(s), text: `${T.load} ${note(s, "Мол") || s.tracking_no} (${places(s)} · ${qty(s.weight_kg, 1)} ${T.kg} · ${qty(s.volume_m3, 3)} м³)`, debit: Number(s.total_tjs || 0), credit: 0 })),
      ...pays.map(p => ({ date: p.payment_date || "", text: `${T.paidHead} — ${byId.get(p.shipment_id)?.tracking_no || ""}`, debit: 0, credit: Number(p.amount_tjs || 0) })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || b.debit - a.debit);
    let bal = 0;
    const esc = v => `"${String(v).replace(/"/g, '""')}"`, num = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
    const csv = ["﻿" + ["Сана / Дата", "Амалиёт / Операция", "Ҳисоб / Начислено", "Пардохт / Оплата", "Бақия / Остаток"].map(esc).join(";"),
      ...lines.map(l => { bal += l.debit - l.credit; return [fmtDate(l.date), l.text, l.debit ? num(l.debit) : "", l.credit ? num(l.credit) : "", num(bal)].map(esc).join(";"); }),
      ["", "Ҷамъ / Итого", num(lines.reduce((n, l) => n + l.debit, 0)), num(lines.reduce((n, l) => n + l.credit, 0)), num(bal)].map(esc).join(";")].join("\r\n");
    const form = new FormData();
    form.append("chat_id", String(chat));
    form.append("caption", T.aktCaption(fmtDate(today()), withUsd(d.total, d.totalUsd || null, T)));
    form.append("document", new Blob([csv], { type: "text/csv" }), `HOJI-NAIM-akt-${today()}.csv`);
    await tgFile("sendDocument", form);
    await log(chat, null, "akt", "Акт сверка (CSV)", true);
  }

  /* ---------- Conversation ---------- */
  const kbNew = T => ({ keyboard: [[{ text: T.b.contact, request_contact: true }], [{ text: T.b.prices }, { text: T.b.address }], [{ text: T.b.operator }, { text: T.b.lang }]], resize_keyboard: true });
  const kbMenu = T => ({ keyboard: [[{ text: T.b.ships }, { text: T.b.debt }], [{ text: T.b.pay }, { text: T.b.akt }], [{ text: T.b.prices }, { text: T.b.address }], [{ text: T.b.operator }, { text: T.b.lang }]], resize_keyboard: true });
  const COMMANDS = { "/bor": "ships", "/qarz": "debt", "/debt": "debt", "/pay": "pay", "/akt": "akt", "/narx": "prices", "/address": "address", "/operator": "operator", "/lang": "lang" };
  const TAG = /#c(-?\d+)/;

  // Staff group: link it with «/link КОД», then answer customers by replying to their messages.
  async function onStaffGroup(m, text) {
    if (/^\/link(@\w+)?\b/i.test(text)) {
      const code = text.split(/\s+/)[1] || "", want = await setting("tg_link_code");
      if (!want || code !== want) return tg("sendMessage", { chat_id: m.chat.id, text: "Код нодуруст аст. Кодро аз Админ-панел → Telegram гиред." });
      await saveSetting("tg_staff_chat", m.chat.id);
      return tg("sendMessage", { chat_id: m.chat.id, text: "✅ Ин гурӯҳ пайваст шуд. Паёмҳои муштариён ба ин ҷо меоянд.\nБарои ҷавоб ба паёми муштарӣ «Reply» (Ответить) кунед." });
    }
    const staffChat = await setting("tg_staff_chat");
    if (String(m.chat.id) !== staffChat) return;
    const src = m.reply_to_message, tag = src && TAG.exec(String(src.text || src.caption || ""));
    if (!tag) return;
    const chat = Number(tag[1]);
    const sub = (await subscribers(`chat_id=eq.${chat}`))[0], T = L[sub?.lang] || L.tg;
    try {
      if (m.text) await tg("sendMessage", { chat_id: chat, text: `${T.opReply}\n${m.text}` });
      else await tg("copyMessage", { chat_id: chat, from_chat_id: m.chat.id, message_id: m.message_id, caption: `${T.opReply}${m.caption ? "\n" + m.caption : ""}` });
      await log(chat, null, "operator", m.text || m.caption || "[файл]", true);
      await tg("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "👍" }] }).catch(() => {});
    } catch (e) {
      await log(chat, null, "operator", m.text || "", false, e.message);
      await tg("sendMessage", { chat_id: m.chat.id, text: "Ҷавоб нарафт: " + e.message, reply_to_message_id: m.message_id });
    }
  }
  async function toOperator(m, sub, T) {
    const staffChat = await setting("tg_staff_chat");
    if (!staffChat) return false;
    const who = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || "Муштарӣ";
    const head = `💬 ${who}${m.from?.username ? " @" + m.from.username : ""}${sub?.phone_key ? " · +992" + sub.phone_key : ""}${sub?.code_key ? " · " + sub.code_key : ""}\n#c${m.chat.id}`;
    if (m.text) await tg("sendMessage", { chat_id: Number(staffChat), text: `${head}\n\n${m.text}` });
    else await tg("copyMessage", { chat_id: Number(staffChat), from_chat_id: m.chat.id, message_id: m.message_id, caption: `${head}${m.caption ? "\n\n" + m.caption : ""}` });
    await log(m.chat.id, null, "to_operator", m.text || m.caption || "[файл]", true);
    await tg("sendMessage", { chat_id: m.chat.id, text: T.sentToOp, reply_markup: sub ? kbMenu(T) : kbNew(T) });
    return true;
  }

  async function onTelegram(update) {
    const m = update.message;
    if (!m || !m.chat) return;
    const text = String(m.text || "").trim();
    if (m.chat.type === "group" || m.chat.type === "supergroup") return onStaffGroup(m, text);
    if (m.chat.type && m.chat.type !== "private") return;
    const chat = m.chat.id;
    const sub = (await subscribers(`chat_id=eq.${chat}`))[0] || null;
    // language: saved choice, else Telegram app language
    let lang = sub?.lang || (/^ru/i.test(m.from?.language_code || "") ? "ru" : "tg");
    let T = L[lang] || L.tg;
    const say = (t, extra = {}) => tg("sendMessage", { chat_id: chat, text: t, ...extra });
    const subscribe = async (patch) => {
      const row = { chat_id: chat, first_name: m.from?.first_name || "", username: m.from?.username || "", active: true, ...patch };
      try { await db("telegram_subscribers?on_conflict=chat_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ ...row, lang }) }); }
      catch { await db("telegram_subscribers?on_conflict=chat_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) }); }
    };
    const byCode = async (raw) => {
      const parts = String(raw || "").trim().split(/[\s_]+/).filter(Boolean);
      const pin = parts.length > 1 ? parts.pop().toUpperCase() : "";
      const code = codeKey(parts.join(""));
      if (code.length < 2 || !/^[A-Z0-9]{6,12}$/.test(pin)) return null;
      const inv = (await db(`telegram_invites?code_key=eq.${encodeURIComponent(code)}&select=pin`))?.[0];
      if (!inv || inv.pin !== pin) return say(T.badLink, { reply_markup: kbNew(T) });
      const ships = await shipmentsByCode(code);
      await subscribe({ code_key: code, phone: "", phone_key: "" });
      return say(T.subscribedCode(code, ships.length), { reply_markup: kbMenu(T) });
    };

    if (m.contact) {
      if (!m.from || m.contact.user_id !== m.from.id) return say(T.ownPhone, { reply_markup: kbNew(T) });
      const key = phoneKey(m.contact.phone_number);
      await subscribe({ phone: m.contact.phone_number, phone_key: key, code_key: "" });
      const ships = await shipmentsFor({ phone_key: key });
      return say(T.subscribed(ships.length), { reply_markup: kbMenu(T) });
    }
    if (text.startsWith("/start")) {
      const payload = text.slice(6).trim();
      if (payload) { const r = await byCode(payload); if (r !== null) return r; }
      return say(`${T.hello}\n\n${sub ? T.already : T.ask}`, { reply_markup: sub ? kbMenu(T) : kbNew(T) });
    }
    const act = ACTION[text] || COMMANDS[text.split(/[\s@]/)[0].toLowerCase()];
    if (act === "lang") {
      lang = lang === "ru" ? "tg" : "ru"; T = L[lang];
      if (sub) { try { await db(`telegram_subscribers?chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ lang }) }); } catch { /* column not installed yet */ } }
      return say(T.langSet, { reply_markup: sub ? kbMenu(T) : kbNew(T) });
    }
    if (act === "prices") { const t = await setting("tg_prices"); return say(t ? `${T.pricesHead}\n\n${t}` : T.pricesNone); }
    if (act === "address") { const t = await setting("tg_address"); return say(t ? `${T.addressHead}\n\n${t}` : T.addressNone); }
    if (act === "pay") { const t = await setting("tg_payment"); return say(t ? `${T.payHead}\n\n${t}` : T.payNone); }
    if (act === "operator") {
      const t = await setting("tg_contact"), staff = await setting("tg_staff_chat");
      const phone = (t.match(/\+?\d[\d\s()-]{7,}\d/) || [""])[0], d = digits(phone);
      const wa = d.length >= 9 ? `https://wa.me/${d.length === 9 ? "992" + d : d}` : "";
      const body = [t ? `${T.opHead}\n\n${t}` : T.opNone, staff ? `\n${T.opChat}` : null].filter(Boolean).join("\n");
      return say(body, wa ? { reply_markup: { inline_keyboard: [[{ text: T.wa, url: wa }]] } } : {});
    }
    if (act === "ships" || act === "debt" || act === "akt") {
      if (!sub) return say(T.ask, { reply_markup: kbNew(T) });
      if (act === "akt") return sendStatement(chat, sub, T);
      const d = await debtsOf(sub);
      if (!d.ships.length) return say(T.noLoads, { reply_markup: kbMenu(T) });
      if (act === "ships") {
        const lines = d.rows.slice(0, 15).map(({ s, debt, usd }) => {
          const st = T.status[s.warehouse_status] || T.status.other;
          return `📦 ${fmtDate(regDate(s))} · ${note(s, "Мол") || s.tracking_no}\n   ${T.places}: ${places(s)} · ${qty(s.weight_kg, 1)} ${T.kg} · ${qty(s.volume_m3, 3)} м³ · ${st}\n   ${money(s.total_tjs)} ${T.som}${debt > 0.005 ? ` · ${T.debtWord} ${withUsd(debt, usd, T)}` : " · " + T.paidOk}`;
        });
        return say(`${T.shipsHead(d.ships.length, d.ships.length > 15)}\n\n${lines.join("\n\n")}\n\n${T.totalDebt}: ${withUsd(d.total, d.totalUsd || null, T)}`, { reply_markup: kbMenu(T) });
      }
      if (!d.owing.length) return say(T.noDebt(d.ships.length), { reply_markup: kbMenu(T) });
      const lines = d.owing.slice(0, 30).map(r => `• ${fmtDate(regDate(r.s))} · ${note(r.s, "Мол") || r.s.tracking_no} — ${withUsd(r.debt, r.usd, T)}`);
      return say(`${T.debtHead}\n\n${lines.join("\n")}\n\n${T.totalDebt}: ${withUsd(d.total, d.totalUsd || null, T)}`, { reply_markup: kbMenu(T) });
    }
    if (text && !text.startsWith("/")) { const r = await byCode(text); if (r !== null) return r; }
    // anything else (question, photo, voice) → the operator, when the staff group is linked
    if (!text.startsWith("/") && (text || m.photo || m.document || m.voice || m.video || m.audio)) { if (await toOperator(m, sub, T)) return; }
    return say(sub ? T.useMenu : T.ask, { reply_markup: sub ? kbMenu(T) : kbNew(T) });
  }

  async function staffUser(req) {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return null;
    const r = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY } });
    if (!r.ok) return null;
    const user = await r.json();
    const prof = (await db(`profiles?id=eq.${encodeURIComponent(user.id)}&select=role`))?.[0];
    return ["owner", "admin", "accountant", "operator"].includes(prof?.role) ? { ...user, role: prof.role } : null;
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
      // 2. Database trigger / schedule
      const hook = req.headers.get("x-hook-secret");
      if (hook !== null) {
        if (!env.HOOK_SECRET || hook !== env.HOOK_SECRET) return json({ ok: false }, 401);
        if (body.action === "setup") {
          const slug = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "telegram-bot";
          const url = `${env.SUPABASE_URL}/functions/v1/${slug}`;
          await tg("setWebhook", { url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"] });
          const cmds = lang => Object.entries({ start: lang === "ru" ? "Начало" : "Оғоз", bor: L[lang].b.ships, qarz: L[lang].b.debt, pay: L[lang].b.pay, akt: L[lang].b.akt, narx: L[lang].b.prices, address: L[lang].b.address, operator: L[lang].b.operator, lang: lang === "ru" ? "Язык / Забон" : "Забон / Язык" }).map(([command, description]) => ({ command, description: description.replace(/^\S+\s/, "") }));
          await tg("setMyCommands", { commands: cmds("tg") });
          await tg("setMyCommands", { commands: cmds("ru"), language_code: "ru" });
          const me = await tg("getMe", {}), info = await tg("getWebhookInfo", {});
          return json({ ok: true, username: me.username, webhook: info.url, pending: info.pending_update_count });
        }
        if (body.event === "remind") return json({ ok: true, ...(await remindAll(true)) });
        if (body.event === "batch") return json({ ok: true, ...(await notifyBatch(body.batch_id, body.status)) });
        return json({ ok: true, ...(await notify(body.event, body.shipment_id, body.payment_id)) });
      }
      // 3. Customer page (public): code + phone → personal bot link. The phone must match a shipment of that code.
      if (body.action === "link") {
        const code = codeKey(body.code), key = phoneKey(body.phone);
        const fail = async (error) => { await new Promise(r => setTimeout(r, 800)); return json({ ok: false, error }); };   // slows guessing
        if (code.length < 2 || key.length < 9) return fail("Код ва рақами телефонро пурра нависед.");
        const ships = await shipmentsByCode(code);
        if (!ships.length) return fail("Ин код ёфт нашуд. Кодро санҷед.");
        if (!ships.some(s => phoneKey(s.client_phone) === key)) {
          return fail(ships.some(s => phoneKey(s.client_phone).length >= 7) ? "Рақами телефон ба ин код мувофиқ нест." : "Барои ин код телефон сабт нашудааст. Ба корманди HOJI-NAIM CARGO муроҷиат кунед.");
        }
        let pin = (await db(`telegram_invites?code_key=eq.${encodeURIComponent(code)}&select=pin`))?.[0]?.pin;
        if (!pin) {
          const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          pin = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ABC[b % 32]).join("");
          await db("telegram_invites?on_conflict=code_key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ code_key: code, pin }) });
          pin = (await db(`telegram_invites?code_key=eq.${encodeURIComponent(code)}&select=pin`))?.[0]?.pin || pin;
        }
        const me = await tg("getMe", {});
        return json({ ok: true, link: `https://t.me/${me.username}?start=${code}_${pin}`, bot: me.username });
      }
      // 4. Website (staff only)
      const user = await staffUser(req);
      if (!user) return json({ ok: false, error: "Иҷозат нест" }, 401);
      if (body.action === "info") { const me = await tg("getMe", {}); return json({ ok: true, username: me.username, staff_chat: !!(await setting("tg_staff_chat")) }); }
      if (body.action === "batch") return json({ ok: true, ...(await notifyBatch(body.batch_id, body.status)) });
      if (body.action === "send") {
        const text = String(body.text || "").trim().slice(0, 3500);
        return json({ ok: true, ...(await notify(body.event || "custom", body.shipment_id, null, text || null)) });
      }
      const admin = ["owner", "admin"].includes(user.role);
      if (body.action === "remind") { if (!admin) return json({ ok: false, error: "Танҳо админ" }, 403); return json({ ok: true, ...(await remindAll(false)) }); }
      if (body.action === "broadcast") {
        if (!admin) return json({ ok: false, error: "Танҳо админ" }, 403);
        const text = String(body.text || "").trim().slice(0, 3500);
        if (!text) return json({ ok: false, error: "Матн холӣ аст" }, 400);
        return json({ ok: true, ...(await broadcast(text)) });
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
