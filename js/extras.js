/* HOJI-NAIM CARGO — finance extras:
   касса (cash book by method), қурби рӯз + reports in USD, партияҳо (truck/container batches
   with profit), акт сверки (customer statement), пӯшидани давра (period lock).
   Every feature checks that its database part exists (supabase/SETUP-ALL.sql) and
   falls back gracefully when it does not. */
(() => {
  "use strict";
  const HN = window.HN, S = HN.state, $ = HN.$, esc = HN.esc, fmt = HN.fmt, money = HN.money;
  const D = HN.config.defaults;
  const td = (v, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;
  const METHODS = ["cash", "online", "bank_transfer", "other"];
  S.rates = []; S.batches = []; S.closedUntil = null;

  /* ================= Loading & features ================= */
  async function load(first) {
    const q = (t, o) => S.db.from(t).select("*").order(o, { ascending: true });
    const [rates, batches, settings, method, payMethod, tgSubs, tgLog] = await Promise.all([
      q("fx_rates", "rate_date"), S.db.from("batches").select("*").order("created_at", { ascending: false }), q("app_settings", "key"),
      first || S.features.expMethod === undefined ? S.db.from("expenses").select("method").limit(1) : Promise.resolve({ error: S.features.expMethod ? null : {} }),
      first || S.features.payMethod === undefined ? S.db.from("payments").select("method").limit(1) : Promise.resolve({ error: S.features.payMethod ? null : {} }),
      S.db.from("telegram_subscribers").select("*").order("created_at", { ascending: false }),
      S.db.from("telegram_log").select("*").order("created_at", { ascending: false }).limit(15),
    ]);
    S.features.telegram = !tgSubs.error;
    S.tgSubs = tgSubs.error ? [] : (tgSubs.data || []).filter(x => x.active !== false);
    S.tgLog = tgLog.error ? [] : tgLog.data || [];
    S.features.payMethod = !payMethod.error;
    S.features.rates = !rates.error; S.rates = rates.error ? [] : rates.data || [];
    S.features.batches = !batches.error; S.batches = batches.error ? [] : batches.data || [];
    S.features.lock = !settings.error;
    S.closedUntil = (settings.data || []).find(x => x.key === "closed_until")?.value || null;
    S.resetMark = (settings.data || []).find(x => x.key === "data_reset_at")?.value || "";
    S.bookMonth = (settings.data || []).find(x => x.key === "book_month")?.value || "";   // month of the open Excel notebooks (after «Пӯшидани моҳ»)   // set by supabase/reset-data.sql
    S.tgTexts = Object.fromEntries(["tg_prices", "tg_address", "tg_contact", "tg_payment", "tg_remind", "tg_link_code", "tg_staff_chat"].map(k => [k, (settings.data || []).find(x => x.key === k)?.value || ""]));
    S.features.expMethod = !method.error;
    applyFeatures();
  }
  function applyFeatures() {
    document.querySelectorAll(".feat-expmethod").forEach(el => el.classList.toggle("hidden", !S.features.expMethod));
    document.querySelectorAll(".feat-paymethod").forEach(el => el.classList.toggle("hidden", !S.features.payMethod));
    document.querySelectorAll(".feat-batches").forEach(el => el.classList.toggle("hidden", !S.features.batches));
    document.querySelectorAll("select[name=batch_id]").forEach(sel => {
      const v = sel.value;
      sel.innerHTML = '<option value="">— бе партия —</option>' + S.batches.filter(b => b.status !== "closed" || b.id === v).map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.vehicle ? " · " + esc(b.vehicle) : ""}</option>`).join("");
      sel.value = v;
    });
  }

  /* ================= Rates & currency ================= */
  const LOCAL_RATES = "hn-fx-rates";
  const localRates = () => { const v = HN.lsGet(LOCAL_RATES, []); return Array.isArray(v) ? v : []; };
  const allRates = () => (S.features.rates ? S.rates : localRates()).slice().sort((a, b) => String(a.rate_date).localeCompare(String(b.rate_date)));
  HN.rateOn = date => {
    const list = allRates(); let r = null;
    for (const x of list) { if (!date || String(x.rate_date) <= String(date)) r = x; else break; }
    r = r || list[0];
    return HN.num(r?.usd) || HN.num(HN.lsGet("hn-usd-rate", D.usdRate)) || D.usdRate;
  };
  HN.latestUsd = () => { const l = allRates(); return l.length ? HN.num(l[l.length - 1].usd) : 0; };
  HN.latestCny = () => { const l = allRates(); return l.length ? HN.num(l[l.length - 1].cny) : 0; };
  HN.latestRate = () => { const l = allRates(); return l.length ? l[l.length - 1] : null; };
  // TJS for one yuan on a date (the rate saved in «Курби асъор»; else the latest; else the default).
  HN.cnyOn = date => {
    const list = allRates().filter(x => HN.num(x.cny) > 0); let r = null;
    for (const x of list) { if (!date || String(x.rate_date) <= String(date)) r = x; else break; }
    r = r || list[0];
    return HN.num(r?.cny) || D.cnyRate;
  };
  // Dollars for the dashboard, without today's rate: a load keeps its own dollar price (as in Excel);
  // a payment counts at the rate of its own load, so «paid $ + debt $ = billed $»; an expense at the rate of its day.
  HN.usd = {
    ship: s => (s.currency === "USD" ? HN.num(s.total_original) : HN.total(s) / HN.rateOn(HN.shipmentDate(s))),
    ratio: s => { const t = HN.total(s); return t > 0 ? HN.usd.ship(s) / t : 1 / HN.rateOn(HN.shipmentDate(s)); },
    pay: p => { if (p.currency === "USD") return HN.num(p.amount_original); const s = HN.shipmentById(p.shipment_id); return s ? HN.num(p.amount_tjs) * HN.usd.ratio(s) : HN.num(p.amount_tjs) / HN.rateOn(String(p.payment_date).slice(0, 10)); },
    exp: e => (e.currency === "USD" ? HN.num(e.amount_original) : HN.num(e.amount_tjs) / HN.rateOn(String(e.expense_date).slice(0, 10))),
    debt: s => HN.debt(s) * HN.usd.ratio(s),
  };
  // Money in the currency chosen for reports: TJS, USD or CNY at the rate of that day.
  // A record made in the same currency keeps its own amount.
  HN.cur = ["USD", "CNY"].includes(HN.lsGet("hn-report-cur", "TJS")) ? HN.lsGet("hn-report-cur", "TJS") : "TJS";
  const conv = (tjs, cur, orig, date) => {
    if (HN.cur === "TJS") return HN.num(tjs);
    if (cur === HN.cur) return HN.num(orig);
    return HN.num(tjs) / (HN.cur === "USD" ? HN.rateOn(date) : HN.cnyOn(date));
  };
  HN.val = {
    ship: s => conv(HN.total(s), s.currency, s.total_original, HN.shipmentDate(s)),
    pay: p => conv(p.amount_tjs, p.currency, p.amount_original, String(p.payment_date).slice(0, 10)),
    exp: e => conv(e.amount_tjs, e.currency, e.amount_original, String(e.expense_date).slice(0, 10)),
    // debt of a shipment, valued at that shipment's own rate
    debt: s => { const t = HN.total(s); return HN.cur === "TJS" || t <= 0 ? HN.debt(s) : (HN.debt(s) * HN.val.ship(s)) / t; },
    paid: s => { const t = HN.total(s); return HN.cur === "TJS" || t <= 0 ? HN.paid(s) : HN.val.ship(s) - HN.val.debt(s); },
  };
  HN.curLabel = () => ({ USD: "$", CNY: "¥" })[HN.cur] || "TJS";

  async function saveRate(date, usd, cny) {
    if (S.features.rates) {
      // update the day, else add it (plain update/insert — the database may refuse «upsert»)
      const row = { rate_date: date, usd, cny: cny || null };
      let r = await S.db.from("fx_rates").update({ usd, cny: cny || null }).eq("rate_date", date).select("rate_date");
      if (!r.error && !(r.data || []).length) { r = await S.db.from("fx_rates").insert(row); if (r.error?.code === "23505") r = await S.db.from("fx_rates").update({ usd, cny: cny || null }).eq("rate_date", date); }
      if (r.error) throw r.error;
      const i = S.rates.findIndex(x => x.rate_date === date);
      if (i >= 0) S.rates[i] = { ...S.rates[i], usd, cny }; else S.rates.push({ rate_date: date, usd, cny });
    } else {
      const l = localRates().filter(x => x.rate_date !== date); l.push({ rate_date: date, usd, cny }); HN.lsSet(LOCAL_RATES, l);
    }
    HN.lsSet("hn-usd-rate", usd);
  }

  /* ================= Period lock ================= */
  HN.isLocked = date => !!(S.closedUntil && date && String(date).slice(0, 10) <= S.closedUntil);
  HN.lockMsg = () => `Давра то ${HN.fmtDate(S.closedUntil)} пӯшида аст. Барои тағйир админ давраро кушояд.`;

  /* ================= Касса ================= */
  let kFrom = HN.monthStart(HN.today()), kTo = HN.today(), kMethod = "";
  function kassaOps() {
    const ops = [];
    S.payments.forEach(p => { const s = HN.shipmentById(p.shipment_id); ops.push({ date: String(p.payment_date).slice(0, 10), created: p.created_at || "", kind: "in", method: p.method || "other", amount: HN.num(p.amount_tjs), text: `Пардохт · ${s ? s.client_name + " · " + s.tracking_no : "—"}${p.notes ? " · " + p.notes : ""}` }); });
    S.expenses.forEach(e => ops.push({ date: String(e.expense_date).slice(0, 10), created: e.created_at || "", kind: "out", method: S.features.expMethod ? e.method || "cash" : "cash", amount: HN.num(e.amount_tjs), text: `Хароҷот · ${e.category}${e.description ? " · " + e.description : ""}` }));
    return ops.sort((a, b) => a.date.localeCompare(b.date) || String(a.created).localeCompare(String(b.created)));
  }
  HN.cashBalance = method => kassaOps().filter(o => !method || o.method === method).reduce((n, o) => n + (o.kind === "in" ? o.amount : -o.amount), 0);
  function renderKassa() {
    const box = $("rtab-kassa"); if (!box) return;
    if (!HN.can("finance")) { box.innerHTML = '<p class="empty">Касса танҳо барои муҳосиб ва админ аст.</p>'; return; }
    const ops = kassaOps();
    const card = m => {
      const all = ops.filter(o => o.method === m), per = all.filter(o => HN.inRange(o.date, kFrom || null, kTo || null));
      const inn = per.filter(o => o.kind === "in").reduce((n, o) => n + o.amount, 0), out = per.filter(o => o.kind === "out").reduce((n, o) => n + o.amount, 0);
      const bal = all.reduce((n, o) => n + (o.kind === "in" ? o.amount : -o.amount), 0);
      return `<article class="kpi kassa-card${kMethod === m ? " on" : ""}" data-kmethod="${m}"><span>${HN.methodText[m]}</span><strong class="${bal < 0 ? "neg" : ""}">${money(bal)}</strong><small>дар давра: +${money(inn)} / −${money(out)}</small></article>`;
    };
    const before = ops.filter(o => (!kMethod || o.method === kMethod) && kFrom && o.date < kFrom).reduce((n, o) => n + (o.kind === "in" ? o.amount : -o.amount), 0);
    let run = before;
    const rows = ops.filter(o => (!kMethod || o.method === kMethod) && HN.inRange(o.date, kFrom || null, kTo || null)).map(o => { run += o.kind === "in" ? o.amount : -o.amount; return { ...o, run }; });
    const inn = rows.filter(o => o.kind === "in").reduce((n, o) => n + o.amount, 0), out = rows.filter(o => o.kind === "out").reduce((n, o) => n + o.amount, 0);
    box.innerHTML = `
      <div class="toolbar">
        <label class="date-range"><input id="kFrom" type="date" value="${kFrom}" aria-label="Аз сана"><span>—</span><input id="kTo" type="date" value="${kTo}" aria-label="То сана"></label>
        <select id="kMethod" aria-label="Усул"><option value="">Ҳамаи кассаҳо</option>${METHODS.map(m => `<option value="${m}" ${m === kMethod ? "selected" : ""}>${HN.methodText[m]}</option>`).join("")}</select>
        <button class="btn btn-ghost" id="kExport"><svg><use href="#i-download"/></svg><span>Excel</span></button>
      </div>
      ${S.features.expMethod ? "" : '<p class="hint">Хароҷот ҳоло ҳамчун «нақд» ҳисоб мешаванд. Барои интихоби усули хароҷот SQL-и supabase/SETUP-ALL.sql-ро иҷро кунед.</p>'}
      <div class="kpis">${METHODS.map(card).join("")}</div>
      <div class="panel flush">
        <div class="panel-head pad"><div><h3>Дафтари касса ${kMethod ? "· " + HN.methodText[kMethod] : ""}</h3><p class="muted">Бақия дар аввали давра: <b>${money(before)}</b> · Даромад: <b>+${money(inn)}</b> · Хароҷот: <b>−${money(out)}</b> · Бақия дар охир: <b>${money(before + inn - out)}</b> TJS</p></div></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Сана</th><th>Амалиёт</th><th>Касса</th><th class="num">Даромад</th><th class="num">Хароҷот</th><th class="num">Бақия</th></tr></thead>
        <tbody>${rows.slice().reverse().map(o => `<tr>${td(HN.fmtDate(o.date), "nowrap")}${td(esc(o.text), "muted")}${td(esc(HN.methodText[o.method] || o.method))}${td(o.kind === "in" ? money(o.amount) : "", "num")}${td(o.kind === "out" ? money(o.amount) : "", "num neg")}${td(`<b>${money(o.run)}</b>`, "num" + (o.run < 0 ? " neg" : ""))}</tr>`).join("")}</tbody></table></div>
        ${rows.length ? "" : '<p class="empty">Дар ин давра амалиёт нест.</p>'}
      </div>`;
    $("kFrom").oninput = e => { kFrom = e.target.value; renderKassa(); };
    $("kTo").oninput = e => { kTo = e.target.value; renderKassa(); };
    $("kMethod").onchange = e => { kMethod = e.target.value; renderKassa(); };
    box.querySelectorAll("[data-kmethod]").forEach(c => (c.onclick = () => { kMethod = kMethod === c.dataset.kmethod ? "" : c.dataset.kmethod; renderKassa(); }));
    $("kExport").onclick = () => HN.exportXlsx(`HOJI-NAIM-Касса-${HN.today()}.xlsx`, [{ name: "Касса", title: "HOJI-NAIM CARGO — Дафтари касса" + (kMethod ? " · " + HN.methodText[kMethod] : ""), subtitle: `Давра: ${kFrom ? HN.fmtDate(kFrom) : "аз аввал"} — ${kTo ? HN.fmtDate(kTo) : "то имрӯз"} · Бақияи аввал: ${money(before)} TJS`, columns: [
      { header: "Сана", value: o => o.date, type: "date", width: 12 }, { header: "Амалиёт", value: o => o.text, width: 46 }, { header: "Касса", value: o => HN.methodText[o.method], width: 14 },
      { header: "Даромад (TJS)", value: o => (o.kind === "in" ? o.amount : ""), type: "money", width: 14, total: true }, { header: "Хароҷот (TJS)", value: o => (o.kind === "out" ? o.amount : ""), type: "money", width: 14, total: true }, { header: "Бақия (TJS)", value: o => o.run, type: "money", width: 14 },
    ], rows }]);
  }

  /* ================= Партияҳо (batches) ================= */
  const BSTATUS = { loading: "Бор шуда истодааст", in_transit: "Дар роҳ", arrived: "Расид", closed: "Пӯшида" };
  const bShips = b => S.shipments.filter(s => String(s.batch_id || "") === String(b.id));
  const bExps = b => S.expenses.filter(e => String(e.batch_id || "") === String(b.id));
  function bStats(b) {
    const ships = bShips(b), billed = ships.reduce((n, s) => n + HN.total(s), 0), paid = ships.reduce((n, s) => n + HN.paid(s), 0);
    const auto = S.expenses.some(e => String(e.description || "").includes(`[мошин:${b.id}:road]`));
    const cost = (auto ? 0 : HN.num(b.cost_tjs)) + bExps(b).reduce((n, e) => n + HN.num(e.amount_tjs), 0);
    return { ships, n: ships.length, kg: ships.reduce((n, s) => n + HN.num(s.weight_kg), 0), m3: ships.reduce((n, s) => n + HN.num(s.volume_m3), 0), billed, paid, cost, profit: billed - cost };
  }
  let wtab = HN.lsGet("hn-wh-tab", "stock") === "batches" ? "batches" : "stock", bQuery = "";
  function setWtab(t) {
    wtab = t; HN.lsSet("hn-wh-tab", t);
    document.querySelectorAll("[data-wtab]").forEach(x => x.classList.toggle("on", x.dataset.wtab === t));
    $("wtab-stock").classList.toggle("hidden", t !== "stock"); $("wtab-batches").classList.toggle("hidden", t !== "batches");
    if (t === "batches") renderBatches();
  }
  function renderBatches() {
    const box = $("wtab-batches"); if (!box) return;
    if (!S.features.batches) { box.innerHTML = '<div class="empty-state"><svg><use href="#i-box"/></svg><h2>Партияҳо ҳанӯз фаъол нестанд</h2><p>Барои партияҳо (мошин ё контейнер) ва фоидаи ҳар кадом дар Supabase → SQL Editor файли supabase/SETUP-ALL.sql-ро як бор иҷро кунед.</p></div>'; return; }
    const list = S.batches.filter(b => !bQuery || [b.name, b.vehicle, b.notes].some(v => String(v || "").toLocaleLowerCase().includes(bQuery)));
    const fin = HN.can("finance");
    box.innerHTML = `
      <div class="toolbar">
        <label class="search"><svg><use href="#i-search"/></svg><input id="bSearch" type="search" value="${esc(bQuery)}" placeholder="Номи партия ё рақами мошин…" aria-label="Ҷустуҷӯи партия"></label>
        ${HN.can("staff") ? '<button class="btn btn-primary" id="bAdd"><svg><use href="#i-plus"/></svg><span>Партияи нав</span></button>' : ""}
      </div>
      <div class="panel flush"><div class="table-wrap"><table class="tbl tbl-click"><thead><tr><th>Партия</th><th>Мошин / контейнер</th><th>Фиристода</th><th>Расид</th><th>Ҳолат</th><th class="num">Борҳо</th><th class="num">Вазн, кг</th><th class="num">Ҳаҷм, м³</th><th class="num">Ҳисоб</th>${fin ? '<th class="num">Хароҷот</th><th class="num">Фоида</th>' : ""}</tr></thead>
      <tbody>${list.map(b => { const x = bStats(b); return `<tr data-batch="${esc(b.id)}">${td(`<b>${esc(b.name)}</b>`)}${td(esc(b.vehicle || "—"))}${td(HN.fmtDate(b.sent_date), "nowrap")}${td(HN.fmtDate(b.arrived_date), "nowrap")}${td(`<span class="pill bs-${esc(b.status)}">${BSTATUS[b.status] || b.status}</span>`)}${td(x.n, "num")}${td(fmt(x.kg, 1), "num")}${td(fmt(x.m3, 3), "num")}${td(money(x.billed), "num")}${fin ? td(money(x.cost), "num") + td(`<b>${money(x.profit)}</b>`, "num" + (x.profit < 0 ? " neg" : "")) : ""}</tr>`; }).join("")}</tbody></table></div>
      ${list.length ? "" : '<p class="empty">Ҳоло партия нест. «Партияи нав»-ро пахш кунед.</p>'}</div>`;
    $("bSearch").oninput = e => { bQuery = e.target.value.trim().toLocaleLowerCase(); const pos = e.target.selectionStart; renderBatches(); const i = $("bSearch"); i.focus(); i.setSelectionRange(pos, pos); };
    if ($("bAdd")) $("bAdd").onclick = () => openBatchForm();
    box.querySelectorAll("tr[data-batch]").forEach(tr => (tr.onclick = () => openBatch(tr.dataset.batch)));
  }
  /* ----- Batch form: loads of the car, costs that go to «Хароҷот» by themselves ----- */
  // Expenses made by the batch form carry a marker in the description: [мошин:<id>:road] / [мошин:<id>:service]
  const autoTag = (id, kind) => `[мошин:${id}:${kind}]`;
  const autoExp = (id, kind) => S.expenses.find(e => String(e.description || "").includes(autoTag(id, kind)));
  let bSel = new Set(), bQ = "", bEditId = "";
  function renderBatchLoads() {
    const box = $("bLoads"); if (!box) return;
    const list = S.shipments.filter(s => bSel.has(String(s.id)) || !s.batch_id || String(s.batch_id) === bEditId)
      .filter(s => !bQ || HN.matches(s, bQ) || bSel.has(String(s.id)))
      .sort((a, b) => (bSel.has(String(b.id)) - bSel.has(String(a.id))) || HN.shipmentDate(b).localeCompare(HN.shipmentDate(a)))
      .slice(0, 200);
    box.innerHTML = list.map(s => `<label class="b-load"><input type="checkbox" data-bload="${esc(s.id)}" ${bSel.has(String(s.id)) ? "checked" : ""}>
      <span><b>${esc(HN.customerCode(s) || s.client_name || "—")}</b> · ${esc(s.client_name || "")}${HN.originOf(s) === "uru" ? ' <em class="og-uru">Урумчи</em>' : ' <em class="og-iwu">Иву</em>'}<small>${HN.fmtDate(HN.shipmentDate(s))} · ${esc(HN.noteValue(s, "Мол") || s.tracking_no)} · ${HN.places(s)} ҷой · ${fmt(HN.num(s.weight_kg), 1)} кг · ${fmt(HN.num(s.volume_m3), 3)} м³</small></span>
      <span class="b-sum">${money(HN.total(s))}</span></label>`).join("") || '<p class="muted" style="padding:10px 12px">Бори озод нест. Аввал борҳоро сабт кунед.</p>';
    const chosen = S.shipments.filter(s => bSel.has(String(s.id)));
    $("bLoadsCount").textContent = chosen.length ? `Интихоб: ${chosen.length} бор · ${fmt(chosen.reduce((n, s) => n + HN.num(s.weight_kg), 0), 1)} кг · ${fmt(chosen.reduce((n, s) => n + HN.num(s.volume_m3), 0), 3)} м³` : "Ҳоло ягон бор интихоб нашудааст";
  }
  $("bLoads")?.addEventListener("change", e => { const c = e.target.closest("[data-bload]"); if (!c) return; c.checked ? bSel.add(c.dataset.bload) : bSel.delete(c.dataset.bload); renderBatchLoads(); });
  $("bLoadsQ")?.addEventListener("input", e => { bQ = e.target.value.trim(); renderBatchLoads(); });
  const markArrived = () => $("batchForm").classList.toggle("is-arrived", $("batchForm").elements.status.value === "arrived");
  $("batchForm")?.elements.status.addEventListener("change", () => {
    const f = $("batchForm").elements; markArrived();
    if (f.status.value === "arrived" && !f.arrived_date.value) f.arrived_date.value = HN.today();
  });
  function openBatchForm(b) {
    const form = $("batchForm"), f = form.elements; form.reset(); $("batchMsg").textContent = "";
    form.dataset.id = b ? b.id : ""; bEditId = b ? String(b.id) : "";
    $("batchFormTitle").textContent = b ? "Таҳрири партия" : "Партияи нав";
    f.name.value = b?.name || "Мошин " + (S.batches.length + 1); f.vehicle.value = b?.vehicle || ""; f.status.value = b?.status || "loading";
    f.sent_date.value = b?.sent_date || HN.today(); f.arrived_date.value = b?.arrived_date || "";
    const road = b && autoExp(b.id, "road"), svc = b && autoExp(b.id, "service");
    f.cost_usd.value = road ? HN.num(road.amount_original) : b ? HN.num(b.cost_usd) || "" : "";
    f.service_usd.value = svc ? HN.num(svc.amount_original) : "";
    f.fx_rate.value = b ? HN.num(b.fx_rate) || HN.rateOn(HN.today()) : HN.rateOn(HN.today()); f.notes.value = b?.notes || "";
    if (f.method) f.method.value = (road || svc)?.method || "cash";
    f.method.closest(".field").classList.toggle("hidden", !S.features.expMethod);
    $("bCostHint").classList.toggle("hidden", !HN.can("finance"));
    bSel = new Set(b ? bShips(b).map(s => String(s.id)) : []); bQ = ""; $("bLoadsQ").value = "";
    markArrived(); renderBatchLoads();
    $("batchFormDialog").showModal(); f.name.focus();
  }
  // create / update / remove the automatic expense of a batch
  async function saveAutoExpense(batch, kind, usd, rate, method, date) {
    const old = autoExp(batch.id, kind), label = kind === "road" ? "Мошин (роҳкиро)" : "Хизмати мошин";
    if (usd <= 0) { if (old) { const r = await S.db.from("expenses").delete().eq("id", old.id); if (r.error) throw r.error; } return; }
    const p = { category: label, currency: "USD", amount_original: usd, fx_rate: rate, amount_tjs: HN.round2(usd * rate), expense_date: date, description: `${batch.name}${batch.vehicle ? " · " + batch.vehicle : ""} ${autoTag(batch.id, kind)}` };
    if (S.features.expMethod) p.method = method || "cash";
    if (S.features.batches) p.batch_id = batch.id;
    const r = old ? await S.db.from("expenses").update(p).eq("id", old.id) : await S.db.from("expenses").insert({ ...p, created_by: S.user.id });
    if (r.error) throw r.error;
  }
  $("batchForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target, f = form.elements, msg = $("batchMsg"), id = form.dataset.id;
    const bad = t => { msg.dataset.kind = "error"; msg.textContent = t; };
    const cost = HN.num(f.cost_usd.value), service = HN.num(f.service_usd.value), rate = HN.num(f.fx_rate.value), status = f.status.value;
    const chosen = [...bSel];
    if (!f.name.value.trim()) return bad("Номи партияро нависед.");
    if (cost < 0 || service < 0 || rate <= 0) return bad("Хароҷот ва қурбро дуруст нависед.");
    if (status === "arrived") {
      if (!chosen.length) return bad("Мошин расид: кадом борҳо омаданд? Дар рӯйхати поён борҳоро интихоб кунед.");
      if (!f.arrived_date.value) return bad("Санаи расиданро нависед.");
      if (cost <= 0) return bad("Хароҷоти мошинро (роҳкиро, $) нависед — он ба «Хароҷот» меравад.");
    }
    const expDate = f.arrived_date.value || f.sent_date.value || HN.today();
    if ((cost > 0 || service > 0) && HN.can("finance") && HN.isLocked?.(expDate)) return bad(HN.lockMsg());
    const p = { name: f.name.value.trim(), vehicle: f.vehicle.value.trim(), status, sent_date: f.sent_date.value || null, arrived_date: f.arrived_date.value || null, cost_usd: cost, fx_rate: rate, cost_tjs: HN.round2(cost * rate), notes: f.notes.value.trim() };
    msg.dataset.kind = ""; msg.textContent = "Сабт шуда истодааст…";
    try {
      // 1. the batch (a new one that already «arrived» is first saved as «on the road», so the arrival message sees its loads)
      let batch;
      if (id) batch = { ...S.batches.find(x => String(x.id) === String(id)), ...p, id };
      else {
        const r = await S.db.from("batches").insert({ ...p, status: status === "arrived" ? "in_transit" : status, created_by: S.user.id }).select().single();
        if (r.error) throw r.error; batch = { ...r.data, ...p };
      }
      // 2. loads: chosen ones join the car, unticked ones leave it
      const before = S.shipments.filter(s => String(s.batch_id || "") === String(batch.id)).map(s => String(s.id));
      const add = chosen.filter(x => !before.includes(x)), drop = before.filter(x => !chosen.includes(x));
      if (add.length) { const r = await S.db.from("shipments").update({ batch_id: batch.id }).in("id", add); if (r.error) throw r.error; }
      if (drop.length) { const r = await S.db.from("shipments").update({ batch_id: null }).in("id", drop); if (r.error) throw r.error; }
      // 3. arrived → loads go to the warehouse
      if (status === "arrived" && S.features.warehouse) {
        const toStock = S.shipments.filter(s => chosen.includes(String(s.id)) && !["in_warehouse", "delivered"].includes(HN.whStatus(s))).map(s => s.id);
        if (toStock.length) { const r = await S.db.from("shipments").update({ warehouse_status: "in_warehouse" }).in("id", toStock); if (r.error) throw r.error; }
      }
      // 4. the batch itself (status change sends the Telegram message)
      if (id || status === "arrived") { const r = await S.db.from("batches").update(p).eq("id", batch.id); if (r.error) throw r.error; }
      // 5. costs → «Хароҷот» and «Касса»
      let expNote = "";
      if (HN.can("finance")) { await saveAutoExpense(batch, "road", cost, rate, f.method?.value, expDate); await saveAutoExpense(batch, "service", service, rate, f.method?.value, expDate); if (cost > 0 || service > 0) expNote = ` Хароҷот: $${fmt(cost + service)} ба «Хароҷот» сабт шуд.`; }
      else if (cost > 0 || service > 0) expNote = " Хароҷотро муҳосиб ба «Хароҷот» сабт мекунад (иҷозати шумо нест).";
      $("batchFormDialog").close();
      HN.toast((id ? "Партия нав шуд." : "Партия сохта шуд.") + ` ${chosen.length} бор.` + expNote, "ok");
      await HN.reload(); if (id) openBatch(batch.id);
    } catch (err) { bad(HN.dbError(err)); await HN.reload(); }
  });
  let bAddQuery = "";
  function openBatch(id) {
    const b = S.batches.find(x => String(x.id) === String(id)); if (!b) return;
    const x = bStats(b), fin = HN.can("finance"), staff = HN.can("staff");
    const free = S.shipments.filter(s => !s.batch_id && (!bAddQuery || HN.matches(s, bAddQuery))).slice(0, 60);
    $("batchViewTitle").textContent = b.name; $("batchViewBody").dataset.id = b.id;
    $("batchViewBody").innerHTML = `
      <div class="detail-pills"><span class="pill bs-${esc(b.status)}">${BSTATUS[b.status]}</span>${b.vehicle ? `<span class="pill wh-delivered">${esc(b.vehicle)}</span>` : ""}</div>
      <div class="detail-money"><div><small>Ҳисоби борҳо</small><b>${money(x.billed)}</b></div>${fin ? `<div><small>Хароҷот</small><b>${money(x.cost)}</b></div><div><small>Фоида</small><b class="${x.profit < 0 ? "neg" : ""}">${money(x.profit)}</b></div>` : `<div><small>Борҳо</small><b>${x.n}</b></div>`}</div>
      <p class="muted">Фиристода: ${HN.fmtDate(b.sent_date)} · Расид: ${HN.fmtDate(b.arrived_date)} · ${x.n} бор · ${fmt(x.kg, 1)} кг · ${fmt(x.m3, 3)} м³${fin ? ` · Хароҷоти мошин: $${fmt(b.cost_usd)} × ${HN.fmtQty(b.fx_rate, 4)} · Ҳамаи хароҷот: ${money(x.cost)} TJS (${bExps(b).length} сабт дар «Хароҷот»)` : ""}</p>
      ${b.notes ? `<div class="detail-notes"><small>Ёддошт</small><p>${esc(b.notes)}</p></div>` : ""}
      <div class="detail-actions">
        ${staff ? `<button class="btn btn-ghost" data-bact="edit"><svg><use href="#i-edit"/></svg><span>Таҳрир</span></button>` : ""}
        ${staff && S.features.telegram && ["loading", "in_transit", "arrived"].includes(b.status) ? `<button class="btn btn-ghost" data-bact="tg" title="Ба ҳамаи муштариёни ин мошин дар Telegram хабар меравад"><svg><use href="#i-arrow"/></svg><span>Хабар ба муштариён (Telegram)</span></button>` : ""}
        ${staff && b.status !== "arrived" && b.status !== "closed" ? `<button class="btn btn-primary" data-bact="arrived"><svg><use href="#i-warehouse"/></svg><span>Расид — ба анбор</span></button>` : ""}
        <button class="btn btn-ghost" data-bact="export"><svg><use href="#i-download"/></svg><span>Excel</span></button>
        ${HN.can("delete") ? `<button class="btn btn-danger-soft" data-bact="delete"><svg><use href="#i-trash"/></svg><span>Нест кардан</span></button>` : ""}
      </div>
      <h3 class="detail-h">Борҳои партия (${x.n})</h3>
      ${x.n ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Рақам</th><th>Муштарӣ</th><th class="num">кг</th><th class="num">м³</th><th class="num">Ҳисоб</th><th></th></tr></thead><tbody>${x.ships.map(s => `<tr>${td(`<button class="link-btn" data-open-ship="${esc(s.id)}">${esc(s.tracking_no)}</button>`)}${td(esc(s.client_name))}${td(HN.fmtQty(s.weight_kg), "num")}${td(HN.fmtQty(s.volume_m3, 3), "num")}${td(money(HN.total(s)), "num")}<td class="acts">${staff ? `<button class="icon-btn sm danger" data-bremove="${esc(s.id)}" title="Аз партия баровардан" aria-label="Аз партия баровардан"><svg><use href="#i-x"/></svg></button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Ҳоло бор нест.</p>'}
      ${staff ? `<h3 class="detail-h">Илова кардани борҳо</h3>
      <label class="search"><svg><use href="#i-search"/></svg><input id="bAddSearch" type="search" value="${esc(bAddQuery)}" placeholder="Код, муштарӣ ё трек…" aria-label="Ҷустуҷӯи бор"></label>
      <div class="pick-list">${free.map(s => `<label class="pick"><input type="checkbox" value="${esc(s.id)}"><span><b>${esc(s.tracking_no)}</b> · ${esc(s.client_name)} <small>${HN.fmtDate(HN.shipmentDate(s))} · ${HN.fmtQty(s.weight_kg)} кг</small></span></label>`).join("") || '<p class="muted">Бори бе партия ёфт нашуд.</p>'}</div>
      ${free.length ? '<button class="btn btn-primary" data-bact="add"><svg><use href="#i-plus"/></svg><span>Илова ба партия</span></button>' : ""}` : ""}`;
    const body = $("batchViewBody");
    const search = $("bAddSearch"); if (search) search.oninput = () => { bAddQuery = search.value.trim(); const pos = search.selectionStart; openBatch(id); const n = $("bAddSearch"); n.focus(); n.setSelectionRange(pos, pos); };
    body.querySelectorAll("[data-bact]").forEach(btn => (btn.onclick = () => batchAction(b, btn.dataset.bact)));
    body.querySelectorAll("[data-bremove]").forEach(btn => (btn.onclick = async () => { const r = await S.db.from("shipments").update({ batch_id: null }).eq("id", btn.dataset.bremove); if (r.error) return HN.toast(HN.dbError(r.error), "error"); await HN.reload(); openBatch(id); }));
    if (!$("batchView").open) $("batchView").showModal();
  }
  async function batchAction(b, act) {
    if (act === "edit") { $("batchView").close(); openBatchForm(b); return; }
    if (act === "export") {
      const x = bStats(b);
      HN.exportXlsx(`HOJI-NAIM-${b.name}-${HN.today()}.xlsx`, [{ name: b.name, title: `HOJI-NAIM CARGO — ${b.name}${b.vehicle ? " (" + b.vehicle + ")" : ""}`, subtitle: `Фиристода: ${HN.fmtDate(b.sent_date)} · Расид: ${HN.fmtDate(b.arrived_date)} · Хароҷот: ${money(x.cost)} TJS · Фоида: ${money(x.profit)} TJS`, columns: HN.cols.shipments(), rows: x.ships }]);
      return;
    }
    if (act === "add") {
      const ids = [...$("batchViewBody").querySelectorAll(".pick input:checked")].map(i => i.value);
      if (!ids.length) { HN.toast("Борҳоро интихоб кунед."); return; }
      const r = await S.db.from("shipments").update({ batch_id: b.id }).in("id", ids);
      if (r.error) { HN.toast(HN.dbError(r.error), "error"); return; }
      HN.toast(`${ids.length} бор ба «${b.name}» илова шуд.`, "ok"); await HN.reload(); openBatch(b.id); return;
    }
    if (act === "tg") {
      const label = BSTATUS[b.status] || b.status;
      if (!(await HN.confirm(`Ба ҳамаи муштариёни «${b.name}» хабари «${label}» фиристода шавад?`, { ok: "Фиристодан" }))) return;
      const r = await S.db.functions.invoke(HN.config.tgFunction, { body: { action: "batch", batch_id: b.id, status: b.status } });
      if (r.error || !r.data?.ok) { HN.toast("Хабар нарафт: " + (r.data?.error || r.error?.message || "бот танзим нашудааст"), "error"); return; }
      HN.toast(r.data.sent ? `Хабар ба ${r.data.sent} муштарӣ рафт.` : "Ҳеҷ кадом муштарии ин мошин ба бот обуна нест.", r.data.sent ? "ok" : "info"); return;
    }
    if (act === "arrived") {
      const x = bStats(b), toStock = x.ships.filter(s => HN.whStatus(s) !== "delivered");
      if (!(await HN.confirm(`Партияи «${b.name}» расид? ${toStock.length} бор ба ҳолати «Дар анбор» мегузарад.`, { ok: "Ҳа, расид" }))) return;
      const r = await S.db.from("batches").update({ status: "arrived", arrived_date: b.arrived_date || HN.today() }).eq("id", b.id);
      if (r.error) { HN.toast(HN.dbError(r.error), "error"); return; }
      if (toStock.length && S.features.warehouse) { const r2 = await S.db.from("shipments").update({ warehouse_status: "in_warehouse" }).in("id", toStock.map(s => s.id)); if (r2.error) HN.toast(HN.dbError(r2.error), "error"); }
      HN.toast("Партия расид. Борҳо дар анбор.", "ok"); await HN.reload(); openBatch(b.id); return;
    }
    if (act === "delete") {
      if (!(await HN.confirm(`Партияи «${b.name}» нест карда шавад? Борҳо ва хароҷот нест намешаванд, танҳо аз партия ҷудо мешаванд.`, { title: "Нест кардани партия", ok: "Нест кардан", danger: true }))) return;
      const r = await S.db.from("batches").delete().eq("id", b.id);
      if (r.error) { HN.toast(HN.dbError(r.error), "error"); return; }
      $("batchView").close(); HN.toast("Партия нест шуд.", "ok"); await HN.reload();
    }
  }

  /* ================= Акт сверки (customer statement) ================= */
  let stKey = null;
  function statementData(key, from, to) {
    const ships = S.shipments.filter(s => HN.customerKey(s) === key);
    const c = HN.customers().find(x => x.key === key) || { name: ships[0]?.client_name || "Муштарӣ", code: "", phone: "" };
    const ids = new Set(ships.map(s => String(s.id)));
    const lines = [];
    ships.forEach(s => { const disc = HN.noteNumber(s, "Тахфиф"); lines.push({ date: HN.shipmentDate(s), order: 0, text: `Бор ${s.tracking_no} · ${HN.fmtQty(s.weight_kg)} кг / ${HN.fmtQty(s.volume_m3, 3)} м³${disc ? ` · тахфиф $${fmt(disc)}` : ""}`, debit: HN.total(s), credit: 0 }); });
    S.payments.filter(p => ids.has(String(p.shipment_id))).forEach(p => { const s = HN.shipmentById(p.shipment_id); lines.push({ date: String(p.payment_date).slice(0, 10), order: 1, text: `Пардохт (${HN.methodText[p.method] || "—"}) · ${s?.tracking_no || ""}${p.currency !== "TJS" ? ` · ${money(p.amount_original)} ${p.currency}` : ""}`, debit: 0, credit: HN.num(p.amount_tjs) }); });
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    const opening = lines.filter(l => from && l.date < from).reduce((n, l) => n + l.debit - l.credit, 0);
    let bal = opening;
    const rows = lines.filter(l => HN.inRange(l.date, from || null, to || null)).map(l => ({ ...l, bal: (bal += l.debit - l.credit) }));
    const debit = rows.reduce((n, l) => n + l.debit, 0), credit = rows.reduce((n, l) => n + l.credit, 0);
    return { c, rows, opening, debit, credit, closing: opening + debit - credit };
  }
  function openStatement(key) {
    stKey = key; $("stFrom").value = ""; $("stTo").value = HN.today();
    renderStatement(); $("stmtDialog").showModal();
  }
  function renderStatement() {
    const d = statementData(stKey, $("stFrom").value, $("stTo").value);
    $("stTitle").textContent = d.c.name;
    $("stSub").textContent = [d.c.code && "Код: " + d.c.code, d.c.phone && "Тел: " + d.c.phone].filter(Boolean).join(" · ") || "—";
    $("stBody").innerHTML = `
      <div class="detail-money"><div><small>Ҳисоб</small><b>${money(d.debit)}</b></div><div><small>Пардохт</small><b>${money(d.credit)}</b></div><div><small>${d.closing >= 0 ? "Қарз" : "Пешпардохт"}</small><b class="${d.closing > 0.005 ? "neg" : ""}">${money(Math.abs(d.closing))}</b></div></div>
      <div class="table-wrap"><table class="tbl st-table"><thead><tr><th>Сана</th><th>Амалиёт</th><th class="num">Ҳисоб</th><th class="num">Пардохт</th><th class="num">Бақия</th></tr></thead><tbody>
      ${$("stFrom").value ? `<tr class="st-open">${td(HN.fmtDate($("stFrom").value))}${td("Бақия дар аввал")}${td("")}${td("")}${td(`<b>${money(d.opening)}</b>`, "num")}</tr>` : ""}
      ${d.rows.map(l => `<tr>${td(HN.fmtDate(l.date), "nowrap")}${td(esc(l.text))}${td(l.debit ? money(l.debit) : "", "num")}${td(l.credit ? money(l.credit) : "", "num")}${td(money(l.bal), "num" + (l.bal > 0.005 ? " neg" : ""))}</tr>`).join("")}
      </tbody><tfoot><tr>${td("Ҳамагӣ")}${td("")}${td(money(d.debit), "num")}${td(money(d.credit), "num")}${td(money(d.closing), "num")}</tr></tfoot></table></div>
      <p class="st-sign">HOJI-NAIM CARGO · ${HN.fmtDate(HN.today())} · Бақия ба ${HN.fmtDate($("stTo").value || HN.today())}: <b>${money(d.closing)} TJS</b></p>`;
    return d;
  }
  function statementText(d) {
    const lines = d.rows.slice(-15).map(l => `${HN.fmtDate(l.date)} ${l.debit ? "+" + money(l.debit) : "−" + money(l.credit)}  ${l.text}`);
    return `HOJI-NAIM CARGO\nАкт сверки: ${d.c.name}${d.c.code ? " (" + d.c.code + ")" : ""}\nСана: ${HN.fmtDate(HN.today())}\n\n${lines.join("\n")}\n\nҲисоб: ${money(d.debit)} TJS\nПардохт: ${money(d.credit)} TJS\n${d.closing >= 0 ? "Қарз" : "Пешпардохт"}: ${money(Math.abs(d.closing))} TJS`;
  }
  ["stFrom", "stTo"].forEach(id => $(id)?.addEventListener("input", renderStatement));
  $("stPrint")?.addEventListener("click", () => { document.body.classList.add("print-stmt"); window.print(); setTimeout(() => document.body.classList.remove("print-stmt"), 500); });
  $("stExcel")?.addEventListener("click", () => {
    const d = statementData(stKey, $("stFrom").value, $("stTo").value);
    const rows = ($("stFrom").value ? [{ date: $("stFrom").value, text: "Бақия дар аввал", debit: "", credit: "", bal: d.opening }] : []).concat(d.rows);
    HN.exportXlsx(`HOJI-NAIM-Акт-${d.c.code || d.c.name}-${HN.today()}.xlsx`, [{ name: "Акт сверки", title: `HOJI-NAIM CARGO — Акт сверки: ${d.c.name}`, subtitle: `Код: ${d.c.code || "—"} · Тел: ${d.c.phone || "—"} · Сана: ${HN.fmtDate(HN.today())}`, columns: [
      { header: "Сана", value: l => l.date, type: "date", width: 12 }, { header: "Амалиёт", value: l => l.text, width: 50 },
      { header: "Ҳисоб (TJS)", value: l => l.debit, type: "money", width: 14, total: true }, { header: "Пардохт (TJS)", value: l => l.credit, type: "money", width: 14, total: true }, { header: "Бақия (TJS)", value: l => l.bal, type: "money", width: 14, red: true },
    ], rows }]);
  });
  $("stCopy")?.addEventListener("click", async () => {
    const t = statementText(statementData(stKey, $("stFrom").value, $("stTo").value));
    try { await navigator.clipboard.writeText(t); HN.toast("Матн нусха шуд — ба WhatsApp гузоред.", "ok"); } catch { HN.toast("Нусха нашуд. Матнро дастӣ нусха кунед."); }
  });
  $("stWhatsapp")?.addEventListener("click", () => {
    const d = statementData(stKey, $("stFrom").value, $("stTo").value);
    let phone = HN.digits(d.c.phone); if (phone.length === 9) phone = "992" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(statementText(d))}`, "_blank", "noopener");
  });

  // Акт сверки to the customer's Telegram through the bot (same text as WhatsApp, for the chosen dates).
  $("stTelegram")?.addEventListener("click", async () => {
    const d = statementData(stKey, $("stFrom").value, $("stTo").value);
    const ship = S.shipments.filter(s => HN.customerKey(s) === stKey).sort((a, b) => String(HN.shipmentDate(b)).localeCompare(String(HN.shipmentDate(a))))[0];
    if (!ship) { HN.toast("Барои ин муштарӣ бор нест."); return; }
    if (!(await HN.confirm(`Акт сверки ба Telegram-и «${d.c.name}» фиристода шавад?`, { ok: "Фиристодан" }))) return;
    const btn = $("stTelegram"); btn.disabled = true;
    try { await HN.tgSend(ship.id, "akt", statementText(d)); } finally { btn.disabled = false; }
  });

  /* ================= Telegram ================= */
  const phoneKey = p => HN.digits(p).slice(-9);
  // Same normalisation as the bot: "S-50", "s 50", Cyrillic "С-50" → "S50".
  const LOOK = { А: "A", Б: "B", В: "V", Д: "D", Е: "E", З: "Z", И: "I", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F" };
  HN.tgCodeKey = v => String(v || "").toUpperCase().replace(/[АБВДЕЗИКЛМНОПРСТУФ]/g, c => LOOK[c]).replace(/[^0-9A-ZА-ЯЁӢӮҚҒҲҶ]/g, "").slice(0, 30);
  HN.tgSubscribed = s => {
    const code = HN.tgCodeKey(HN.customerCode(s)), k = phoneKey(s.client_phone);
    return (S.tgSubs || []).some(x => (code && x.code_key === code) || (k.length >= 7 && x.phone_key === k));
  };
  // Personal link t.me/<bot>?start=<CODE>_<KEY>. The key is stored in telegram_invites (staff only) and made once per code.
  const PIN_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  HN.tgLink = async s => {
    let bot = HN.lsGet("hn-tg-bot", "");
    const code = HN.tgCodeKey(HN.customerCode(s));
    if (!code) return "";
    if (!bot) {   // each computer learns the bot name once from the bot itself
      const r = await S.db.functions.invoke(HN.config.tgFunction, { body: { action: "info" } }).catch(() => ({}));
      bot = r?.data?.ok ? r.data.username : "";
      if (!bot) return "";
      HN.lsSet("hn-tg-bot", bot);
    }
    let { data, error } = await S.db.from("telegram_invites").select("pin").eq("code_key", code).maybeSingle();
    if (error) throw error;
    let pin = data?.pin;
    if (!pin) {
      pin = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => PIN_ABC[b % 32]).join("");
      const ins = await S.db.from("telegram_invites").insert({ code_key: code, pin });
      if (ins.error) { const again = await S.db.from("telegram_invites").select("pin").eq("code_key", code).maybeSingle(); if (again.error || !again.data) throw ins.error; pin = again.data.pin; }
    }
    return `https://t.me/${bot}?start=${code}_${pin}`;
  };
  const TG_EVENT = { remind: "Ёдраскунии қарз", broadcast: "Хабар ба ҳама", to_operator: "Савол ба оператор", operator: "Ҷавоби оператор", akt: "Акт сверка", registered: "Бор қабул шуд", arrived: "Бор расид", paid: "Пардохт", delivered: "Супорида шуд", custom: "Паёми дастӣ", batch_loading: "Мошин: бор шуда истодааст", batch_in_transit: "Мошин: дар роҳ", batch_arrived: "Мошин: расид" };
  const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 56]).join("");
  function telegramCard() {
    const bot = HN.lsGet("hn-tg-bot", "");
    const steps = `<ol class="setup-steps">
      <li>Telegram → <b>@BotFather</b> → <code>/newbot</code> → ном ва username (масалан <code>hoji_naim_cargo_bot</code>) → <b>токен</b>-ро нусха кунед.</li>
      <li>Supabase → <b>Edge Functions → Deploy a new function → Via Editor</b>, ном: <code>telegram-bot</code>. Матни файли <code>supabase/functions/telegram-bot/index.ts</code>-ро аз GitHub гузоред → <b>Deploy</b>. Баъд дар танзимоти функсия <b>«Verify JWT»</b>-ро <b>хомӯш</b> кунед.</li>
      <li>Supabase → <b>Edge Functions → Secrets</b>: <code>TELEGRAM_BOT_TOKEN</code> = токен; <code>TELEGRAM_WEBHOOK_SECRET</code> ва <code>HOOK_SECRET</code> = ду калиди тасодуфӣ (тугмаи поён).</li>
      <li>SQL Editor: файли <code>supabase/telegram.sql</code> → дар он <code>ИВАЗ_КУНЕД_HOOK_SECRET</code>-ро бо ҳамон <code>HOOK_SECRET</code> иваз кунед → <b>Run</b>.</li>
      <li>Пайвасти бот: дар браузер ин суроғаро кушоед (токен ва калидро гузоред):<br><code class="wrap">https://api.telegram.org/bot&lt;ТОКЕН&gt;/setWebhook?url=${esc(HN.config.supabaseUrl)}/functions/v1/${esc(HN.config.tgFunction)}&amp;secret_token=&lt;TELEGRAM_WEBHOOK_SECRET&gt;</code><br>Бояд <code>"ok":true</code> барояд.</li>
    </ol>
    <div class="btn-row"><button class="btn btn-ghost" id="tgSecretBtn" type="button">Калиди тасодуфӣ</button><code id="tgSecret" class="secret-out"></code></div>`;
    if (!S.features.telegram) return `<div class="panel span-all"><div class="panel-head"><div><h3>Telegram бот барои муштариён</h3><p class="muted">Муштарӣ ботро мекушояд, коди худро (масалан S-50) менависад ва хабарҳоро шахсан мегирад: бор расид, пардохт қабул шуд, бор супорида шуд, қарз.</p></div></div>${steps}</div>`;
    const log = (S.tgLog || []).slice(0, 8);
    return `<div class="panel span-all"><div class="panel-head"><div><h3>Telegram бот</h3><p class="muted">Обуначиён: <b>${S.tgSubs.length}</b>${S.tgSubs.some(x => x.code_key) ? " (" + esc([...new Set(S.tgSubs.map(x => x.code_key).filter(Boolean))].slice(0, 12).join(", ")) + ")" : ""}. Муштарӣ дар бот коди худро менависад (масалан S-50). Паёмҳо худкор мераванд: бор расид · пардохт · супоридан.</p></div>
      <div class="btn-row"><label class="field"><span>Username-и бот</span><input id="tgBot" value="${esc(bot)}" placeholder="hoji_naim_cargo_bot"></label><button class="btn btn-ghost" id="tgInfo" type="button">Санҷиши бот</button></div></div>
      <p>Саҳифа барои муштариён (код + телефон → Telegram): <a href="${esc(new URL("telegram.html", location.href).href)}" target="_blank" rel="noopener"><b>${esc(new URL("telegram.html", location.href).href)}</b></a> <button class="btn btn-xs btn-soft" id="tgPageCopy" type="button">Нусха</button></p>
      ${bot ? `<p>Пайванд барои муштариён: <a href="https://t.me/${esc(bot)}" target="_blank" rel="noopener"><b>t.me/${esc(bot)}</b></a> <button class="btn btn-xs btn-soft" id="tgCopy" type="button">Нусха</button></p>` : '<p class="hint">Username-и ботро нависед, то пайванд барои муштариён пайдо шавад.</p>'}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Вақт</th><th>Паём</th><th>Бор</th><th>Ҳолат</th></tr></thead><tbody>${log.map(l => `<tr><td class="nowrap">${HN.fmtDateTime(l.created_at)}</td><td>${TG_EVENT[l.event] || esc(l.event)}</td><td>${esc(HN.shipmentById(l.shipment_id)?.tracking_no || "—")}</td><td>${l.ok ? '<span class="pill pay-paid">Фиристода шуд</span>' : `<span class="pill pay-unpaid" title="${esc(l.error)}">Хато</span>`}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Ҳоло паём нафиристода шудааст.</td></tr>'}</tbody></table></div>
      ${HN.can("admin") ? `<form id="tgTexts" class="tg-texts"><h4>Матнҳои менюи бот</h4><p class="hint">Муштарӣ дар бот тугмаҳои «💵 Нархҳо», «📍 Суроғаи анбор», «💳 Пардохт» ва «☎️ Оператор»-ро пахш мекунад ва ҳамин матнро мебинад. Аз рақами оператор тугмаи WhatsApp худкор сохта мешавад.</p>
        <label class="field"><span>💵 Нархҳо</span><textarea name="tg_prices" rows="3" maxlength="1500" placeholder="Масалан: 1 м³ — 200 $, 1 кг — 1 $. Ҳисоб аз рӯи куб ё кг, кадоме ки зиёд бошад.">${esc(S.tgTexts?.tg_prices || "")}</textarea></label>
        <label class="field"><span>📍 Суроғаи анбор</span><textarea name="tg_address" rows="2" maxlength="1000" placeholder="Масалан: ш. Душанбе, кӯчаи …, анбори № … Соати корӣ: 9:00–18:00">${esc(S.tgTexts?.tg_address || "")}</textarea></label>
        <label class="field"><span>☎️ Оператор</span><textarea name="tg_contact" rows="2" maxlength="1000" placeholder="Масалан: +992 … (WhatsApp, Telegram)">${esc(S.tgTexts?.tg_contact || "")}</textarea></label>
        <label class="field"><span>💳 Пардохт — чӣ тавр пардохт кунанд</span><textarea name="tg_payment" rows="2" maxlength="1000" placeholder="Масалан: Корти Алиф 1234 … (ба номи …), Душанбе Сити …, ё дар анбор нақд.">${esc(S.tgTexts?.tg_payment || "")}</textarea></label>
        <button class="btn btn-primary" type="submit">Сабт</button></form>
      <div class="tg-texts"><h4>💬 Паёмҳои муштариён → гурӯҳи кормандон</h4>
        <p class="hint">Муштарӣ ба бот савол менависад (матн, расм, овоз) — паём ба гурӯҳи Telegram-и кормандон меояд. Оператор дар гурӯҳ ба он паём <b>Reply (Ответить)</b> мекунад ва ҷавоб ба муштарӣ меравад.</p>
        ${S.tgTexts?.tg_staff_chat ? '<p><span class="pill pay-paid">Гурӯҳ пайваст аст ✓</span></p>' : '<p><span class="pill pay-unpaid">Гурӯҳ ҳанӯз пайваст нест</span></p>'}
        <ol class="setup-steps"><li>Дар Telegram гурӯҳ созед (масалан «HOJI-NAIM — Операторҳо») ва кормандонро илова кунед.</li><li>Ботро <b>@${esc(bot || "hoji_naim_cargo_bot")}</b> ба гурӯҳ илова кунед.</li><li>Дар гурӯҳ нависед: <code>/link ${esc(S.tgTexts?.tg_link_code || "——————")}</code></li></ol>
        <div class="btn-row"><button class="btn btn-ghost" type="button" id="tgLinkCode">${S.tgTexts?.tg_link_code ? "Коди нав" : "Код гирифтан"}</button></div></div>
      <div class="tg-texts"><h4>⏰ Ёдраскунии қарз</h4>
        <p class="hint">Ҳар душанбе соати 10:00 ба муштариёне, ки қарз доранд, худкор паём меравад (рӯйхати қарзҳо бо сомонӣ ва доллар).</p>
        <label class="check"><input type="checkbox" id="tgRemindOn" ${S.tgTexts?.tg_remind === "off" ? "" : "checked"}> <span>Ҳар ҳафта фиристода шавад</span></label>
        <div class="btn-row"><button class="btn btn-ghost" type="button" id="tgRemindNow">Ҳозир фиристодан</button></div></div>
      <div class="tg-texts"><h4>📢 Хабар ба ҳамаи муштариён</h4>
        <textarea id="tgBroadcast" rows="3" maxlength="3500" placeholder="Масалан: Рӯзи ид (15.12) анбор баста аст. Аз 16.12 кор мекунем."></textarea>
        <div class="btn-row"><button class="btn btn-primary" type="button" id="tgBroadcastBtn">Ба ҳама фиристодан</button></div></div>` : ""}
      <details class="setup"><summary>Дастури насб</summary>${steps}</details></div>`;
  }
  let tgAsked = false;
  function wireTelegramCard() {
    const tf = $("tgTexts");
    if (tf) tf.onsubmit = async e => {
      e.preventDefault();
      const rows = ["tg_prices", "tg_address", "tg_contact", "tg_payment"].map(key => ({ key, value: tf.elements[key].value.trim() }));
      const r = await HN.putRows("app_settings", "key", rows);
      if (r.error) { HN.toast(HN.dbError(r.error), "error"); return; }
      rows.forEach(x => (S.tgTexts[x.key] = x.value)); HN.toast("Матнҳои бот сабт шуданд.", "ok");
    };
    const setSetting = async (key, value) => { const r = await HN.putRow("app_settings", "key", { key, value }); if (r.error) { HN.toast(HN.dbError(r.error), "error"); return false; } S.tgTexts[key] = value; return true; };
    const invoke = async (body, okMsg) => {
      const r = await S.db.functions.invoke(HN.config.tgFunction, { body });
      if (r.error || !r.data?.ok) { HN.toast("Нарафт: " + (r.data?.error || r.error?.message || "бот ҷавоб надод"), "error"); return null; }
      HN.toast(okMsg(r.data), "ok"); return r.data;
    };
    if ($("tgLinkCode")) $("tgLinkCode").onclick = async () => {
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      if (await setSetting("tg_link_code", code)) { HN.toast("Код: " + code + " — дар гурӯҳ нависед: /link " + code, "ok"); renderAdminExtras(); }
    };
    if ($("tgRemindOn")) $("tgRemindOn").onchange = async e => { if (await setSetting("tg_remind", e.target.checked ? "on" : "off")) HN.toast(e.target.checked ? "Ёдраскунӣ ҳар ҳафта меравад." : "Ёдраскунии ҳарҳафтаина хомӯш шуд.", "ok"); };
    if ($("tgRemindNow")) $("tgRemindNow").onclick = async () => {
      if (!(await HN.confirm("Ба ҳамаи муштариёне, ки қарз доранд, ҳозир ёдраскунӣ фиристода шавад?", { ok: "Фиристодан" }))) return;
      await invoke({ action: "remind" }, d => `Ёдраскунӣ ба ${d.sent} муштарӣ рафт.`);
    };
    if ($("tgBroadcastBtn")) $("tgBroadcastBtn").onclick = async () => {
      const text = $("tgBroadcast").value.trim();
      if (!text) { HN.toast("Матни хабарро нависед.", "error"); return; }
      if (!(await HN.confirm(`Ин хабар ба ҳамаи обуначиён (${S.tgSubs.length}) фиристода шавад?\n\n${text}`, { ok: "Ба ҳама фиристодан" }))) return;
      if (await invoke({ action: "broadcast", text }, d => `Хабар ба ${d.sent} аз ${d.total} муштарӣ рафт.`)) $("tgBroadcast").value = "";
    };
    if (S.features.telegram && !HN.lsGet("hn-tg-bot", "") && !tgAsked) {
      tgAsked = true;   // fill the bot name once, without pressing «Санҷиши бот»
      S.db.functions.invoke(HN.config.tgFunction, { body: { action: "info" } }).then(r => { if (r?.data?.ok && r.data.username) { HN.lsSet("hn-tg-bot", r.data.username); renderAdminExtras(); } }).catch(() => {});
    }
    if ($("tgSecretBtn")) $("tgSecretBtn").onclick = () => { $("tgSecret").textContent = randomSecret(); };
    if ($("tgBot")) $("tgBot").onchange = e => { HN.lsSet("hn-tg-bot", e.target.value.trim().replace(/^@/, "")); renderAdminExtras(); };
    if ($("tgPageCopy")) $("tgPageCopy").onclick = async () => { try { await navigator.clipboard.writeText(new URL("telegram.html", location.href).href); HN.toast("Пайванд нусха шуд.", "ok"); } catch { HN.toast("Нусха нашуд."); } };
    if ($("tgCopy")) $("tgCopy").onclick = async () => { try { await navigator.clipboard.writeText("https://t.me/" + HN.lsGet("hn-tg-bot", "")); HN.toast("Пайванд нусха шуд.", "ok"); } catch { HN.toast("Нусха нашуд."); } };
    if ($("tgInfo")) $("tgInfo").onclick = async () => {
      const r = await S.db.functions.invoke(HN.config.tgFunction, { body: { action: "info" } });
      if (r.error || !r.data?.ok) { HN.toast("Бот ҷавоб надод. Қадамҳои 2–3-ро санҷед.", "error"); return; }
      HN.lsSet("hn-tg-bot", r.data.username); HN.toast("Бот кор мекунад: @" + r.data.username, "ok"); renderAdminExtras();
    };
  }
  /* Ready texts the staff can edit before sending. */
  HN.tgTemplates = s => {
    const name = s.client_name ? ", " + s.client_name : "", paid = HN.paid(s), debt = HN.debt(s);
    const pays = (S.payments || []).filter(p => String(p.shipment_id) === String(s.id)).sort((a, b) => String(a.payment_date || a.created_at).localeCompare(String(b.payment_date || b.created_at)));
    const last = pays.length ? HN.num(pays[pays.length - 1].amount_tjs) : 0;
    const left = debt > 0.005 ? `Қарзи боқимонда: ${money(debt)} сомонӣ` : "Бор пурра пардохт шуд ✅";
    return {
      arrived: `📦 Ассалому алейкум${name}!\nБори шумо дар Душанбе расид.\n\nРақам: ${s.tracking_no}\nҶой: ${HN.places(s)} · Вазн: ${HN.fmtQty(s.weight_kg, 1)} кг · Ҳаҷм: ${HN.fmtQty(s.volume_m3, 3)} м³\nМаблағ: ${money(HN.total(s))} сомонӣ${paid > 0 ? `\nПардохт шуд: ${money(paid)} сомонӣ` : ""}\n${debt > 0.005 ? `Барои пардохт: ${money(debt)} сомонӣ` : "Бор пурра пардохт шудааст ✅"}\n\nHOJI-NAIM CARGO`,
      paid: `✅ Ассалому алейкум${name}!\nПардохти шумо қабул шуд${last ? `: ${money(last)} сомонӣ` : ""}.\n\nБор: ${s.tracking_no}\nҲамагӣ пардохт шуд: ${money(paid)} аз ${money(HN.total(s))} сомонӣ\n${left}\n\nРаҳмат! HOJI-NAIM CARGO`,
      delivered: `🤝 Ассалому алейкум${name}!\nБори ${s.tracking_no} ба шумо супорида шуд.\n\nҶой: ${HN.places(s)} · Вазн: ${HN.fmtQty(s.weight_kg, 1)} кг\nПардохт шуд: ${money(paid)} сомонӣ\n${left}\n\nРаҳмат, ки HOJI-NAIM CARGO-ро интихоб кардед!`,
    };
  };
  let tgShip = null, tgEvent = "arrived";
  const tgPick = ev => { tgEvent = ev; $("tgText").value = HN.tgTemplates(tgShip)[ev]; document.querySelectorAll("#tgTpl [data-tpl]").forEach(b => b.classList.toggle("on", b.dataset.tpl === ev)); };
  HN.openTg = s => {
    tgShip = s;
    $("tgWho").textContent = `${s.client_name || ""}${HN.customerCode(s) ? " · " + HN.customerCode(s) : ""} · ${s.tracking_no}`;
    tgPick(HN.whStatus(s) === "delivered" ? "delivered" : HN.paid(s) > 0 ? "paid" : "arrived");
    $("tgDialog").showModal(); $("tgText").focus();
  };
  document.querySelectorAll("#tgTpl [data-tpl]").forEach(b => b.addEventListener("click", () => tgPick(b.dataset.tpl)));
  $("tgCancel")?.addEventListener("click", () => $("tgDialog").close());
  $("tgSendBtn")?.addEventListener("click", async () => {
    const text = $("tgText").value.trim();
    if (!text) { HN.toast("Матнро нависед.", "error"); return; }
    const btn = $("tgSendBtn"); btn.disabled = true;
    try { if (await HN.tgSend(tgShip.id, tgEvent, text)) $("tgDialog").close(); } finally { btn.disabled = false; }
  });
  HN.tgSend = async (shipmentId, event, text) => {
    const r = await S.db.functions.invoke(HN.config.tgFunction, { body: { action: "send", shipment_id: shipmentId, event, ...(text ? { text } : {}) } });
    if (r.error || !r.data?.ok) { HN.toast("Паём нарафт: " + (r.data?.error || r.error?.message || "бот танзим нашудааст"), "error"); return false; }
    HN.toast(r.data.sent ? `Паём ба Telegram рафт (${r.data.sent}).` : "Муштарӣ ҳанӯз ба бот обуна нашудааст.", r.data.sent ? "ok" : "info");
    await HN.reload();
    return !!r.data.sent;
  };
  HN.waArrived = s => {
    const debt = HN.debt(s);
    const text = `Ассалому алейкум${s.client_name ? ", " + s.client_name : ""}!\nБори шумо дар Душанбе расид.\nРақам: ${s.tracking_no}\nҶой: ${HN.places(s)} · Вазн: ${HN.fmtQty(s.weight_kg, 1)} кг · Ҳаҷм: ${HN.fmtQty(s.volume_m3, 3)} м³\nМаблағ: ${money(HN.total(s))} сомонӣ${debt > 0.005 ? `\nБарои пардохт: ${money(debt)} сомонӣ` : "\nБор пурра пардохт шудааст."}\n\nHOJI-NAIM CARGO`;
    let phone = HN.digits(s.client_phone); if (phone.length === 9) phone = "992" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  /* ================= Admin cards: rates, period lock, backup ================= */
  const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); return HN.isoDate(new Date(y, mo - 1 + n, 1)).slice(0, 7); };
  // the month the next notebook is for: this calendar month, or the one after the open notebook if that is already this month
  const nextBookMonth = () => { const cur = HN.today().slice(0, 7); return !S.bookMonth || S.bookMonth < cur ? cur : shiftMonth(S.bookMonth, 1); };
  function renderAdminExtras() {
    const box = $("adminExtras"); if (!box) return;
    const last = allRates().slice(-8).reverse();
    const fin = HN.can("finance"), admin = HN.can("admin");
    const lastBackup = HN.lsGet("hn-last-backup", null);
    const days = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 864e5) : null;
    // Month picker in Tajik: the last 12 months; the first month that is not closed yet is chosen (not later than this month).
    const thisMonth = HN.today().slice(0, 7), closedTo = S.closedUntil ? String(S.closedUntil).slice(0, 7) : "";
    const lockMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -i));
    const prevMonth = closedTo ? (shiftMonth(closedTo, 1) > thisMonth ? thisMonth : shiftMonth(closedTo, 1)) : shiftMonth(thisMonth, -1);
    box.innerHTML = `
      <div class="panel">
        <div class="panel-head"><div><h3>Қурби рӯз</h3><p class="muted">Қурби доллар ва юан ба сомонӣ. Дар формаҳо ва ҳисобот бо доллар истифода мешавад.${S.features.rates ? "" : " Ҳоло танҳо дар ҳамин браузер (SQL лозим)."}</p></div></div>
        ${fin ? `<form id="rateForm" class="rate-form"><label class="field"><span>Сана</span><input name="date" type="date" value="${HN.today()}" required></label><label class="field"><span>1 $ = TJS</span><input name="usd" type="number" step="any" min="0.0001" value="${HN.rateOn(HN.today())}" required></label><label class="field"><span>1 ¥ = TJS</span><input name="cny" type="number" step="any" min="0" value="${HN.latestCny() || D.cnyRate}"></label><button class="btn btn-primary" type="submit"><svg><use href="#i-check"/></svg><span>Сабт</span></button></form>` : ""}
        <ul class="rate-list">${last.map(r => `<li><span>${HN.fmtDate(r.rate_date)}</span><b>$1 = ${HN.fmtQty(r.usd, 4)}</b>${r.cny ? `<small>¥1 = ${HN.fmtQty(r.cny, 4)}</small>` : ""}</li>`).join("") || '<li class="muted">Ҳоло қурб сабт нашудааст.</li>'}</ul>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Пӯшидани моҳ</h3><p class="muted">Варақҳои Excel-и моҳ (Иву ва Урумчи) ба «Бойгонӣ» мераванд ва дафтари нави холӣ барои моҳи оянда кушода мешавад. Қарзи муштариён гум намешавад. Борҳо, пардохтҳо ва хароҷоти моҳи пӯшида иваз ё нест намешаванд.</p></div></div>
        ${!S.features.lock ? '<p class="hint">Барои ин қисм SQL-и supabase/SETUP-ALL.sql-ро иҷро кунед.</p>' : `
        <p>${S.closedUntil ? `Ҳоло пӯшида то: <b>${HN.fmtDate(S.closedUntil)}</b>` : "Ҳоло ягон давра пӯшида нест."}</p>
        <div class="newmonth">
          <div><span class="muted">Дафтари Excel-и ҳозира</span><b>${S.bookMonth ? HN.monthLabel(S.bookMonth) : "моҳ ҳанӯз интихоб нашудааст"}</b></div>
          ${admin ? `<button class="btn btn-gold" id="newMonthBtn" type="button"><svg><use href="#i-plus"/></svg><span>Моҳи навро кушодан · ${HN.monthLabel(nextBookMonth())}</span></button>` : ""}
        </div>
        <p><button type="button" class="link-btn" id="archOpenBtn">Бойгонӣ: моҳҳои пӯшида →</button></p>
        ${admin ? `<div class="btn-row"><label class="field"><span>Моҳ</span><select id="lockMonth">${lockMonths.map(m => `<option value="${m}"${m === prevMonth ? " selected" : ""}>${HN.monthLabel(m)}${closedTo && m <= closedTo ? " · пӯшида" : ""}</option>`).join("")}</select></label><button class="btn btn-primary" id="lockBtn"><svg><use href="#i-shield"/></svg><span>Пӯшидан</span></button>${S.closedUntil ? '<button class="btn btn-ghost" id="unlockBtn">Кушодан</button>' : ""}</div>` : '<p class="muted">Танҳо админ давраро мепӯшад.</p>'}`}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Нусхаи эҳтиётии худкор</h3><p class="muted">Ҳар шаб GitHub аз база нусхаи рамзгузоришуда (AES-256) мегирад ва 90 рӯз нигоҳ медорад.</p></div></div>
        <ol class="setup-steps"><li>GitHub → репозиторияи HOJI-NAIM → <b>Settings → Secrets and variables → Actions</b>.</li><li><b>New repository secret</b>: <code>SUPABASE_SERVICE_ROLE_KEY</code> — аз Supabase → Project Settings → API (калиди service_role).</li><li>Боз як secret: <code>BACKUP_PASSWORD</code> — пароли дарозе, ки худатон медонед.</li><li>Нусхаҳо дар <b>Actions → Nightly encrypted backup</b> пайдо мешаванд.</li></ol>
        <p class="muted">Нусхаи дастӣ дар ҳамин браузер: ${days === null ? "ҳанӯз гирифта нашудааст" : days === 0 ? "имрӯз" : days + " рӯз пеш"}.${days === null || days > 7 ? ' <b class="neg">Нусха гиред!</b>' : ""}</p>
      </div>
      ${telegramCard()}`;
    wireTelegramCard();
    const rf = $("rateForm");
    if (rf) rf.onsubmit = async e => { e.preventDefault(); const f = rf.elements; const usd = HN.num(f.usd.value), cny = HN.num(f.cny.value); if (usd <= 0) return HN.toast("Қурби долларро дуруст нависед.", "error"); try { await saveRate(f.date.value, usd, cny); HN.toast("Қурб сабт шуд: $1 = " + HN.fmtQty(usd, 4), "ok"); renderAdminExtras(); } catch (er) { HN.toast(HN.dbError(er), "error"); } };
    if ($("lockBtn")) $("lockBtn").onclick = async () => {
      const m = $("lockMonth").value; if (!m) return;
      const [y, mo] = m.split("-").map(Number), until = HN.isoDate(new Date(y, mo, 0)), next = HN.isoDate(new Date(y, mo, 1)).slice(0, 7);
      const label = HN.monthLabel(m), nb = [HN.notebook, HN.notebookUru].filter(Boolean);
      // the notebook of this month is already in the archive → only the lock
      const archive = !S.bookMonth || m >= S.bookMonth;
      const pend = archive ? nb.reduce((n, x) => n + (x.pendingCount?.() || 0), 0) : 0;
      if (pend) return HN.toast(`${pend} сатр дар дафтари Excel ҳанӯз «Сабт дар система» нашудааст. Аввал онҳоро сабт кунед, баъд моҳро пӯшед.`, "error");
      const text = archive
        ? `Моҳи «${label}» пӯшида шавад?

1) Варақҳои Excel (Иву ва Урумчи) ба «Бойгонӣ» мераванд — дидан ва .xlsx гирифтан мумкин, иваз кардан не.
2) Дафтари нави холӣ барои «${HN.monthLabel(next)}» кушода мешавад.
3) Қарзи муштариён гум намешавад — дар варақи нав «Қарзи моҳҳои гузашта» нишон дода мешавад.
4) Борҳо, пардохтҳо ва хароҷот то ${HN.fmtDate(until)} иваз ё нест намешаванд.`
        : `Сабтҳо то ${HN.fmtDate(until)} пӯшида шаванд? Дафтари «${label}» аллакай дар бойгонӣ аст.`;
      if (!(await HN.confirm(text, { title: "Пӯшидани моҳ", ok: "Пӯшидан" }))) return;
      const btn = $("lockBtn"); btn.disabled = true;
      try {
        if (!S.closedUntil || until > S.closedUntil) { const r = await HN.putRow("app_settings", "key", { key: "closed_until", value: until }); if (r.error) throw r.error; }
        let sheets = 0;
        if (archive) {
          for (const x of nb) sheets += await x.archiveMonth(m, next);
          const r = await HN.putRow("app_settings", "key", { key: "book_month", value: next }); if (r.error) throw r.error;
          S.bookMonth = next;
        }
        HN.toast(archive ? `«${label}» пӯшида шуд: ${sheets} варақ дар бойгонӣ. Дафтари «${HN.monthLabel(next)}» тайёр.` : "Давра то " + HN.fmtDate(until) + " пӯшида шуд.", "ok");
      } catch (err) { HN.toast("Моҳ пӯшида нашуд: " + HN.dbError(err), "error"); }
      finally { btn.disabled = false; }
      await HN.reload();
    };
    if ($("archOpenBtn")) $("archOpenBtn").onclick = () => HN.notebook?.openArchive();
    // «Моҳи навро кушодан»: the open Excel notebooks go to the archive under the month before, a new empty one starts.
    if ($("newMonthBtn")) $("newMonthBtn").onclick = async () => {
      const next = nextBookMonth(), prev = shiftMonth(next, -1), nb = [HN.notebook, HN.notebookUru].filter(Boolean);
      const pend = nb.reduce((n, x) => n + (x.pendingCount?.() || 0), 0);
      if (pend) return HN.toast(`${pend} сатр дар дафтари Excel ҳанӯз «Сабт дар система» нашудааст. Аввал онҳоро сабт кунед, баъд моҳи навро кушоед.`, "error");
      if (!(await HN.confirm(`Моҳи нав «${HN.monthLabel(next)}» кушода шавад?\n\n1) Варақҳои ҳозираи Excel (Иву ва Урумчи) бо номи «${HN.monthLabel(prev)}» ба «Бойгонӣ» мераванд — дидан ва .xlsx гирифтан мумкин.\n2) Дафтари нави холӣ (Лист1 … Лист10) барои «${HN.monthLabel(next)}» кушода мешавад, дар ҳамаи компютерҳо.\n3) Қарзи муштариён гум намешавад — дар варақи нав «Қарзи моҳҳои гузашта» нишон дода мешавад.`, { title: "Моҳи нав", ok: "Кушодан" }))) return;
      const btn = $("newMonthBtn"); btn.disabled = true;
      try {
        let sheets = 0;
        for (const x of nb) sheets += await x.archiveMonth(prev, next);
        const r = await HN.putRow("app_settings", "key", { key: "book_month", value: next }); if (r.error) throw r.error;
        S.bookMonth = next;
        HN.toast(`Моҳи «${HN.monthLabel(next)}» кушода шуд. ${sheets} варақи «${HN.monthLabel(prev)}» дар бойгонӣ.`, "ok");
      } catch (err) { HN.toast("Моҳи нав кушода нашуд: " + HN.dbError(err), "error"); }
      finally { btn.disabled = false; }
      await HN.reload();
    };
    if ($("unlockBtn")) $("unlockBtn").onclick = async () => {
      if (!(await HN.confirm("Давраи пӯшида кушода шавад? Пас аз ин сабтҳои кӯҳна иваз карда мешаванд.", { ok: "Кушодан", danger: true }))) return;
      const r = await S.db.from("app_settings").delete().eq("key", "closed_until");
      if (r.error) return HN.toast(HN.dbError(r.error), "error");
      HN.toast("Давра кушода шуд.", "ok"); await HN.reload();
    };
  }

  /* ================= Hooks used by main.js ================= */
  document.addEventListener("click", e => {
    const w = e.target.closest("[data-wtab]"); if (w) { setWtab(w.dataset.wtab); return; }
    const st = e.target.closest("[data-statement]"); if (st) { e.stopPropagation(); openStatement(st.dataset.statement); }
  }, true);
  HN.extras = {
    load, applyFeatures, renderKassa, renderBatches, openStatement, openBatch, openBatchForm, saveRate,
    afterRender(view) {
      if (view === "warehouse") setWtab(wtab);
      if (view === "admin") renderAdminExtras();
      if ($("batchView")?.open) { const id = $("batchViewBody").dataset.id; if (id) openBatch(id); }
    },
  };
})();
