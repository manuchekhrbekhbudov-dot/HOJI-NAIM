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
    const [rates, batches, settings, method, payMethod] = await Promise.all([
      q("fx_rates", "rate_date"), S.db.from("batches").select("*").order("created_at", { ascending: false }), q("app_settings", "key"),
      first || S.features.expMethod === undefined ? S.db.from("expenses").select("method").limit(1) : Promise.resolve({ error: S.features.expMethod ? null : {} }),
      first || S.features.payMethod === undefined ? S.db.from("payments").select("method").limit(1) : Promise.resolve({ error: S.features.payMethod ? null : {} }),
    ]);
    S.features.payMethod = !payMethod.error;
    S.features.rates = !rates.error; S.rates = rates.error ? [] : rates.data || [];
    S.features.batches = !batches.error; S.batches = batches.error ? [] : batches.data || [];
    S.features.lock = !settings.error;
    S.closedUntil = (settings.data || []).find(x => x.key === "closed_until")?.value || null;
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
  // Money in the currency chosen for reports (TJS or USD at the rate of that day).
  HN.cur = HN.lsGet("hn-report-cur", "TJS") === "USD" ? "USD" : "TJS";
  HN.val = {
    ship: s => (HN.cur === "TJS" ? HN.total(s) : s.currency === "USD" ? HN.num(s.total_original) : HN.total(s) / HN.rateOn(HN.shipmentDate(s))),
    pay: p => (HN.cur === "TJS" ? HN.num(p.amount_tjs) : p.currency === "USD" ? HN.num(p.amount_original) : HN.num(p.amount_tjs) / HN.rateOn(String(p.payment_date).slice(0, 10))),
    exp: e => (HN.cur === "TJS" ? HN.num(e.amount_tjs) : e.currency === "USD" ? HN.num(e.amount_original) : HN.num(e.amount_tjs) / HN.rateOn(String(e.expense_date).slice(0, 10))),
    // debt of a shipment, valued at that shipment's own rate
    debt: s => { const t = HN.total(s); return HN.cur === "TJS" || t <= 0 ? HN.debt(s) : (HN.debt(s) * HN.val.ship(s)) / t; },
    paid: s => { const t = HN.total(s); return HN.cur === "TJS" || t <= 0 ? HN.paid(s) : HN.val.ship(s) - HN.val.debt(s); },
  };
  HN.curLabel = () => (HN.cur === "USD" ? "$" : "TJS");

  async function saveRate(date, usd, cny) {
    if (S.features.rates) {
      const r = await S.db.from("fx_rates").upsert({ rate_date: date, usd, cny: cny || null }, { onConflict: "rate_date" });
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
    const cost = HN.num(b.cost_tjs) + bExps(b).reduce((n, e) => n + HN.num(e.amount_tjs), 0);
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
  function openBatchForm(b) {
    const f = $("batchForm").elements; $("batchForm").reset(); $("batchMsg").textContent = "";
    $("batchForm").dataset.id = b ? b.id : "";
    $("batchFormTitle").textContent = b ? "Таҳрири партия" : "Партияи нав";
    f.name.value = b?.name || "Мошин " + (S.batches.length + 1); f.vehicle.value = b?.vehicle || ""; f.status.value = b?.status || "loading";
    f.sent_date.value = b?.sent_date || HN.today(); f.arrived_date.value = b?.arrived_date || "";
    f.cost_usd.value = b ? HN.num(b.cost_usd) || "" : ""; f.fx_rate.value = b ? HN.num(b.fx_rate) || HN.rateOn(HN.today()) : HN.rateOn(HN.today()); f.notes.value = b?.notes || "";
    $("batchFormDialog").showModal(); f.name.focus();
  }
  $("batchForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target.elements, msg = $("batchMsg"), id = e.target.dataset.id;
    const cost = HN.num(f.cost_usd.value), rate = HN.num(f.fx_rate.value);
    if (!f.name.value.trim()) { msg.dataset.kind = "error"; msg.textContent = "Номи партияро нависед."; return; }
    if (cost < 0 || rate <= 0) { msg.dataset.kind = "error"; msg.textContent = "Хароҷот ва қурбро дуруст нависед."; return; }
    const p = { name: f.name.value.trim(), vehicle: f.vehicle.value.trim(), status: f.status.value, sent_date: f.sent_date.value || null, arrived_date: f.arrived_date.value || null, cost_usd: cost, fx_rate: rate, cost_tjs: HN.round2(cost * rate), notes: f.notes.value.trim() };
    const r = id ? await S.db.from("batches").update(p).eq("id", id) : await S.db.from("batches").insert({ ...p, created_by: S.user.id });
    if (r.error) { msg.dataset.kind = "error"; msg.textContent = HN.dbError(r.error); return; }
    $("batchFormDialog").close(); HN.toast(id ? "Партия нав шуд." : "Партия сохта шуд.", "ok"); await HN.reload();
    if (id) openBatch(id);
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
      <p class="muted">Фиристода: ${HN.fmtDate(b.sent_date)} · Расид: ${HN.fmtDate(b.arrived_date)} · ${x.n} бор · ${fmt(x.kg, 1)} кг · ${fmt(x.m3, 3)} м³${fin ? ` · Хароҷоти роҳ: $${fmt(b.cost_usd)} × ${HN.fmtQty(b.fx_rate, 4)} = ${money(b.cost_tjs)} TJS · Хароҷоти дигар: ${money(x.cost - HN.num(b.cost_tjs))} TJS` : ""}</p>
      ${b.notes ? `<div class="detail-notes"><small>Ёддошт</small><p>${esc(b.notes)}</p></div>` : ""}
      <div class="detail-actions">
        ${staff ? `<button class="btn btn-ghost" data-bact="edit"><svg><use href="#i-edit"/></svg><span>Таҳрир</span></button>` : ""}
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

  /* ================= Admin cards: rates, period lock, backup ================= */
  function renderAdminExtras() {
    const box = $("adminExtras"); if (!box) return;
    const last = allRates().slice(-8).reverse();
    const fin = HN.can("finance"), admin = HN.can("admin");
    const lastBackup = HN.lsGet("hn-last-backup", null);
    const days = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 864e5) : null;
    const prevMonth = (() => { const d = new Date(); d.setDate(0); return HN.isoDate(d).slice(0, 7); })();
    box.innerHTML = `
      <div class="panel">
        <div class="panel-head"><div><h3>Қурби рӯз</h3><p class="muted">Қурби доллар ва юан ба сомонӣ. Дар формаҳо ва ҳисобот бо доллар истифода мешавад.${S.features.rates ? "" : " Ҳоло танҳо дар ҳамин браузер (SQL лозим)."}</p></div></div>
        ${fin ? `<form id="rateForm" class="rate-form"><label class="field"><span>Сана</span><input name="date" type="date" value="${HN.today()}" required></label><label class="field"><span>1 $ = TJS</span><input name="usd" type="number" step="any" min="0.0001" value="${HN.rateOn(HN.today())}" required></label><label class="field"><span>1 ¥ = TJS</span><input name="cny" type="number" step="any" min="0" value="${HN.latestCny() || D.cnyRate}"></label><button class="btn btn-primary" type="submit"><svg><use href="#i-check"/></svg><span>Сабт</span></button></form>` : ""}
        <ul class="rate-list">${last.map(r => `<li><span>${HN.fmtDate(r.rate_date)}</span><b>$1 = ${HN.fmtQty(r.usd, 4)}</b>${r.cny ? `<small>¥1 = ${HN.fmtQty(r.cny, 4)}</small>` : ""}</li>`).join("") || '<li class="muted">Ҳоло қурб сабт нашудааст.</li>'}</ul>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Пӯшидани моҳ</h3><p class="muted">Пас аз пӯшидан борҳо, пардохтҳо ва хароҷоти то ин сана иваз ё нест намешаванд. Супоридани бор аз анбор иҷозат аст.</p></div></div>
        ${!S.features.lock ? '<p class="hint">Барои ин қисм SQL-и supabase/SETUP-ALL.sql-ро иҷро кунед.</p>' : `
        <p>${S.closedUntil ? `Ҳоло пӯшида то: <b>${HN.fmtDate(S.closedUntil)}</b>` : "Ҳоло ягон давра пӯшида нест."}</p>
        ${admin ? `<div class="btn-row"><label class="field"><span>Моҳ</span><input id="lockMonth" type="month" value="${prevMonth}"></label><button class="btn btn-primary" id="lockBtn"><svg><use href="#i-shield"/></svg><span>Пӯшидан</span></button>${S.closedUntil ? '<button class="btn btn-ghost" id="unlockBtn">Кушодан</button>' : ""}</div>` : '<p class="muted">Танҳо админ давраро мепӯшад.</p>'}`}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Нусхаи эҳтиётии худкор</h3><p class="muted">Ҳар шаб GitHub аз база нусхаи рамзгузоришуда (AES-256) мегирад ва 90 рӯз нигоҳ медорад.</p></div></div>
        <ol class="setup-steps"><li>GitHub → репозиторияи HOJI-NAIM → <b>Settings → Secrets and variables → Actions</b>.</li><li><b>New repository secret</b>: <code>SUPABASE_SERVICE_ROLE_KEY</code> — аз Supabase → Project Settings → API (калиди service_role).</li><li>Боз як secret: <code>BACKUP_PASSWORD</code> — пароли дарозе, ки худатон медонед.</li><li>Нусхаҳо дар <b>Actions → Nightly encrypted backup</b> пайдо мешаванд.</li></ol>
        <p class="muted">Нусхаи дастӣ дар ҳамин браузер: ${days === null ? "ҳанӯз гирифта нашудааст" : days === 0 ? "имрӯз" : days + " рӯз пеш"}.${days === null || days > 7 ? ' <b class="neg">Нусха гиред!</b>' : ""}</p>
      </div>`;
    const rf = $("rateForm");
    if (rf) rf.onsubmit = async e => { e.preventDefault(); const f = rf.elements; const usd = HN.num(f.usd.value), cny = HN.num(f.cny.value); if (usd <= 0) return HN.toast("Қурби долларро дуруст нависед.", "error"); try { await saveRate(f.date.value, usd, cny); HN.toast("Қурб сабт шуд: $1 = " + HN.fmtQty(usd, 4), "ok"); renderAdminExtras(); } catch (er) { HN.toast(HN.dbError(er), "error"); } };
    if ($("lockBtn")) $("lockBtn").onclick = async () => {
      const m = $("lockMonth").value; if (!m) return;
      const [y, mo] = m.split("-").map(Number), until = HN.isoDate(new Date(y, mo, 0));
      if (!(await HN.confirm(`Ҳамаи сабтҳо то ${HN.fmtDate(until)} пӯшида шаванд? Баъд онҳоро иваз ё нест кардан мумкин нест, то админ давраро накушояд.`, { title: "Пӯшидани давра", ok: "Пӯшидан" }))) return;
      const r = await S.db.from("app_settings").upsert({ key: "closed_until", value: until }, { onConflict: "key" });
      if (r.error) return HN.toast(HN.dbError(r.error), "error");
      HN.toast("Давра то " + HN.fmtDate(until) + " пӯшида шуд.", "ok"); await HN.reload();
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
    load, applyFeatures, renderKassa, renderBatches, openStatement, openBatch,
    afterRender(view) {
      if (view === "warehouse") setWtab(wtab);
      if (view === "admin") renderAdminExtras();
      if ($("batchView")?.open) { const id = $("batchViewBody").dataset.id; if (id) openBatch(id); }
    },
  };
})();
