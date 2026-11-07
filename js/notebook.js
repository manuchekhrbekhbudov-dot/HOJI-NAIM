/* HOJI-NAIM CARGO — "Дафтари Excel": Excel-style workbook with one sheet per customer.
   - Tab "Карго": the editable draft ledger (kept in this browser, same storage keys as before).
   - One sheet per customer, built from the shipments in the database (read-only grid,
     new rows are added through the shipment form so the data stays consistent).
   - Sheets can be added, renamed and selected from the tab bar at the bottom. */
(() => {
  "use strict";
  const HN = window.HN, S = HN.state, esc = HN.esc, fmt = HN.fmt, money = HN.money;
  const D = HN.config.defaults;

  // Storage keys of the previous version — kept so no saved data is lost.
  const DRAFT_KEY = "hoji-naim-cargo-sheet-v1";
  const META_KEY = "hoji-naim-cargo-sheet-meta-v1";
  const LEGACY_NAMES_KEY = "hoji-naim-customer-sheet-names-v1";
  const LOCAL_SHEETS_KEY = "hn-customer-sheets-v2";
  const ACTIVE_KEY = "hn-notebook-active";
  const DRAFT_ID = "__draft__";
  const DRAFT_NAME = "Карго";

  let draft = HN.lsGet(DRAFT_KEY, []); if (!Array.isArray(draft)) draft = [];
  const meta = HN.lsGet(META_KEY, {}) || {};
  if (!meta.cnyRate || meta.cnyRate === 1) meta.cnyRate = D.cnyRate;
  if (!meta.usdRate) meta.usdRate = D.usdRate;
  let active = HN.lsGet(ACTIVE_KEY, DRAFT_ID);
  let selected = null; // {r, c}
  let pendingSelect = null;

  const saveDraft = () => { const ok = HN.lsSet(DRAFT_KEY, draft); setStatus(ok ? "Сабт шуд · " + new Date().toLocaleTimeString("ru-RU").slice(0, 5) : "Хато ҳангоми нигоҳдорӣ дар браузер"); };
  const saveMeta = () => HN.lsSet(META_KEY, meta);
  const N = v => Number(v) || 0;

  /* ---------- Draft ledger math (same formulas as the workbook) ---------- */
  const calc = r => {
    const places = N(r.places);
    const cube = N(r.height) * N(r.width) * N(r.length) * places;
    const kg = N(r.kgPerPlace) * places;
    const cubeAmount = cube * N(r.cubePrice ?? D.cubePrice);
    const kgAmount = kg * N(r.kgPrice ?? D.kgPrice);
    const price = Math.max(cubeAmount, kgAmount);
    const paid = N(r.paid);
    return { places, cube, kg, density: cube > 0 ? kg / cube : 0, cubeAmount, kgAmount, billingType: cubeAmount > kgAmount ? "cube" : "kg", price, paid, debt: Math.max(0, price - paid) };
  };

  /* ---------- Sheets registry ---------- */
  const legacyNames = () => HN.lsGet(LEGACY_NAMES_KEY, {}) || {};
  const localSheets = () => { const v = HN.lsGet(LOCAL_SHEETS_KEY, []); return Array.isArray(v) ? v : []; };
  const registry = () => (S.features.sheets ? S.sheets : localSheets());
  const keyFor = ({ code, phone, name }) => code ? "code:" + code.trim().toLocaleLowerCase() : phone ? "phone:" + phone.trim().toLocaleLowerCase() : "name:" + (name || "Муштарӣ").trim().toLocaleLowerCase();

  function sheets() {
    const reg = new Map(registry().map(x => [x.customer_key, x]));
    const legacy = legacyNames();
    const list = HN.customers().map((c, i) => ({ id: c.key, customer: c, name: reg.get(c.key)?.sheet_name || legacy[c.key] || "Лист " + (i + 1) }));
    const known = new Set(list.map(x => x.id));
    registry().filter(x => !known.has(x.customer_key)).forEach(x => list.push({ id: x.customer_key, empty: true, customer: { key: x.customer_key, name: x.customer_name || x.sheet_name, code: x.client_code || "", phone: x.phone || "", shipments: [], billed: 0, paid: 0, debt: 0 }, name: x.sheet_name }));
    const seen = new Map();
    list.forEach(x => { const k = x.name.toLowerCase(); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n > 1) x.name = x.name.slice(0, 26) + " (" + n + ")"; });
    return list;
  }
  const findSheet = id => sheets().find(x => x.id === id) || null;

  async function saveSheetEntry(entry) {
    if (S.features.sheets) {
      const r = await S.db.from("customer_sheets").upsert({ customer_key: entry.customer_key, sheet_name: entry.sheet_name, customer_name: entry.customer_name || "", client_code: entry.client_code || "", phone: entry.phone || "", created_by: S.user.id }, { onConflict: "customer_key" }).select("*");
      if (r.error) throw r.error;
      const row = (r.data || [])[0] || entry;
      const i = S.sheets.findIndex(x => x.customer_key === entry.customer_key);
      if (i >= 0) S.sheets[i] = { ...S.sheets[i], ...row }; else S.sheets.push(row);
    } else {
      const list = localSheets();
      const i = list.findIndex(x => x.customer_key === entry.customer_key);
      if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push({ ...entry, created_at: new Date().toISOString() });
      HN.lsSet(LOCAL_SHEETS_KEY, list);
    }
  }
  async function removeSheetEntry(key) {
    if (S.features.sheets) {
      const r = await S.db.from("customer_sheets").delete().eq("customer_key", key);
      if (r.error) throw r.error;
      S.sheets = S.sheets.filter(x => x.customer_key !== key);
    } else HN.lsSet(LOCAL_SHEETS_KEY, localSheets().filter(x => x.customer_key !== key));
  }
  // One-time: copy sheet names saved in this browser into the shared table, when it exists.
  let migrated = false;
  async function migrateLegacyNames() {
    if (migrated || !S.features.sheets || !HN.can("staff")) return;
    migrated = true;
    const have = new Set(S.sheets.map(x => x.customer_key));
    const customers = new Map(HN.customers().map(c => [c.key, c]));
    const todo = [...Object.entries(legacyNames()), ...localSheets().map(x => [x.customer_key, x.sheet_name, x])].filter(([k]) => !have.has(k));
    for (const [k, name, extra] of todo) {
      const c = customers.get(k) || {};
      try { await saveSheetEntry({ customer_key: k, sheet_name: String(name).slice(0, 31), customer_name: extra?.customer_name || c.name || "", client_code: extra?.client_code || c.code || "", phone: extra?.phone || c.phone || "" }); have.add(k); }
      catch (err) { console.warn("Sheet name migration skipped", err); break; }
    }
  }

  function validName(name, exceptId) {
    const n = String(name || "").trim();
    if (!n) return "Номи варақро нависед.";
    if (n.length > 31) return "Номи варақ бояд то 31 аломат бошад.";
    if (/[\\/?*[\]:]/.test(n)) return "Дар номи варақ аломатҳои \\ / ? * [ ] : иҷозат нестанд.";
    if (n.toLowerCase() === DRAFT_NAME.toLowerCase() && exceptId !== DRAFT_ID) return "Ин ном барои варақи «Карго» банд аст.";
    if (sheets().some(x => x.id !== exceptId && x.name.toLowerCase() === n.toLowerCase())) return "Варақ бо ҳамин ном аллакай ҳаст.";
    return "";
  }

  /* ---------- Rendering ---------- */
  const root = () => HN.$("notebook");
  const COLS = n => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

  function render() {
    const el = root(); if (!el || !S.user) return;
    migrateLegacyNames().then(() => {}, () => {});
    if (pendingSelect) { active = pendingSelect; pendingSelect = null; }
    const list = sheets();
    if (active !== DRAFT_ID && !list.some(x => x.id === active)) active = DRAFT_ID;
    HN.lsSet(ACTIVE_KEY, active);
    const sheet = active === DRAFT_ID ? null : list.find(x => x.id === active);
    const sheetName = sheet ? sheet.name : DRAFT_NAME;
    const isDraft = !sheet;
    el.innerHTML = `
      <div class="xl" data-active="${esc(active)}">
        <div class="xl-titlebar">
          <span class="xl-logo" aria-hidden="true"><i>X</i></span>
          <span class="xl-qat" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg></span>
          <b class="xl-docname">Дафтар.xlsx <span>— Excel · HOJI-NAIM CARGO</span></b>
          <span class="xl-saved" id="xlSaved">${S.features.sheets ? "Дар база сабт мешавад" : "Дар ҳамин браузер"}</span>
        </div>
        <div class="xl-menutabs" aria-hidden="true"><span>Файл</span><span class="on">Асосӣ</span><span>Ворид</span><span>Формулаҳо</span><span>Маълумот</span><span>Намоиш</span></div>
        <div class="xl-ribbon" role="toolbar" aria-label="Амалҳои дафтар">
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="add-row"><svg><use href="#i-plus"/></svg><span>${isDraft ? "Сатри нав" : "Бори нав"}</span></button>
            ${isDraft ? `<button class="xl-btn xl-btn-lg" data-xl="sync"><svg><use href="#i-refresh"/></svg><span>Сабт дар система</span></button>` : ""}
          </div><span class="xl-group-label">${isDraft ? "Сатрҳо" : "Борҳо"}</span></div>
          <div class="xl-group"><div class="xl-group-btns xl-stack">
            <button class="xl-btn" data-xl="add-sheet"><svg><use href="#i-sheet"/></svg><span>Варақи нав</span></button>
            <button class="xl-btn" data-xl="rename" ${isDraft ? "disabled" : ""}><svg><use href="#i-edit"/></svg><span>Номи варақ</span></button>
            ${sheet?.empty ? `<button class="xl-btn" data-xl="remove-sheet"><svg><use href="#i-trash"/></svg><span>Нест кардани варақ</span></button>` : ""}
          </div><span class="xl-group-label">Варақҳо</span></div>
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="export-all"><svg><use href="#i-download"/></svg><span>Ҳамаи дафтар</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="export-sheet"><svg><use href="#i-download"/></svg><span>Ин варақ (.xlsx)</span></button>
            ${isDraft ? `<button class="xl-btn" data-xl="clear"><svg><use href="#i-trash"/></svg><span>Тоза кардан</span></button>` : ""}</div>
          </div><span class="xl-group-label">Содирот</span></div>
        </div>
        <div class="xl-formula"><span class="xl-namebox" id="xlName">A1</span><span class="xl-fxicons" aria-hidden="true"><i>✕</i><i>✓</i><em>fx</em></span><input id="xlFx" readonly aria-label="Сатри формула" value=""></div>
        ${isDraft ? draftMeta() : customerMeta(sheet)}
        <div class="xl-gridwrap" id="xlGridWrap">${isDraft ? draftGrid() : customerGrid(sheet)}</div>
        <div class="xl-tabsbar">
          <button class="xl-tabnav" data-xl="tabs-left" aria-label="Варақҳои пешина">◀</button><button class="xl-tabnav" data-xl="tabs-right" aria-label="Варақҳои баъдина">▶</button>
          <div class="xl-tabs" id="xlTabs" role="tablist" aria-label="Варақҳо">
            <button class="xl-tab${isDraft ? " on" : ""}" data-sheet="${DRAFT_ID}" role="tab" aria-selected="${isDraft}">${DRAFT_NAME}</button>
            ${list.map(x => `<button class="xl-tab${x.id === active ? " on" : ""}" data-sheet="${esc(x.id)}" role="tab" aria-selected="${x.id === active}" title="${esc(x.customer.name)}${x.customer.code ? " · " + esc(x.customer.code) : ""} — барои иваз кардани ном ду бор пахш кунед">${esc(x.name)}</button>`).join("")}
          </div>
          <button class="xl-addtab" data-xl="add-sheet" title="Варақи нав" aria-label="Варақи нав"><span>+</span></button>
        </div>
        <div class="xl-status"><span id="xlStatus">Омода</span><span id="xlAgg"></span><span class="xl-sheetcount">${list.length + 1} варақ</span><span class="xl-zoom" aria-hidden="true"><i class="xl-view on"></i><i class="xl-view v2"></i><i class="xl-view v3"></i><b>−</b><span class="xl-slider"><i></i></span><b>+</b>100%</span></div>
      </div>`;
    defaultAgg(isDraft, sheet);
    if (!isDraft) { setStatus(sheet.customer.shipments.length + " бор · " + esc(sheet.customer.name)); }
    const tab = el.querySelector(".xl-tab.on"), bar = el.querySelector(".xl-tabs");
    // Scroll only the tab strip horizontally — never the page.
    if (tab && bar && (tab.offsetLeft < bar.scrollLeft || tab.offsetLeft + tab.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = tab.offsetLeft - 40;
    if (selected) selectCell(selected.r, selected.c, true);
  }

  function draftMeta() {
    return `<div class="xl-meta"><label>Коди дафтар<input id="xlCode" value="${esc(meta.code || "")}" placeholder="Код"></label><label>Телефон<input id="xlPhone" value="${esc(meta.phone || "")}" placeholder="+992…"></label><label>Қурби доллар (TJS)<input id="xlUsd" type="number" step="any" min="0" value="${esc(meta.usdRate)}"></label><label>Қурби юан (TJS)<input id="xlCny" type="number" step="any" min="0" value="${esc(meta.cnyRate)}"></label></div>`;
  }
  function customerMeta(sh) {
    const c = sh.customer;
    return `<div class="xl-meta xl-meta-info"><span><small>Муштарӣ</small><b>${esc(c.name)}</b></span><span><small>Код</small><b>${esc(c.code || "—")}</b></span><span><small>Телефон</small><b>${esc(c.phone || "—")}</b></span><span><small>Ҳисоб</small><b>${money(c.billed)} TJS</b></span><span><small>Пардохт</small><b>${money(c.paid)} TJS</b></span><span><small>Қарз</small><b class="${c.debt > 0.005 ? "neg" : ""}">${money(c.debt)} TJS</b></span></div>`;
  }

  const DRAFT_COLS = [
    ["date", "Сана", "date", 112], ["customerCode", "Коди клиент", "text", 96], ["customerPhone", "Телефон", "tel", 118], ["shop", "Мағоза", "text", 100], ["city", "Шаҳр", "text", 90], ["item", "Номи мол", "text", 120],
    ["height", "Баландӣ, м", "number", 76], ["width", "Паҳноӣ, м", "number", 76], ["length", "Дарозӣ, м", "number", 76], ["places", "Ҷой", "number", 56], ["kgPerPlace", "Кг / ҷой", "number", 70],
    ["=cube", "Ҳамагӣ м³", "calc", 82], ["=kg", "Ҳамагӣ кг", "calc", 82], ["cubePrice", "Нархи куб, $", "number", 80], ["=cubeAmount", "Сумма куб, $", "calc", 90], ["kgPrice", "Нархи кг, $", "number", 72], ["=kgAmount", "Сумма кг, $", "calc", 90],
    ["=price", "Нархи ниҳоӣ, $", "calc", 100], ["paid", "Пардохт, $", "number", 84], ["=debt", "Қарз, $", "calc", 84], ["=density", "Зичӣ, кг/м³", "calc", 84],
  ];
  const FORMULA = {
    "=cube": r => `=${L("height")}${r}*${L("width")}${r}*${L("length")}${r}*${L("places")}${r}`, "=kg": r => `=${L("kgPerPlace")}${r}*${L("places")}${r}`,
    "=cubeAmount": r => `=${L("=cube")}${r}*${L("cubePrice")}${r}`, "=kgAmount": r => `=${L("=kg")}${r}*${L("kgPrice")}${r}`,
    "=price": r => `=MAX(${L("=cubeAmount")}${r},${L("=kgAmount")}${r})`, "=debt": r => `=MAX(0,${L("=price")}${r}-${L("paid")}${r})`, "=density": r => `=IF(${L("=cube")}${r}>0,${L("=kg")}${r}/${L("=cube")}${r},"")`,
  };
  const L = key => String.fromCharCode(66 + DRAFT_COLS.findIndex(c => c[0] === key)); // column A is "№"
  const HEAD_ROW = 1;

  function draftGrid() {
    const letters = COLS(DRAFT_COLS.length + 1);
    const totals = { cube: 0, kg: 0, cubeAmount: 0, kgAmount: 0, price: 0, paid: 0, debt: 0, places: 0 };
    const body = draft.map((r, i) => {
      const x = calc(r); Object.keys(totals).forEach(k => (totals[k] += x[k] || 0));
      const R = i + HEAD_ROW + 1;
      return `<tr data-i="${i}"${i % 2 ? ' class="xl-band"' : ""}><th class="xl-rh">${R}</th><td class="xl-c xl-num" data-r="${R}" data-c="0">${i + 1}</td>${DRAFT_COLS.map(([key, , type], ci) => {
        if (type === "calc") { const k = key.slice(1); const v = k === "density" ? (x.cube > 0 ? fmt(x.density, 2) : "—") : fmt(x[k], k === "cube" ? 3 : 2); return `<td class="xl-c xl-num xl-calc${k === "price" ? " xl-strong" : ""}${k === "debt" && x.debt > 0.005 ? " xl-red" : ""}" data-k="${k}" data-r="${R}" data-c="${ci + 1}" data-f="${esc(FORMULA[key](R))}">${v}</td>`; }
        const val = r[key] ?? (key === "cubePrice" ? D.cubePrice : key === "kgPrice" ? D.kgPrice : key === "paid" ? "" : "");
        return `<td class="xl-c xl-in${type === "number" ? " xl-num" : ""}" data-r="${R}" data-c="${ci + 1}"><input data-row="${i}" data-key="${key}" type="${type}"${type === "number" ? ' min="0" step="any" inputmode="decimal"' : ""} value="${esc(val)}" aria-label="${esc(DRAFT_COLS[ci][1])}, сатри ${i + 1}"></td>`;
      }).join("")}<td class="xl-c xl-del"><button data-xl-del="${i}" title="Нест кардани сатр" aria-label="Нест кардани сатри ${i + 1}">×</button></td></tr>`;
    }).join("");
    const T = draft.length + HEAD_ROW + 1;
    const sumF = key => `=SUM(${L(key)}${HEAD_ROW + 1}:${L(key)}${T - 1})`;
    const totalRow = draft.length ? `<tr class="xl-total"><th class="xl-rh">${T}</th><td class="xl-c" data-r="${T}" data-c="0">ҶАМЪ</td>${DRAFT_COLS.map(([key], ci) => {
      const map = { places: "places", "=cube": "cube", "=kg": "kg", "=cubeAmount": "cubeAmount", "=kgAmount": "kgAmount", "=price": "price", paid: "paid", "=debt": "debt" };
      return map[key] ? `<td class="xl-c xl-num" data-tk="${map[key]}" data-r="${T}" data-c="${ci + 1}" data-f="${sumF(key)}">${fmt(totals[map[key]], key === "=cube" ? 3 : key === "places" ? 0 : 2)}</td>` : `<td class="xl-c" data-r="${T}" data-c="${ci + 1}"></td>`;
    }).join("")}<td class="xl-c"></td></tr>` : "";
    const filler = fillerRows(draft.length ? T + 1 : HEAD_ROW + 1, DRAFT_COLS.length + 2, Math.max(8, 26 - draft.length));
    return `<table class="xl-grid"><colgroup><col class="xl-rhcol"><col style="width:44px">${DRAFT_COLS.map(c => `<col style="width:${c[3]}px">`).join("")}<col style="width:34px"></colgroup>
      <thead><tr class="xl-letters"><th class="xl-corner"></th>${letters.map(l => `<th>${l}</th>`).join("")}<th></th></tr></thead>
      <tbody><tr class="xl-head"><th class="xl-rh">${HEAD_ROW}</th><td class="xl-c" data-r="1" data-c="0">№</td>${DRAFT_COLS.map((c, ci) => `<td class="xl-c" data-r="1" data-c="${ci + 1}">${c[1]}</td>`).join("")}<td class="xl-c"></td></tr>${body}${totalRow}${filler}</tbody></table>
      ${draft.length ? "" : '<p class="xl-empty">Дафтар холӣ аст. «Сатри нав»-ро пахш кунед ва маълумотро мисли Excel ворид кунед. Ҳамагӣ м³, кг, сумма ва қарз худкор ҳисоб мешаванд.</p>'}`;
  }

  const CUST_COLS = [
    ["Сана", 92], ["Рақами бор", 128], ["Ҷой", 54], ["Вазн, кг", 84], ["Ҳаҷм, м³", 84], ["Зичӣ, кг/м³", 88], ["Ҳисоб аз рӯи", 92], ["Ҳисоб, $", 90], ["Ҳисоб, TJS", 104], ["Пардохт, TJS", 104], ["Қарз, TJS", 104], ["Анбор", 100], ["Ёддошт", 180],
  ];
  function customerGrid(sh) {
    const rows = sh.customer.shipments.slice().sort((a, b) => HN.shipmentDate(a).localeCompare(HN.shipmentDate(b)));
    const letters = COLS(CUST_COLS.length + 1);
    const first = HEAD_ROW + 1, T = rows.length + HEAD_ROW + 1;
    const body = rows.map((s, i) => {
      const R = i + first, debt = HN.debt(s);
      const cells = [
        [HN.fmtDate(HN.shipmentDate(s)), "xl-center"], [esc(s.tracking_no || "—"), "xl-strong"], [HN.places(s), "xl-num"], [HN.fmtQty(s.weight_kg, 3), "xl-num"], [HN.fmtQty(s.volume_m3, 4), "xl-num"],
        [HN.num(s.volume_m3) > 0 ? fmt(HN.num(s.weight_kg) / HN.num(s.volume_m3), 1) : "—", "xl-num xl-calc", `=IF(E${R}>0,D${R}/E${R},"")`], [s.billing_type === "cube" ? "куб" : "кг", "xl-center"],
        [fmt(s.total_original), "xl-num"], [fmt(HN.total(s)), "xl-num"], [fmt(HN.paid(s)), "xl-num"], [fmt(debt), "xl-num xl-calc" + (debt > 0.005 ? " xl-red" : ""), `=MAX(0,J${R}-K${R})`],
        [S.features.warehouse ? HN.whStatusText[HN.whStatus(s)] : "—", "xl-center wh-" + HN.whStatus(s)], [esc(HN.freeNotes(s)), "xl-text"],
      ];
      return `<tr class="xl-datarow${i % 2 ? " xl-band" : ""}" data-ship="${esc(s.id)}" title="Барои кушодани бор ду бор пахш кунед"><th class="xl-rh">${R}</th><td class="xl-c xl-num" data-r="${R}" data-c="0">${i + 1}</td>${cells.map(([v, cls, f], ci) => `<td class="xl-c ${cls}" data-r="${R}" data-c="${ci + 1}"${f ? ` data-f="${esc(f)}"` : ""}>${v}</td>`).join("")}</tr>`;
    }).join("");
    const sum = (col, k) => `=SUM(${col}${first}:${col}${T - 1})`;
    const tot = (fn, d = 2) => fmt(rows.reduce((n, s) => n + HN.num(fn(s)), 0), d);
    const totalRow = rows.length ? `<tr class="xl-total"><th class="xl-rh">${T}</th><td class="xl-c" data-r="${T}" data-c="0">ҶАМЪ</td><td class="xl-c" data-r="${T}" data-c="1"></td><td class="xl-c xl-num" data-r="${T}" data-c="2">${rows.length} бор</td>
      <td class="xl-c xl-num" data-r="${T}" data-c="3" data-f="${sum("D")}">${tot(HN.places, 0)}</td><td class="xl-c xl-num" data-r="${T}" data-c="4" data-f="${sum("E")}">${tot(s => s.weight_kg, 3)}</td><td class="xl-c xl-num" data-r="${T}" data-c="5" data-f="${sum("F")}">${tot(s => s.volume_m3, 4)}</td>
      <td class="xl-c" data-r="${T}" data-c="6"></td><td class="xl-c" data-r="${T}" data-c="7"></td><td class="xl-c xl-num" data-r="${T}" data-c="8" data-f="${sum("I")}">${tot(s => s.total_original)}</td><td class="xl-c xl-num" data-r="${T}" data-c="9" data-f="${sum("J")}">${tot(HN.total)}</td>
      <td class="xl-c xl-num" data-r="${T}" data-c="10" data-f="${sum("K")}">${tot(HN.paid)}</td><td class="xl-c xl-num xl-red" data-r="${T}" data-c="11" data-f="${sum("L")}">${tot(HN.debt)}</td><td class="xl-c" data-r="${T}" data-c="12"></td><td class="xl-c" data-r="${T}" data-c="13"></td></tr>` : "";
    return `<table class="xl-grid"><colgroup><col class="xl-rhcol"><col style="width:44px">${CUST_COLS.map(c => `<col style="width:${c[1]}px">`).join("")}</colgroup>
      <thead><tr class="xl-letters"><th class="xl-corner"></th>${letters.map(l => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody><tr class="xl-head"><th class="xl-rh">${HEAD_ROW}</th><td class="xl-c" data-r="1" data-c="0">№</td>${CUST_COLS.map((c, ci) => `<td class="xl-c" data-r="1" data-c="${ci + 1}">${c[0]}</td>`).join("")}</tr>${body}${totalRow}${fillerRows(rows.length ? T + 1 : first, CUST_COLS.length + 1, Math.max(8, 26 - rows.length))}</tbody></table>
      ${rows.length ? "" : `<p class="xl-empty">Барои ин муштарӣ ҳоло бор нест. «Бори нав»-ро пахш кунед — бор дар база сабт мешавад ва дар ҳамин варақ пайдо мешавад.</p>`}`;
  }
  function fillerRows(start, cols, n) {
    let h = "";
    for (let i = 0; i < n; i++) h += `<tr class="xl-filler"><th class="xl-rh">${start + i}</th>${"<td class=\"xl-c\"></td>".repeat(cols)}</tr>`;
    return h;
  }

  /* ---------- Cell selection, formula bar, status bar ---------- */
  function cellRef(r, c) { return String.fromCharCode(65 + c) + r; }
  function selectCell(r, c, silent) {
    const el = root()?.querySelector(`.xl-c[data-r="${r}"][data-c="${c}"]`);
    root()?.querySelectorAll(".xl-c.sel").forEach(x => x.classList.remove("sel"));
    root()?.querySelectorAll(".xl-letters th.on, .xl-rh.on").forEach(x => x.classList.remove("on"));
    if (!el) return;
    selected = { r, c };
    el.classList.add("sel");
    root().querySelectorAll(".xl-letters th")[c + 1]?.classList.add("on");
    el.closest("tr")?.querySelector(".xl-rh")?.classList.add("on");
    HN.$("xlName").textContent = cellRef(r, c);
    const input = el.querySelector("input");
    HN.$("xlFx").value = el.dataset.f || (input ? input.value : el.textContent.trim());
    if (!silent) {
      const v = Number(String(input ? input.value : el.textContent).replace(/[\s ]/g, "").replace("−", "-"));
      if (el.dataset.f && el.dataset.f.startsWith("=SUM")) HN.$("xlAgg").textContent = "Ҷамъ: " + el.textContent.trim();
      else if (Number.isFinite(v) && String(input ? input.value : el.textContent).trim() !== "") HN.$("xlAgg").textContent = "Қимат: " + fmt(v, 2);
    }
  }
  function defaultAgg(isDraft, sh) {
    const agg = HN.$("xlAgg"); if (!agg) return;
    if (isDraft) { const t = draft.reduce((a, r) => { const x = calc(r); a.price += x.price; a.debt += x.debt; a.cube += x.cube; a.kg += x.kg; return a; }, { price: 0, debt: 0, cube: 0, kg: 0 }); agg.textContent = `Сатрҳо: ${draft.length} · м³: ${fmt(t.cube, 3)} · кг: ${fmt(t.kg, 1)} · Ҳамагӣ: $${fmt(t.price)} (${money(t.price * N(meta.usdRate))} TJS) · Қарз: $${fmt(t.debt)}`; }
    else agg.textContent = `Ҳисоб: ${money(sh.customer.billed)} · Пардохт: ${money(sh.customer.paid)} · Қарз: ${money(sh.customer.debt)} TJS`;
  }
  function setStatus(t) { const s = HN.$("xlStatus"); if (s) s.textContent = t; }

  /* ---------- Events ---------- */
  document.addEventListener("click", async e => {
    const nb = e.target.closest("#notebook"); if (!nb) return;
    const tab = e.target.closest("[data-sheet]");
    if (tab && !tab.querySelector("input")) {
      const id = tab.dataset.sheet;
      if (id !== active) { active = id; selected = null; render(); }
      // Double-click (2nd click lands on the re-rendered tab) → rename, like Excel.
      if (e.detail === 2 && id !== DRAFT_ID) { const on = root().querySelector(".xl-tab.on"); if (on) startRename(on); }
      return;
    }
    const del = e.target.closest("[data-xl-del]");
    if (del) {
      const i = Number(del.dataset.xlDel), r = draft[i];
      const filled = r && Object.entries(r).some(([k, v]) => !["date", "cubePrice", "kgPrice"].includes(k) && String(v ?? "").trim() !== "");
      if (filled && !(await HN.confirm(`Сатри ${i + 1}${r.customerCode ? " (" + r.customerCode + ")" : ""} нест карда шавад?${r.syncTrackingNo ? " Бори аллакай дар система сабтшуда нест намешавад." : ""}`, { ok: "Нест кардан", danger: true }))) return;
      draft.splice(i, 1); saveDraft(); render(); return;
    }
    const btn = e.target.closest("[data-xl]");
    if (btn) { action(btn.dataset.xl); return; }
    const cell = e.target.closest(".xl-c[data-r]");
    if (cell) selectCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  document.addEventListener("dblclick", e => {
    const nb = e.target.closest("#notebook"); if (!nb) return;
    const row = e.target.closest("tr.xl-datarow[data-ship]");
    if (row) HN.openDetail(row.dataset.ship);
  });
  document.addEventListener("focusin", e => {
    const input = e.target.closest("#notebook .xl-in input"); if (!input) return;
    const cell = input.closest(".xl-c"); selectCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  document.addEventListener("input", e => {
    const input = e.target.closest("#notebook .xl-in input");
    if (input) { const i = Number(input.dataset.row); if (draft[i]) { draft[i][input.dataset.key] = input.value; saveDraft(); HN.$("xlFx").value = input.value; refreshDraft(); } return; }
    const m = e.target.closest("#notebook .xl-meta input");
    if (m) { meta.code = HN.$("xlCode").value; meta.phone = HN.$("xlPhone").value; meta.usdRate = N(HN.$("xlUsd").value) || D.usdRate; meta.cnyRate = N(HN.$("xlCny").value) || D.cnyRate; saveMeta(); defaultAgg(true); }
  });
  // Recalculate formula cells in place (like Excel) — keeps focus while typing.
  function refreshDraft() {
    const grid = root()?.querySelector(".xl-grid"); if (!grid) return;
    const totals = { cube: 0, kg: 0, cubeAmount: 0, kgAmount: 0, price: 0, paid: 0, debt: 0, places: 0 };
    grid.querySelectorAll("tr[data-i]").forEach(tr => {
      const x = calc(draft[Number(tr.dataset.i)] || {}); Object.keys(totals).forEach(k => (totals[k] += x[k] || 0));
      tr.querySelectorAll("[data-k]").forEach(td => {
        const k = td.dataset.k;
        td.textContent = k === "density" ? (x.cube > 0 ? fmt(x.density, 2) : "—") : fmt(x[k], k === "cube" ? 3 : 2);
        if (k === "debt") td.classList.toggle("xl-red", x.debt > 0.005);
      });
    });
    grid.querySelectorAll("[data-tk]").forEach(td => { const k = td.dataset.tk; td.textContent = fmt(totals[k], k === "cube" ? 3 : k === "places" ? 0 : 2); });
    defaultAgg(true);
  }
  document.addEventListener("keydown", e => {
    const input = e.target.closest("#notebook .xl-in input"); if (!input) return;
    const cell = input.closest(".xl-c"), r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    const move = (dr, dc) => {
      let rr = r + dr, cc = c + dc;
      for (let guard = 0; guard < 40; guard++) {
        const t = root().querySelector(`.xl-c[data-r="${rr}"][data-c="${cc}"] input`);
        if (t) { e.preventDefault(); t.focus(); t.select?.(); return; }
        if (!root().querySelector(`.xl-c[data-r="${rr}"][data-c="${cc}"]`)) return;
        rr += dr; cc += dc;
      }
    };
    if (e.key === "Enter" || (e.key === "ArrowDown" && input.type !== "number")) move(1, 0);
    else if (e.key === "ArrowUp" && input.type !== "number") move(-1, 0);
  });

  function startRename(tab) {
    const id = tab.dataset.sheet, old = tab.textContent;
    tab.innerHTML = `<input class="xl-tabinput" value="${esc(old)}" maxlength="31" aria-label="Номи нави варақ">`;
    const inp = tab.querySelector("input"); inp.focus(); inp.select();
    let done = false;
    const finish = async ok => {
      if (done) return; done = true;
      if (!ok || inp.value.trim() === old) { render(); return; }
      await renameSheet(id, inp.value.trim());
    };
    inp.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); finish(true); } if (ev.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => finish(true));
  }
  async function renameSheet(id, name) {
    const err = validName(name, id);
    if (err) { HN.toast(err, "error"); render(); return false; }
    const sh = findSheet(id); if (!sh) return false;
    try {
      await saveSheetEntry({ customer_key: id, sheet_name: name, customer_name: sh.customer.name, client_code: sh.customer.code, phone: sh.customer.phone });
      const legacy = legacyNames(); legacy[id] = name; HN.lsSet(LEGACY_NAMES_KEY, legacy);
      HN.toast("Номи варақ иваз шуд: " + name, "ok");
    } catch (er) { HN.toast("Ном сабт нашуд: " + HN.dbError(er), "error"); }
    render(); return true;
  }

  async function action(kind) {
    const sh = active === DRAFT_ID ? null : findSheet(active);
    if (kind === "add-row") {
      if (!sh) {
        draft.push({ date: HN.today(), customerCode: meta.code || "", customerPhone: meta.phone || "", cubePrice: D.cubePrice, kgPrice: D.kgPrice });
        saveDraft(); render();
        const R = draft.length + HEAD_ROW;
        root().querySelector(`.xl-c[data-r="${R}"] input[data-key="customerCode"]`)?.focus();
        root().querySelector("#xlGridWrap")?.scrollTo({ top: 99999, behavior: "smooth" });
      } else HN.openShipment(null, sh.customer);
      return;
    }
    if (kind === "tabs-left" || kind === "tabs-right") { const bar = root().querySelector(".xl-tabs"); bar?.scrollBy({ left: kind === "tabs-left" ? -200 : 200, behavior: "smooth" }); return; }
    if (kind === "add-sheet") { openSheetDialog(); return; }
    if (kind === "rename") { const t = root().querySelector(".xl-tab.on"); if (t) startRename(t); return; }
    if (kind === "remove-sheet" && sh?.empty) {
      if (!(await HN.confirm(`Варақи холии «${sh.name}» нест карда шавад?`, { ok: "Нест кардан", danger: true }))) return;
      try { await removeSheetEntry(sh.id); active = DRAFT_ID; HN.toast("Варақ нест шуд.", "ok"); } catch (er) { HN.toast(HN.dbError(er), "error"); }
      render(); return;
    }
    if (kind === "clear") {
      if (!draft.length) return;
      if (!(await HN.confirm("Ҳамаи сатрҳои варақи «Карго» тоза шаванд? Борҳое, ки аллакай дар система сабт шудаанд, нест намешаванд.", { ok: "Тоза кардан", danger: true }))) return;
      draft = []; saveDraft(); render(); return;
    }
    if (kind === "sync") { await sync(); return; }
    if (kind === "export-sheet") { exportBook(sh ? [sh] : null, !sh); return; }
    if (kind === "export-all") { exportBook(sheets(), true); }
  }

  /* ---------- New sheet dialog ---------- */
  const sheetForm = HN.$("sheetForm");
  function openSheetDialog() {
    if (!HN.can("staff")) { HN.toast("Барои ин амал иҷозат надоред."); return; }
    sheetForm.reset(); HN.$("sheetMsg").textContent = "";
    let n = sheets().length + 1; while (validName("Лист " + n)) n++;
    sheetForm.elements.sheet_name.value = "Лист " + n;
    HN.$("sheetDialog").showModal();
    sheetForm.elements.customer_name.focus();
  }
  sheetForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = sheetForm.elements, msg = HN.$("sheetMsg"); msg.dataset.kind = "error";
    const name = f.sheet_name.value.trim(), cname = f.customer_name.value.trim(), code = f.client_code.value.trim(), phone = f.phone.value.trim();
    const bad = validName(name);
    if (bad) { msg.textContent = bad; return; }
    if (!cname) { msg.textContent = "Номи муштариро нависед."; return; }
    const key = keyFor({ code, phone, name: cname });
    const exists = sheets().find(x => x.id === key);
    if (exists) { msg.textContent = `Барои ин муштарӣ аллакай варақи «${exists.name}» ҳаст.`; return; }
    try {
      await saveSheetEntry({ customer_key: key, sheet_name: name, customer_name: cname, client_code: code, phone });
      HN.$("sheetDialog").close(); active = key; selected = null; render();
      HN.toast("Варақи «" + name + "» сохта шуд.", "ok");
    } catch (er) { msg.textContent = HN.dbError(er); }
  });

  /* ---------- Sync draft rows into the database (same rules as before) ---------- */
  async function sync() {
    if (!S.db || !S.user) { HN.toast("Аввал ба система ворид шавед."); return; }
    if (!HN.can("staff")) { HN.toast("Барои сабт дар система иҷозати корманд лозим аст."); return; }
    const rows = draft.filter(r => r.customerCode || r.shop || r.item || N(r.places) || N(r.kgPerPlace));
    if (!rows.length) { HN.toast("Аввал дар дафтар ҳадди ақал як борро пур кунед."); return; }
    const bad = rows.findIndex(r => { const x = calc(r); return x.price <= 0; });
    if (bad >= 0) { HN.toast(`Сатри ${draft.indexOf(rows[bad]) + 1}: ҷой, андоза ё кг пур нашудааст — нарх 0 аст.`, "error"); return; }
    const over = rows.findIndex(r => { const x = calc(r); return x.paid > x.price + 0.005; });
    if (over >= 0) { HN.toast(`Сатри ${draft.indexOf(rows[over]) + 1}: пардохт аз нарх зиёд аст.`, "error"); return; }
    if (N(meta.usdRate) <= 0) { HN.toast("Қурби долларро дуруст нависед.", "error"); return; }
    if (!(await HN.confirm(`${rows.length} сатр ба система сабт шавад? Сатрҳои аллакай сабтшуда нав карда мешаванд, такрор намешаванд.`, { ok: "Сабт дар система" }))) return;
    const rate = N(meta.usdRate);
    setStatus("Сабт шуда истодааст…");
    let done = 0;
    try {
      for (const r of rows) {
        const x = calc(r);
        const unitPrice = x.billingType === "kg" ? N(r.kgPrice ?? D.kgPrice) : N(r.cubePrice ?? D.cubePrice);
        const code = String(r.customerCode || meta.code || "").trim();
        if (!r.syncTrackingNo) { const date = String(r.date || HN.today()).replace(/-/g, ""); const safeCode = (code || "CLIENT").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "CLIENT"; r.syncTrackingNo = "SHEET-" + date + "-" + safeCode + "-" + crypto.randomUUID().slice(0, 8).toUpperCase(); saveDraft(); }
        const phone = String(r.customerPhone || meta.phone || "").trim();
        const notes = ["Дафтари Excel", code ? "Коди муштарӣ: " + code : "", phone ? "Телефон: " + phone : "", "Ҷойҳо: " + x.places, "Кг барои ҷой: " + N(r.kgPerPlace), "Нархи куб: " + N(r.cubePrice ?? D.cubePrice), "Сумма куб: " + x.cubeAmount.toFixed(2), "Нархи кг: " + N(r.kgPrice ?? D.kgPrice), "Сумма кг: " + x.kgAmount.toFixed(2), r.city ? "Шаҳр: " + r.city : "", r.item ? "Мол: " + r.item : "", N(r.height) && N(r.width) && N(r.length) ? "Андоза: " + [r.height, r.width, r.length].join(" × ") + " м" : "", "Мағоза: " + (r.shop || "—")].filter(Boolean).join("; ");
        const payload = { client_name: String(code || r.shop || "Муштарӣ"), client_phone: phone, tracking_no: r.syncTrackingNo, shipment_date: r.date || HN.today(), billing_type: x.billingType, weight_kg: x.kg, volume_m3: x.cube, currency: "USD", unit_price: unitPrice, fx_rate: rate, total_original: HN.round2(x.price), total_tjs: HN.round2(x.price * rate), notes, created_by: S.user.id };
        const existing = S.shipments.find(s => s.tracking_no === r.syncTrackingNo);
        if (existing) { delete payload.created_by; if (existing.client_name && existing.client_name !== payload.client_name && !code) payload.client_name = existing.client_name; }
        const { data: ship, error } = await S.db.from("shipments").upsert(payload, { onConflict: "tracking_no" }).select("id").single();
        if (error) throw error;
        if (N(r.paid) > 0) {
          if (!r.syncPaymentId) { r.syncPaymentId = crypto.randomUUID(); saveDraft(); }
          const pay = { id: r.syncPaymentId, shipment_id: ship.id, currency: "USD", amount_original: N(r.paid), fx_rate: rate, amount_tjs: HN.round2(N(r.paid) * rate), payment_date: r.date || HN.today(), notes: "Пардохт аз дафтари Excel · " + (code || r.syncTrackingNo), created_by: S.user.id };
          const { error: pe } = await S.db.from("payments").upsert(pay, { onConflict: "id" }); if (pe) throw pe;
        } else if (r.syncPaymentId) {
          const { error: de } = await S.db.from("payments").delete().eq("id", r.syncPaymentId); if (de) throw de; delete r.syncPaymentId;
        }
        done++;
      }
      saveDraft(); await HN.reload();
      HN.toast(`Дафтар бо система синхрон шуд: ${done} сатр.`, "ok");
    } catch (err) {
      console.error("Notebook sync", err); saveDraft();
      HN.toast(`Синхронсозӣ пас аз ${done} сатр қатъ шуд: ${HN.dbError(err)}`, "error");
      setStatus("Хатои синхронсозӣ");
    }
  }

  /* ---------- XLSX export ---------- */
  function exportBook(list, withDraft) {
    const specs = [];
    if (withDraft && draft.length) {
      const cols = [{ header: "№", value: (_, i) => i + 1, type: "int", width: 5 }].concat(DRAFT_COLS.map(([key, title, type]) => {
        if (type === "calc") { const k = key.slice(1); return { header: title, value: r => (k === "density" ? (calc(r).cube > 0 ? calc(r).density : "") : calc(r)[k]), type: k === "cube" ? "qty" : "money", width: 12, total: ["cube", "kg", "cubeAmount", "kgAmount", "price", "debt"].includes(k), red: k === "debt", f: R => FORMULA[key](R).slice(1) }; }
        if (type === "number") return { header: title, value: r => (r[key] === "" || r[key] == null ? (key === "cubePrice" ? D.cubePrice : key === "kgPrice" ? D.kgPrice : "") : N(r[key])), type: "qty", width: 10, total: ["places", "paid"].includes(key) };
        if (type === "date") return { header: title, value: r => r[key], type: "date", width: 12 };
        return { header: title, value: r => r[key], width: 14 };
      }));
      specs.push({ name: DRAFT_NAME, theme: "excel", title: "HOJI-NAIM CARGO — Карго", subtitle: `Код: ${meta.code || "—"} · Тел: ${meta.phone || "—"} · Қурби доллар: ${meta.usdRate} · Қурби юан: ${meta.cnyRate} · Сана: ${HN.fmtDate(HN.today())}`, columns: cols, rows: draft });
    }
    const all = list || [];
    if (list && list.length > 1) specs.push({ name: "Ҷамъбаст", theme: "excel", title: "HOJI-NAIM CARGO — Ҷамъбасти муштариён", columns: [{ header: "Варақ", value: x => x.name, width: 14 }, ...HN.cols.customers().map(c => ({ ...c, value: x => c.value(x.customer) }))], rows: all });
    all.forEach(sh => {
      const rows = sh.customer.shipments.slice().sort((a, b) => HN.shipmentDate(a).localeCompare(HN.shipmentDate(b)));
      specs.push({ name: sh.name, theme: "excel", title: `HOJI-NAIM CARGO — ${sh.name}`, subtitle: `Муштарӣ: ${sh.customer.name} · Код: ${sh.customer.code || "—"} · Тел: ${sh.customer.phone || "—"} · Сана: ${HN.fmtDate(HN.today())}`, columns: [
        { header: "№", value: (_, i) => i + 1, type: "int", width: 5 },
        { header: "Сана", value: s => HN.shipmentDate(s), type: "date", width: 12 },
        { header: "Рақами бор", value: s => s.tracking_no, width: 18 },
        { header: "Ҷой", value: s => HN.places(s), type: "int", width: 7, total: true },
        { header: "Вазн (кг)", value: s => s.weight_kg, type: "qty", width: 11, total: true },
        { header: "Ҳаҷм (м³)", value: s => s.volume_m3, type: "qty", width: 11, total: true },
        { header: "Ҳисоб аз рӯи", value: s => (s.billing_type === "cube" ? "куб" : "кг"), width: 11 },
        { header: "Ҳисоб ($)", value: s => s.total_original, type: "money", width: 12, total: true },
        { header: "Ҳисоб (TJS)", value: s => HN.total(s), type: "money", width: 14, total: true },
        { header: "Пардохт (TJS)", value: s => HN.paid(s), type: "money", width: 14, total: true },
        { header: "Қарз (TJS)", value: s => HN.debt(s), type: "money", width: 14, total: true, red: true, f: R => `MAX(0,I${R}-J${R})` },
        { header: "Анбор", value: s => HN.whStatusText[HN.whStatus(s)], width: 13 },
        { header: "Ёддошт", value: s => HN.freeNotes(s), width: 28 },
      ], rows });
    });
    if (!specs.length) { HN.toast("Барои содирот маълумот нест."); return; }
    const file = list && list.length === 1 && !withDraft ? `HOJI-NAIM-${list[0].name}-${HN.today()}.xlsx` : `HOJI-NAIM-Дафтар-${HN.today()}.xlsx`;
    if (HN.exportXlsx(file, specs)) setStatus("Файл омода шуд: " + file);
  }

  HN.notebook = {
    render,
    select(key) { pendingSelect = key; selected = null; if (!HN.$("rtab-notebook")?.classList.contains("hidden")) render(); },
  };
})();
