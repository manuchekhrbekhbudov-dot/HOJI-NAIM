/* HOJI-NAIM CARGO — "Дафтари Excel".
   Each sheet (Лист1, Лист2 …) is one customer's cargo ledger, laid out exactly like the
   company's Excel template "Новый образец 2025":
     rows 1–2  Код / Тел
     rows 4–5  Карго | Место | Юань | Доллар
     rows 6–7  Итого:
     row  8    п/н · Дата · магазин · город · Наим-ие товара · высота · ширина · длина · место ·
               Общий объем, куб · кг · Общий объем, кг · цена куб · Сумма за куб · цена кг ·
               Сумма за кг · итоговая цена · кг в одном кубе
     rows 9+   data (formulas as in the template)
   Sheets are stored in this browser (and in the shared customer_sheets table when the
   optional SQL is installed). Shipments of the same customer code that already exist in the
   database are shown read-only in the sheet, so the sheet always shows that customer only. */
(() => {
  "use strict";
  const HN = window.HN, S = HN.state, esc = HN.esc;
  const D = HN.config.defaults;

  const BOOK_KEY = "hn-workbook-v3";
  const OLD_DRAFT_KEY = "hoji-naim-cargo-sheet-v1";       // previous version — migrated, kept
  const OLD_META_KEY = "hoji-naim-cargo-sheet-meta-v1";
  const FIRST = 9;           // first data row, as in the template
  const MIN_ROWS = 100;      // rows 9–108, as in the template
  const N = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, "").slice(0, 8);

  // Excel-like number display: "1 250,00" (comma decimals as in the company's Excel).
  const xf = (v, d = 2) => { const s = HN.fmt(v, d).replace("−", "-"); return d ? s.replace(/\.(\d+)$/, ",$1") : s; };

  /* ---------- Template columns ---------- */
  // key, header, kind (in = input, f = formula), width px
  const COLS = [
    ["no", "П/н", "f", 38], ["date", "Дата", "in", 92], ["shop", "магазин", "in", 80], ["city", "город", "in", 72],
    ["item", "Наим-ие товвара", "in", 104], ["height", "высота", "in", 58], ["width", "ширина", "in", 58], ["length", "длина", "in", 58],
    ["places", "место", "in", 52], ["cube", "Общий объем, куб", "f", 76], ["kgPerPlace", "кг", "in", 52], ["kg", "Общий объем, кг", "f", 76],
    ["cubePrice", "цена куб", "in", 58], ["cubeAmount", "Сумма за куб", "f", 78], ["kgPrice", "цена кг", "in", 56], ["kgAmount", "Сумма за кг", "f", 78],
    ["price", "итоговая цена", "f", 84], ["density", "кг в одном кубе", "f", 70],
  ];
  const LETTER = Object.fromEntries(COLS.map(([k], i) => [k, String.fromCharCode(65 + i)]));
  const RED = new Set(["cube", "kg", "cubeAmount", "kgAmount"]);
  const TEXT = new Set(["date", "shop", "city", "item"]);
  const FORMULA = {
    // exactly the formulas of «Новый образец 2025»
    no: r => `=IF(ISBLANK(F${r});"";COUNTA($F$${FIRST}:F${r}))`,
    cube: r => `=I${r}*H${r}*G${r}*F${r}`, kg: r => `=K${r}*I${r}`, cubeAmount: r => `=M${r}*J${r}`, kgAmount: r => `=O${r}*L${r}`,
    price: r => `=IF(J${r}*M${r}>L${r}*O${r};J${r}*M${r};L${r}*O${r})`, density: r => `=IFERROR(L${r}/J${r};"")`,
  };
  const calc = r => {
    const places = N(r.places), cube = N(r.height) * N(r.width) * N(r.length) * places, kg = N(r.kgPerPlace) * places;
    const cubePrice = r.cubePrice === undefined || r.cubePrice === "" ? D.cubePrice : N(r.cubePrice);
    const kgPrice = r.kgPrice === undefined || r.kgPrice === "" ? D.kgPrice : N(r.kgPrice);
    const cubeAmount = cube * cubePrice, kgAmount = kg * kgPrice;
    return { places, cube, kg, cubePrice, kgPrice, cubeAmount, kgAmount, price: cubeAmount > kgAmount ? cubeAmount : kgAmount, billingType: cubeAmount > kgAmount ? "cube" : "kg", density: cube > 0 ? kg / cube : null };
  };
  // Dates are typed like in Excel: 07.11.2026 (also accepts 2026-11-07).
  const toISO = v => { const t = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/); if (!m) return ""; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); };
  const showDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? HN.fmtDate(v) : String(v ?? ""));
  const used = r => !!r && !r.ro && ["date", "shop", "city", "item", "height", "width", "length", "places", "kgPerPlace"].some(k => String(r[k] ?? "").trim() !== "");

  /* ---------- Workbook storage ---------- */
  let book = null;
  const READY_SHEETS = 10; // Лист1 … Лист10 are always ready; the accountant renames them
  function topUp(b) {
    for (let n = 1; b.sheets.length < READY_SHEETS; n++) {
      if (!b.sheets.some(x => x.name.toLowerCase() === "лист" + n)) b.sheets.push(blankSheet(n));
    }
    return b;
  }
  function blankSheet(n, extra = {}) { return { id: uid(), name: "Лист" + n, code: "", phone: "", rows: [], ...extra }; }
  function loadBook() {
    const saved = HN.lsGet(BOOK_KEY, null);
    if (saved && Array.isArray(saved.sheets) && saved.sheets.length) return topUp(saved);
    // First run: migrate the previous single "Карго" ledger (grouped by customer code).
    const old = HN.lsGet(OLD_DRAFT_KEY, []), meta = HN.lsGet(OLD_META_KEY, {}) || {};
    const b = { sheets: [], active: null, usdRate: N(meta.usdRate) || D.usdRate, cnyRate: N(meta.cnyRate) > 1 ? N(meta.cnyRate) : D.cnyRate };
    const groups = new Map();
    (Array.isArray(old) ? old : []).forEach(r => {
      const code = String(r.customerCode || meta.code || "").trim();
      if (!groups.has(code)) groups.set(code, { code, phone: String(r.customerPhone || meta.phone || "").trim(), rows: [] });
      groups.get(code).rows.push({ date: r.date || "", shop: r.shop || "", city: r.city || "", item: r.item || "", height: r.height ?? "", width: r.width ?? "", length: r.length ?? "", places: r.places ?? "", kgPerPlace: r.kgPerPlace ?? "", cubePrice: r.cubePrice ?? D.cubePrice, kgPrice: r.kgPrice ?? D.kgPrice, syncTrackingNo: r.syncTrackingNo || "" });
    });
    [...groups.values()].forEach((g, i) => b.sheets.push(blankSheet(i + 1, { code: g.code, phone: g.phone, rows: g.rows })));
    topUp(b);
    b.active = b.sheets[0].id;
    return b;
  }
  let saveTimer = null;
  const dirty = new Set();
  function save(sheet) {
    const ok = HN.lsSet(BOOK_KEY, book);
    setStatus(ok ? "Сабт шуд · " + new Date().toLocaleTimeString("ru-RU").slice(0, 5) : "Хато: браузер маълумотро нигоҳ дошта натавонист");
    if (sheet && S.features.sheetData) { dirty.add(sheet.id); clearTimeout(saveTimer); saveTimer = setTimeout(flushRemote, 900); }
  }
  // Tab order changed → store every sheet's position, not only the edited one.
  function savePositions() { book.sheets.forEach(x => dirty.add(x.id)); save(); if (S.features.sheetData) { clearTimeout(saveTimer); saveTimer = setTimeout(flushRemote, 900); } }
  async function flushRemote() {
    const ids = [...dirty]; dirty.clear();
    for (const id of ids) {
      const sh = book.sheets.find(x => x.id === id); if (!sh) continue;
      const r = await S.db.from("customer_sheets").upsert({ customer_key: "sheet:" + sh.id, sheet_name: sh.name, client_code: sh.code || "", phone: sh.phone || "", customer_name: sh.code || "", data: { rows: sh.rows }, position: book.sheets.indexOf(sh) }, { onConflict: "customer_key" });
      if (r.error) { console.warn("Sheet sync", r.error); setStatus("Дар база сабт нашуд — дар браузер нигоҳ дошта шуд"); }
    }
  }
  // When the optional SQL (customer_sheets.data) exists, sheets are shared by all staff.
  async function loadRemote() {
    if (!S.features.sheets || !S.db) return;
    const r = await S.db.from("customer_sheets").select("customer_key,sheet_name,client_code,phone,data,position").like("customer_key", "sheet:%");
    if (r.error) { S.features.sheetData = false; return; }
    S.features.sheetData = true;
    // Order of tabs = saved position; sheets saved with the same position (older versions) go in natural order Лист1, Лист2 … Лист10.
    const natural = (a, b) => String(a.sheet_name || "").localeCompare(String(b.sheet_name || ""), "ru", { numeric: true });
    let remote = (r.data || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || natural(a, b));
    const pos = remote.map(x => x.position ?? 0), broken = new Set(pos).size !== pos.length;
    if (broken) remote = remote.slice().sort(natural);
    if (!remote.length) { book.sheets.forEach(sh => dirty.add(sh.id)); flushRemote(); return; } // first upload
    const local = new Map(book.sheets.map(s => [s.id, s]));
    book.sheets = remote.map(x => { const id = x.customer_key.slice(6); return { ...(local.get(id) || {}), id, name: x.sheet_name, code: x.client_code || "", phone: x.phone || "", rows: Array.isArray(x.data?.rows) ? x.data.rows : [] }; });
    const before = book.sheets.length; topUp(book); book.sheets.slice(before).forEach(x => dirty.add(x.id));
    if (broken) book.sheets.forEach(x => dirty.add(x.id));   // write the repaired order back once
    if (dirty.size) flushRemote();
    if (!book.sheets.some(s => s.id === book.active)) book.active = book.sheets[0]?.id;
    HN.lsSet(BOOK_KEY, book);
  }

  /* ---------- Database rows of the sheet's customer (read-only) ---------- */
  function dbRows(sh) {
    const code = String(sh.code || "").trim().toLocaleLowerCase();
    if (!code) return [];
    const mine = new Set(sh.rows.map(r => r.syncTrackingNo).filter(Boolean));
    return S.shipments.filter(s => HN.customerCode(s).toLocaleLowerCase() === code && !mine.has(s.tracking_no))
      .sort((a, b) => HN.shipmentDate(a).localeCompare(HN.shipmentDate(b)))
      .map(s => {
        const places = HN.places(s) || 1, dims = String(HN.noteValue(s, "Андоза") || "").replace(/м/g, "").split("×").map(x => N(x.trim()));
        const cubePrice = HN.noteNumber(s, "Нархи куб") ?? D.cubePrice, kgPrice = HN.noteNumber(s, "Нархи кг") ?? D.kgPrice;
        const cube = HN.num(s.volume_m3), kg = HN.num(s.weight_kg);
        const usd = s.currency === "USD" ? HN.num(s.total_original) : HN.total(s) / (book.usdRate || D.usdRate);
        return { ro: true, ship: s, date: HN.shipmentDate(s), shop: HN.noteValue(s, "Мағоза") || "", city: HN.noteValue(s, "Шаҳр") || "", item: HN.noteValue(s, "Мол") || s.tracking_no || "",
          height: dims.length === 3 ? dims[0] : "", width: dims.length === 3 ? dims[1] : "", length: dims.length === 3 ? dims[2] : "", places, kgPerPlace: places ? kg / places : kg,
          cubePrice, kgPrice, c: { places, cube, kg, cubePrice, kgPrice, cubeAmount: cube * cubePrice, kgAmount: kg * kgPrice, price: usd, density: cube > 0 ? kg / cube : null } };
      });
  }

  /* ---------- One customer = one sheet ---------- */
  const codeKey = v => String(v || "").trim().toUpperCase().replace(/[^0-9A-ZА-ЯЁӢӮҚҒҲҶ]/g, "");
  const phoneKey = v => String(v || "").replace(/\D/g, "").slice(-9);
  const isEmptySheet = sh => !String(sh.code || "").trim() && !String(sh.phone || "").trim() && !sh.rows.some(used) && !N(sh.cargoUsd) && !N(sh.cargoYuan) && !N(sh.cargoPlaces);
  async function mergeInto(from, to) {
    const rows = from.rows.filter(used);
    if (rows.length && !(await HN.confirm(`Коди «${from.code}» аллакай дар варақи «${to.name}» ҳаст. ${rows.length} сатри «${from.name}» ба «${to.name}» гузаронида шаванд?`, { title: "Ҳамон муштарӣ", ok: "Гузаронидан" }))) {
      HN.toast(`Ин варақ ҳамон коди «${to.name}»-ро дорад — дар Итого ду бор ҳисоб мешавад.`, "error"); render(); return;
    }
    to.rows = [...to.rows.filter(used), ...rows];
    if (!String(to.phone || "").trim() && String(from.phone || "").trim()) to.phone = from.phone;
    Object.assign(from, { code: "", phone: "", rows: [], cargoUsd: "", cargoYuan: "", cargoPlaces: "" });
    save(from); save(to); book.active = to.id; showTotal = false; selected = null; await render();
    HN.toast(rows.length ? `${rows.length} сатр ба варақи «${to.name}» гузаронида шуд.` : `Муштарии «${to.code}» дар варақи «${to.name}» аст — ба он гузаштем.`, "ok");
  }
  // Ribbon «Муштарӣ»: code or phone → that customer's sheet; a new code takes the first empty sheet.
  async function openCustomer(q) {
    q = String(q || "").trim(); if (!q) return;
    const digits = phoneKey(q), byPhone = /^[+\d\s()-]+$/.test(q) && digits.length >= 7;
    let sh = book.sheets.find(x => codeKey(x.code) === codeKey(q)) || (byPhone && book.sheets.find(x => phoneKey(x.phone) === digits));
    if (!sh) {
      sh = book.sheets.find(isEmptySheet);
      if (!sh) { sh = blankSheet(0, { name: nextName() }); book.sheets.push(sh); }
      if (byPhone) sh.phone = q; else sh.code = q;
      save(sh); HN.toast(`Муштарии нав: варақи «${sh.name}».`, "ok");
    }
    book.active = sh.id; showTotal = false; selected = null; save(); await render();
  }
  async function cleanEmpty() {
    const empty = book.sheets.filter(isEmptySheet), keep = Math.max(0, READY_SHEETS - (book.sheets.length - empty.length));
    const drop = empty.slice(keep);
    if (!drop.length) { HN.toast("Варақи холии зиёдатӣ нест."); return; }
    if (!(await HN.confirm(`${drop.length} варақи холӣ (бе код ва бе сатр) нест карда шаванд? Варақҳои пуршуда намерасанд.`, { title: "Тоза кардани варақҳо", ok: "Тоза кардан" }))) return;
    const ids = new Set(drop.map(x => x.id));
    book.sheets = book.sheets.filter(x => !ids.has(x.id));
    if (!book.sheets.some(x => x.id === book.active)) book.active = book.sheets[0].id;
    savePositions(); if (S.features.sheetData) await S.db.from("customer_sheets").delete().in("customer_key", [...ids].map(id => "sheet:" + id));
    await render(); HN.toast(`${drop.length} варақи холӣ тоза шуд.`, "ok");
  }

  /* ---------- «Ҳамаи борҳои муштарӣ»: one customer by code or phone, from Excel sheets and the system ---------- */
  function customerHistory(q) {
    const ck = codeKey(q), pk = phoneKey(q), byPhone = /^[+\d\s()-]+$/.test(String(q).trim()) && pk.length >= 7;
    const hitCode = c => !!ck && codeKey(c) === ck, hitPhone = p => byPhone && phoneKey(p) === pk;
    const sheets = book.sheets.filter(sh => hitCode(sh.code) || hitPhone(sh.phone));
    const sheetOf = new Map();
    book.sheets.forEach(sh => sh.rows.forEach(r => { if (r.syncTrackingNo && !sheetOf.has(r.syncTrackingNo)) sheetOf.set(r.syncTrackingNo, sh); }));
    const rows = [];
    S.shipments.filter(s => hitCode(HN.customerCode(s)) || hitPhone(s.client_phone)).forEach(s => {
      const sh = sheetOf.get(s.tracking_no), usd = s.currency === "USD" ? HN.num(s.total_original) : HN.total(s) / (book.usdRate || D.usdRate);
      rows.push({ date: HN.shipmentDate(s), src: sh ? "Excel · " + sh.name : "Система", ship: s, code: HN.customerCode(s), phone: s.client_phone || "", item: HN.noteValue(s, "Мол") || (String(s.tracking_no).startsWith("SHEET-") ? "" : s.tracking_no), places: HN.places(s), cube: HN.num(s.volume_m3), kg: HN.num(s.weight_kg), usd, tjs: HN.total(s), paid: HN.paid(s), debt: HN.debt(s) });
    });
    const inSystem = new Set(S.shipments.map(s => s.tracking_no));
    sheets.forEach(sh => sh.rows.filter(used).forEach(r => {
      if (r.syncTrackingNo && inSystem.has(r.syncTrackingNo)) return;
      const x = calc(r);
      rows.push({ date: toISO(r.date) || "", src: "Excel · " + sh.name + " (ҳанӯз дар система нест)", code: sh.code || "", phone: sh.phone || "", item: r.item || "", places: x.places, cube: x.cube, kg: x.kg, usd: x.price, tjs: x.price * book.usdRate, paid: 0, debt: null, pending: true });
    }));
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { rows, sheets };
  }
  function renderHistory(q) {
    const out = HN.$("custOut"); if (!out) return;
    q = String(q || "").trim();
    if (!q) { out.innerHTML = '<p class="muted">Код ё рақами телефонро нависед. Ҳамаи борҳо аз ҳамаи варақҳо ва аз система якҷо нишон дода мешаванд.</p>'; return; }
    const { rows, sheets } = customerHistory(q);
    if (!rows.length) { out.innerHTML = `<p class="muted">Бо «${esc(q)}» бор ёфт нашуд.</p>`; return; }
    const sum = k => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0), days = [...new Set(rows.map(r => r.date).filter(Boolean))];
    const codes = [...new Set(rows.map(r => r.code).filter(Boolean))], phones = [...new Set(rows.map(r => r.phone).filter(Boolean))];
    out.innerHTML = `
      <div class="cust-sum">
        <div><span>Борҳо</span><b>${rows.length}</b></div><div><span>Место</span><b>${xf(sum("places"), 0)}</b></div>
        <div><span>Куб</span><b>${xf(sum("cube"), 3)}</b></div><div><span>Кг</span><b>${xf(sum("kg"), 1)}</b></div>
        <div><span>Ҳамагӣ</span><b>$${xf(sum("usd"))}</b></div><div><span>Пардохт (TJS)</span><b>${HN.money(sum("paid"))}</b></div>
        <div><span>Қарз (TJS)</span><b class="${sum("debt") > 0.005 ? "neg" : ""}">${HN.money(sum("debt"))}</b></div>
      </div>
      <p class="cust-days"><b>Кодҳо:</b> ${esc(codes.join(", ") || "—")} · <b>Телефон:</b> ${esc(phones.join(", ") || "—")} · <b>Варақҳо:</b> ${esc(sheets.map(x => x.name).join(", ") || "—")}<br><b>Рӯзҳои бор (${days.length}):</b> ${days.map(HN.fmtDate).join(", ") || "—"}</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Сана</th><th>Аз куҷо</th><th>Код</th><th>Мол</th><th class="num">Место</th><th class="num">Куб</th><th class="num">Кг</th><th class="num">$</th><th class="num">TJS</th><th class="num">Пардохт</th><th class="num">Қарз</th></tr></thead>
      <tbody>${rows.map(r => `<tr${r.ship ? ` data-ship="${esc(r.ship.id)}" class="clickable" title="Барои кушодани бор пахш кунед"` : ' class="muted"'}><td class="nowrap">${r.date ? HN.fmtDate(r.date) : "—"}</td><td>${esc(r.src)}</td><td>${esc(r.code)}</td><td>${esc(r.item)}</td><td class="num">${xf(r.places, 0)}</td><td class="num">${xf(r.cube, 3)}</td><td class="num">${xf(r.kg, 1)}</td><td class="num">${xf(r.usd)}</td><td class="num">${HN.money(r.tjs)}</td><td class="num">${r.pending ? "—" : HN.money(r.paid)}</td><td class="num">${r.pending ? "—" : HN.money(r.debt)}</td></tr>`).join("")}</tbody></table></div>
      <div class="btn-row"><button class="btn btn-ghost" type="button" id="custXlsx">Excel (.xlsx)</button></div>`;
    HN.$("custXlsx").onclick = () => HN.exportXlsx(`HOJI-NAIM-Муштарӣ-${q.replace(/[\\/?*[\]:\s]/g, "")}-${HN.today()}.xlsx`, [{ name: "Борҳо", title: `HOJI-NAIM CARGO — ҳамаи борҳои муштарӣ: ${q}`, subtitle: `Кодҳо: ${codes.join(", ") || "—"} · Тел: ${phones.join(", ") || "—"} · ${HN.fmtDate(HN.today())}`, columns: [
      { header: "Сана", value: r => r.date, type: "date", width: 12 }, { header: "Аз куҷо", value: r => r.src, width: 28 }, { header: "Код", value: r => r.code, width: 12 }, { header: "Мол", value: r => r.item, width: 20 },
      { header: "Место", value: r => r.places, type: "qty", width: 9, total: true }, { header: "Куб", value: r => Math.round(r.cube * 1000) / 1000, type: "qty", width: 10, total: true }, { header: "Кг", value: r => r.kg, type: "qty", width: 10, total: true },
      { header: "$", value: r => HN.round2(r.usd), type: "money", width: 12, total: true }, { header: "TJS", value: r => HN.round2(r.tjs), type: "money", width: 13, total: true }, { header: "Пардохт", value: r => r.paid, type: "money", width: 13, total: true }, { header: "Қарз", value: r => r.debt ?? "", type: "money", width: 13, total: true, red: true },
    ], rows }]);
  }
  HN.openCustomerHistory = q => {
    if (!book) book = loadBook();
    HN.$("custQ").value = q || ""; renderHistory(q); HN.$("custDialog").showModal(); if (!q) HN.$("custQ").focus();
  };
  document.addEventListener("submit", e => { if (e.target.id !== "custForm") return; e.preventDefault(); renderHistory(HN.$("custQ").value); });
  document.addEventListener("click", e => { const tr = e.target.closest("#custOut tr[data-ship]"); if (tr) { HN.$("custDialog").close(); HN.openDetail(tr.dataset.ship); } });

  /* ---------- Rendering ---------- */
  const root = () => HN.$("notebook");
  const activeSheet = () => book.sheets.find(s => s.id === book.active) || book.sheets[0];
  let selected = null, ready = false, showTotal = false;
  // Totals of one sheet (same numbers as its row 7), used by «Итого Куб».
  function sheetTotals(sh) {
    const all = [...dbRows(sh), ...sh.rows.filter(used)];
    const T = { places: 0, cube: 0, kg: 0, cubeAmount: 0, kgAmount: 0, price: 0 };
    all.forEach(r => { const x = r.ro ? r.c : calc(r); Object.keys(T).forEach(k => (T[k] += x[k] || 0)); });
    return { ...T, density: T.cube > 0 ? T.kg / T.cube : null, cargo: N(sh.cargoUsd), n: all.length };
  }
  const TOTAL_NAME = "Итого Куб";
  // «Итого Куб» lists only sheets that have something in them (rows or cargo $), not empty new Лист tabs.
  const filled = t => t.n > 0 || t.cargo > 0;
  function totalGrid() {
    const list = book.sheets.map(sh => ({ sh, t: sheetTotals(sh) })).filter(x => filled(x.t));
    const G = k => list.reduce((n, x) => n + (x.t[k] || 0), 0);
    const ckey = v => String(v || "").trim().toUpperCase().replace(/[^0-9A-ZА-ЯЁӢӮҚҒҲҶ]/g, "");
    const codeCount = new Map(); list.forEach(({ sh }) => { const k = ckey(sh.code); if (k) codeCount.set(k, (codeCount.get(k) || 0) + 1); });
    const last = 4 + list.length;
    const cols = [["", 44], ["Код", 150], ["Место", 90], ["Куб", 100], ["Кг", 100], ["Сумма куб", 110], ["Сумма кг", 110], ["Сумма оплаты", 120], ["Кг в одном кубе", 110], ["Сумма карго", 110]];
    const keys = [null, null, "places", "cube", "kg", "cubeAmount", "kgAmount", "price", "density", "cargo"];
    const L = c => String.fromCharCode(65 + c);
    const fmtv = (k, v) => (v === null || v === undefined || v === "" ? "" : k === "places" ? xf(v, 0) : k === "cargo" ? xf(v, 0) + "$" : xf(v, k === "density" ? 1 : 2));
    let h = `<tr class="xt-title"><th class="xl-rh">1</th><td class="xl-c" data-r="1" data-c="0"></td><td class="xl-c xt-big" colspan="9" data-r="1" data-c="1">Общий итоги куб,кг (сумма куб,кг)</td></tr>`;
    h += `<tr class="xt-head"><th class="xl-rh">2</th>${cols.map(([t], c) => `<td class="xl-c" data-r="2" data-c="${c}">${t}</td>`).join("")}</tr>`;
    h += `<tr class="xt-sum"><th class="xl-rh">3</th><td class="xl-c" data-r="3" data-c="0"></td><td class="xl-c xt-lbl" data-r="3" data-c="1">Итого:</td>${keys.slice(2).map((k, i) => { const c = i + 2; const v = G(k); /* SUBTOTAL(9, …) of the column, as in the company's file */ return `<td class="xl-c xl-num" data-r="3" data-c="${c}" data-f="=SUBTOTAL(9;${L(c)}5:${L(c)}${last})">${fmtv(k, v)}</td>`; }).join("")}</tr>`;
    h += `<tr class="xt-band"><th class="xl-rh">4</th><td class="xl-c" data-r="4" data-c="0"></td>${cols.slice(1).map((_, i) => `<td class="xl-c" data-r="4" data-c="${i + 1}"></td>`).join("")}</tr>`;
    list.forEach(({ sh, t }, i) => {
      const R = 5 + i, ref = `'${sh.name}'!`;
      const src = { 1: "B1", 2: "I7", 3: "J7", 4: "L7", 5: "N7", 6: "P7", 7: "Q7", 8: "R7", 9: "Q5" };
      const dupOf = codeCount.get(ckey(sh.code)) > 1;
      h += `<tr class="xt-row" data-goto-sheet="${esc(sh.id)}" title="Барои кушодани ${esc(sh.name)} ду бор пахш кунед"><th class="xl-rh">${R}</th><td class="xl-c xl-center" data-r="${R}" data-c="0">${i + 1}</td>${keys.slice(1).map((k, j) => { const c = j + 1; const v = k === null ? esc(sh.code || "") + (c === 1 && dupOf ? " ⚠" : "") : fmtv(k, t[k]); return `<td class="xl-c ${c === 1 ? "xl-center xl-b" + (dupOf ? " xl-dup" : "") : "xl-num"}"${c === 1 && dupOf ? ' title="Ин код дар якчанд варақ ҳаст"' : ""} data-r="${R}" data-c="${c}" data-f="=${esc(ref)}${src[c]}">${v}</td>`; }).join("")}</tr>`;
    });
    if (!list.length) h += `<tr><th class="xl-rh">5</th><td class="xl-c" data-r="5" data-c="0"></td><td class="xl-c muted" colspan="9" data-r="5" data-c="1">Ҳоло ягон варақ пур нашудааст.</td></tr>`;
    return `<table class="xl-grid xl-tot"><colgroup><col class="xl-rhcol">${cols.map(c => `<col style="width:${c[1]}px">`).join("")}</colgroup>
      <thead><tr class="xl-letters"><th class="xl-corner"></th>${cols.map((_, c) => `<th>${L(c)}</th>`).join("")}</tr></thead><tbody>${h}</tbody></table>`;
  }

  async function render() {
    const el = root(); if (!el || !S.user) return;
    // Keep the place: scroll of the grid and of the page, and the cell being typed in (a re-draw must not jump).
    const oldWrap = HN.$("xlGridWrap"), keep = { top: oldWrap?.scrollTop || 0, left: oldWrap?.scrollLeft || 0, y: window.scrollY, sheet: book?.active, total: showTotal };
    const act = document.activeElement?.closest?.("#notebook .xl-c input");
    if (act) keep.focus = { r: act.closest(".xl-c").dataset.r, c: act.closest(".xl-c").dataset.c, a: act.selectionStart, b: act.selectionEnd };
    if (!book) book = loadBook();
    // After «Аз сифр» (supabase/reset-data.sql) every browser forgets its old notebook.
    if (S.resetMark && book.resetMark !== S.resetMark) {
      book = topUp({ sheets: [], active: null, usdRate: book.usdRate || D.usdRate, cnyRate: book.cnyRate || D.cnyRate, resetMark: S.resetMark });
      book.active = book.sheets[0].id; selected = null; showTotal = false;
      try { localStorage.removeItem(OLD_DRAFT_KEY); localStorage.removeItem(OLD_META_KEY); } catch {}
      HN.lsSet(BOOK_KEY, book);
    }
    if (!ready) { ready = true; await loadRemote(); scheduleAuto(); }
    const sh = activeSheet(); book.active = sh.id;
    const ro = dbRows(sh);
    el.innerHTML = `
      <div class="xl">
        <div class="xl-titlebar">
          <span class="xl-logo" aria-hidden="true"><i>X</i></span>
          <span class="xl-qat" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg></span>
          <b class="xl-docname">Новый образец — HOJI-NAIM CARGO.xlsx <span>— Excel</span></b>
          <span class="xl-saved" id="xlSaved">${S.features.sheetData ? "Дар база сабт мешавад" : "Дар ҳамин браузер"}</span>
        </div>
        <div class="xl-menutabs" aria-hidden="true"><span>Файл</span><span class="on">Асосӣ</span><span>Ворид</span><span>Формулаҳо</span><span>Маълумот</span><span>Намоиш</span></div>
        <div class="xl-ribbon" role="toolbar" aria-label="Амалҳои дафтар">
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="sync" ${showTotal ? "disabled" : ""}><svg><use href="#i-refresh"/></svg><span>Сабт дар система</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="del-row" ${showTotal ? "disabled" : ""}><svg><use href="#i-trash"/></svg><span>Нест кардани сатр</span></button></div>
          </div><span class="xl-group-label">Сатрҳо</span></div>
          <div class="xl-group xl-find"><div class="xl-group-btns">
            <form class="xl-findform" id="xlFind" autocomplete="off"><input id="xlFindIn" placeholder="Код ё телефон" aria-label="Муштарӣ: код ё телефон" maxlength="30"><button class="xl-btn" type="submit"><svg><use href="#i-search"/></svg><span>Кушодан</span></button></form>
            <button class="xl-btn" data-xl="customer"><svg><use href="#i-box"/></svg><span>Ҳамаи борҳои муштарӣ</span></button>
          </div><span class="xl-group-label">Муштарӣ</span></div>
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="add-sheet"><svg><use href="#i-sheet"/></svg><span>Варақи нав</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="rename" ${showTotal ? "disabled" : ""}><svg><use href="#i-edit"/></svg><span>Номи варақ</span></button>
            <button class="xl-btn" data-xl="remove-sheet" ${book.sheets.length < 2 || showTotal ? "disabled" : ""}><svg><use href="#i-trash"/></svg><span>Нест кардани варақ</span></button>
            <button class="xl-btn" data-xl="clean"><svg><use href="#i-trash"/></svg><span>Тоза: варақҳои холӣ</span></button></div>
          </div><span class="xl-group-label">Варақҳо</span></div>
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="export-all"><svg><use href="#i-download"/></svg><span>Ҳамаи дафтар (.xlsx)</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="export-sheet"><svg><use href="#i-download"/></svg><span>Ин варақ (.xlsx)</span></button></div>
          </div><span class="xl-group-label">Содирот</span></div>
        </div>
        <div class="xl-formula"><span class="xl-namebox" id="xlName">A${FIRST}</span><span class="xl-fxicons" aria-hidden="true"><i>✕</i><i>✓</i><em>fx</em></span><input id="xlFx" readonly aria-label="Сатри формула" value=""></div>
        <div class="xl-gridwrap" id="xlGridWrap">${showTotal ? totalGrid() : grid(sh, ro)}</div>
        <div class="xl-tabsbar">
          <button class="xl-tabnav" data-xl="tabs-left" aria-label="Варақҳои пешина">◀</button><button class="xl-tabnav" data-xl="tabs-right" aria-label="Варақҳои баъдина">▶</button>
          <div class="xl-tabs" id="xlTabs" role="tablist" aria-label="Варақҳо">
            ${book.sheets.map(x => `<button class="xl-tab${x.id === sh.id && !showTotal ? " on" : ""}" data-sheet="${esc(x.id)}" role="tab" aria-selected="${x.id === sh.id && !showTotal}" title="${esc(x.code ? "Код: " + x.code : "Код нанавишта")} — барои иваз кардани ном ду бор пахш кунед">${esc(x.name)}</button>`).join("")}
            <button class="xl-tab xl-tab-total${showTotal ? " on" : ""}" data-total="1" role="tab" aria-selected="${showTotal}" title="Ҷамъбасти ҳамаи варақҳо">${TOTAL_NAME}</button>
          </div>
          <button class="xl-more" data-xl="all-sheets" title="Ҳамаи варақҳо" aria-label="Ҳамаи варақҳо">⋯</button>
          <button class="xl-addtab" data-xl="add-sheet" title="Варақи нав (Shift+F11)" aria-label="Варақи нав">+</button>
          <div class="xl-sheetmenu hidden" id="xlSheetMenu" role="menu">${book.sheets.map(x => `<button role="menuitem" data-sheet="${esc(x.id)}" class="${x.id === sh.id ? "on" : ""}">${esc(x.name)}${x.code ? ` <small>${esc(x.code)}</small>` : ""}</button>`).join("")}</div>
        </div>
        <div class="xl-status"><span id="xlStatus">Омода</span><span id="xlAgg"></span><span class="xl-sheetcount">${book.sheets.length} варақ</span><span class="xl-zoom" aria-hidden="true"><i class="xl-view on"></i><i class="xl-view v2"></i><i class="xl-view v3"></i><b>−</b><span class="xl-slider"><i></i></span><b>+</b>100%</span></div>
      </div>`;
    const tab = el.querySelector(".xl-tab.on"), bar = el.querySelector(".xl-tabs");
    if (tab && bar && (tab.offsetLeft < bar.scrollLeft || tab.offsetLeft + tab.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = tab.offsetLeft - 40;
    if (showTotal) {
      const all = book.sheets.map(sheetTotals), sum = k => all.reduce((n, t) => n + (t[k] || 0), 0);
      HN.$("xlAgg").textContent = `Варақҳо: ${book.sheets.length} · Место: ${xf(sum("places"), 0)} · куб: ${xf(sum("cube"), 3)} · кг: ${xf(sum("kg"), 1)} · Сумма оплаты: $${xf(sum("price"))}`;
      HN.$("xlName").textContent = "B1"; root().querySelector(".xl").classList.add("xl-showtotal");
    } else refresh();
    if (selected) selectCell(selected.r, selected.c, true);
    if (keep.sheet === book.active && keep.total === showTotal) {
      const w = HN.$("xlGridWrap"); if (w) { w.scrollTop = keep.top; w.scrollLeft = keep.left; }
      if (keep.focus) {
        const inp = root().querySelector(`.xl-c[data-r="${keep.focus.r}"][data-c="${keep.focus.c}"] input`);
        if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(keep.focus.a, keep.focus.b); } catch {} }
      }
      if (Math.abs(window.scrollY - keep.y) > 1) window.scrollTo(0, keep.y);
    }
  }

  const td = (r, c, html, cls = "", attrs = "") => `<td class="xl-c ${cls}" data-r="${r}" data-c="${c}"${attrs}>${html}</td>`;
  const metaIn = (field, value, label, cls = "") => `<input class="xl-cellin ${cls}" data-meta="${field}" value="${esc(value)}" aria-label="${label}">`;
  function grid(sh, ro) {
    const letters = COLS.map((_, i) => String.fromCharCode(65 + i));
    const all = [...ro, ...sh.rows];
    const total = Math.max(MIN_ROWS, all.length + 8);
    const last = FIRST + total - 1;
    const row = (n, cells, cls = "") => `<tr class="${cls}"><th class="xl-rh">${n}</th>${cells}</tr>`;
    const blanks = (from, to, r) => Array.from({ length: to - from + 1 }, (_, i) => td(r, from + i, "", "xl-blank")).join("");
    let h = "";
    h += row(1, td(1, 0, "Код", "xl-b xl-box") + `<td class="xl-c xl-box xl-in" colspan="5" data-r="1" data-c="1">${metaIn("code", sh.code, "Код")}</td>` + blanks(6, 6, 1) + td(1, 7, "Курс $", "xl-b xl-right") + `<td class="xl-c xl-box xl-in xl-num" data-r="1" data-c="8">${metaIn("usdRate", book.usdRate, "Курси доллар")}</td>` + blanks(9, 17, 1));
    h += row(2, td(2, 0, "Тел", "xl-b xl-box") + `<td class="xl-c xl-box xl-in" colspan="5" data-r="2" data-c="1">${metaIn("phone", sh.phone, "Тел")}</td>` + blanks(6, 6, 2) + td(2, 7, "Курс ¥", "xl-b xl-right") + `<td class="xl-c xl-box xl-in xl-num" data-r="2" data-c="8">${metaIn("cnyRate", book.cnyRate, "Курси юан")}</td>` + blanks(9, 17, 2));
    h += row(3, blanks(0, 17, 3));
    h += row(4, blanks(0, 10, 4) + td(4, 11, "", "xl-box xl-lav") + `<td class="xl-c xl-box xl-lav xl-center" colspan="2" data-r="4" data-c="12">Место</td><td class="xl-c xl-box xl-lav xl-center" colspan="2" data-r="4" data-c="14">Юань</td><td class="xl-c xl-box xl-lav xl-center" colspan="2" data-r="4" data-c="16">Доллар</td>`);
    const cargoIn = (f, c, label) => `<td class="xl-c xl-box xl-in xl-center" colspan="2" data-r="5" data-c="${c}">${metaIn(f, sh[f] ?? "", label, "xl-center-in")}</td>`;
    h += row(5, blanks(0, 10, 5) + td(5, 11, "Карго", "xl-box") + cargoIn("cargoPlaces", 12, "Карго: место") + cargoIn("cargoYuan", 14, "Карго: юань") + cargoIn("cargoUsd", 16, "Карго: доллар"));
    const itogo = new Set(["places", "cube", "kg", "cubeAmount", "kgAmount", "price", "density"]);
    h += row(6, COLS.map(([k], c) => itogo.has(k) ? td(6, c, "Итого:", "xl-b xl-box xl-center") : td(6, c, "", "xl-box")).join(""), "xl-r6");
    h += row(7, COLS.map(([k], c) => k === "density" ? td(7, c, "", "xl-box xl-num xl-b", ` data-t="density" data-f="=IFERROR(L7/J7;&quot;&quot;)"`) : itogo.has(k) ? td(7, c, "", "xl-box xl-num xl-b", ` data-t="${k}" data-f="=SUM(${LETTER[k]}${FIRST}:${LETTER[k]}${last})"`) : td(7, c, "", "xl-box")).join(""), "xl-r7");
    h += row(8, COLS.map(([, title], c) => td(8, c, title, "xl-hd")).join(""), "xl-r8");
    for (let i = 0; i < total; i++) {
      const R = FIRST + i, rec = all[i], isRo = !!rec?.ro, li = i - ro.length;
      const cells = COLS.map(([k, , kind], c) => {
        if (kind === "f") return td(R, c, "", `xl-num xl-f${RED.has(k) ? " xl-red" : ""}${k === "price" ? " xl-b" : ""}${k === "no" ? " xl-center" : ""}`, ` data-k="${k}" data-f="${esc(FORMULA[k](R))}"`);
        if (isRo) {
          const v = rec[k];
          const shown = k === "date" ? HN.fmtDate(v) : typeof v === "number" ? xf(v, k === "places" ? 0 : 2).replace(/,00$/, "") : v ?? "";
          return td(R, c, esc(shown), (TEXT.has(k) ? "" : "xl-num ") + "xl-ro");
        }
        const val = rec ? rec[k] ?? (k === "cubePrice" ? D.cubePrice : k === "kgPrice" ? D.kgPrice : "") : k === "cubePrice" ? D.cubePrice : k === "kgPrice" ? D.kgPrice : "";
        const num = !TEXT.has(k);
        return td(R, c, `<input data-row="${li}" data-key="${k}" type="text"${num ? ' inputmode="decimal"' : ""}${k === "date" ? ' placeholder=""' : ""} value="${esc(k === "date" ? showDate(val) : val)}" aria-label="${esc(COLS[c][1])}, сатри ${R}">`, `xl-in${num ? " xl-num" : ""}`);
      }).join("");
      h += `<tr class="xl-data${i % 2 ? " xl-band" : ""}${isRo ? " xl-datarow" : ""}" data-i="${i}"${isRo ? ` data-ship="${esc(rec.ship.id)}" title="Аз база (бор ${esc(rec.ship.tracking_no)}). Барои кушодан ду бор пахш кунед."` : ""}><th class="xl-rh">${R}</th>${cells}</tr>`;
    }
    return `<table class="xl-grid xl-tpl"><colgroup><col class="xl-rhcol">${COLS.map(c => `<col style="width:${c[3]}px">`).join("")}</colgroup>
      <thead><tr class="xl-letters"><th class="xl-corner"></th>${letters.map(l => `<th>${l}</th>`).join("")}</tr></thead><tbody>${h}</tbody></table>
      ${ro.length ? `<p class="xl-note">${ro.length} бори ин муштарӣ аз база нишон дода шуд (хокистарӣ, танҳо барои дидан). Сатрҳои навро дар сатрҳои холӣ нависед.</p>` : ""}`;
  }

  // Recalculate all formula cells in place (keeps focus while typing, like Excel).
  function refresh() {
    const g = root()?.querySelector(".xl-tpl"); if (!g) return;
    const sh = activeSheet(), all = [...dbRows(sh), ...sh.rows];
    const T = { places: 0, cube: 0, kg: 0, cubeAmount: 0, kgAmount: 0, price: 0 };
    let n = 0;
    g.querySelectorAll("tr.xl-data").forEach(tr => {
      const rec = all[Number(tr.dataset.i)];
      const x = rec ? (rec.ro ? rec.c : calc(rec)) : calc({});
      if (rec && (rec.ro || used(rec))) Object.keys(T).forEach(k => (T[k] += x[k] || 0));
      const hasF = !!rec && (rec.ro || String(rec.height ?? "").trim() !== "");
      if (hasF) n++;
      tr.querySelectorAll("[data-k]").forEach(cell => {
        const k = cell.dataset.k;
        cell.textContent = k === "no" ? String(Number(tr.dataset.i) + 1) : k === "density" ? (x.density === null ? "" : xf(x.density)) : xf(x[k]);
      });
    });
    g.querySelectorAll("[data-t]").forEach(cell => {
      const k = cell.dataset.t;
      cell.textContent = k === "places" ? xf(T.places, 0) : k === "density" ? (T.cube > 0 ? xf(T.kg / T.cube, 1) : "") : xf(T[k], 1);
    });
    const agg = HN.$("xlAgg");
    if (agg) agg.textContent = `Борҳо: ${all.filter(r => r.ro || used(r)).length} · Место: ${xf(T.places, 0)} · куб: ${xf(T.cube, 3)} · кг: ${xf(T.kg, 1)} · Итого: $${xf(T.price)} (${xf(T.price * book.usdRate)} TJS)`;
  }

  /* ---------- Selection & formula bar ---------- */
  function selectCell(r, c, silent) {
    const el = root()?.querySelector(`.xl-c[data-r="${r}"][data-c="${c}"]`);
    root()?.querySelectorAll(".xl-c.sel").forEach(x => x.classList.remove("sel"));
    root()?.querySelectorAll(".xl-letters th.on, .xl-rh.on").forEach(x => x.classList.remove("on"));
    if (!el) return;
    selected = { r, c };
    el.classList.add("sel");
    root().querySelectorAll(".xl-letters th")[c + 1]?.classList.add("on");
    el.closest("tr")?.querySelector(".xl-rh")?.classList.add("on");
    HN.$("xlName").textContent = String.fromCharCode(65 + c) + r;
    const input = el.querySelector("input");
    HN.$("xlFx").value = el.dataset.f || (input ? input.value : el.textContent.trim());
    if (!silent && !input) { const t = el.textContent.trim(); if (t && /^[\d\s ,.-]+$/.test(t)) setStatus("Қимат: " + t); }
  }
  function setStatus(t) { const s = HN.$("xlStatus"); if (s) s.textContent = t; }

  /* ---------- Events ---------- */
  document.addEventListener("click", async e => {
    if (!e.target.closest("#notebook")) return;
    if (e.target.closest("[data-total]")) { if (!showTotal) { showTotal = true; selected = null; await render(); } return; }
    const tab = e.target.closest("[data-sheet]");
    if (tab && !tab.querySelector("input")) {
      const id = tab.dataset.sheet;
      if (id !== book.active || showTotal) { showTotal = false; book.active = id; selected = null; save(); await render(); }
      if (e.detail === 2) { const on = root().querySelector(".xl-tab.on"); if (on) startRename(on); }
      return;
    }
    const btn = e.target.closest("[data-xl]");
    if (btn) { action(btn.dataset.xl); return; }
    const cell = e.target.closest(".xl-c[data-r]");
    if (cell) selectCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  document.addEventListener("submit", e => { if (e.target.id !== "xlFind") return; e.preventDefault(); openCustomer(HN.$("xlFindIn").value); });
  document.addEventListener("keydown", e => { if (e.shiftKey && e.key === "F11" && HN.$("notebook")?.offsetParent) { e.preventDefault(); action("add-sheet"); } });
  document.addEventListener("click", e => { const m = HN.$("xlSheetMenu"); if (m && !m.classList.contains("hidden") && !e.target.closest("#xlSheetMenu, [data-xl=all-sheets]")) m.classList.add("hidden"); });
  document.addEventListener("dblclick", async e => {
    const go = e.target.closest("#notebook tr[data-goto-sheet]");
    if (go) { showTotal = false; book.active = go.dataset.gotoSheet; selected = null; save(); await render(); return; }
    const row = e.target.closest("#notebook tr.xl-datarow[data-ship]");
    if (row) HN.openDetail(row.dataset.ship);
  });
  document.addEventListener("focusin", e => {
    const input = e.target.closest("#notebook .xl-c input"); if (!input) return;
    const cell = input.closest(".xl-c"); selectCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  document.addEventListener("input", e => {
    const input = e.target.closest("#notebook .xl-c input"); if (!input) return;
    const sh = activeSheet();
    if (input.dataset.meta) {
      const k = input.dataset.meta;
      if (k === "usdRate" || k === "cnyRate") book[k] = N(input.value) || (k === "usdRate" ? D.usdRate : D.cnyRate);
      else sh[k] = input.value;
      save(sh); refresh(); if (k === "code" || k === "phone") scheduleAuto(); return;
    }
    const i = Number(input.dataset.row);
    while (sh.rows.length <= i) sh.rows.push({});
    sh.rows[i][input.dataset.key] = input.value;
    HN.$("xlFx").value = input.value;
    save(sh); refresh(); scheduleAuto();
  });
  document.addEventListener("change", e => {
    const d = e.target.closest('#notebook input[data-key="date"]');
    if (d) { const iso = toISO(d.value); const sh = activeSheet(), i = Number(d.dataset.row); if (sh.rows[i]) { sh.rows[i].date = iso || d.value; save(sh); } if (iso) d.value = HN.fmtDate(iso); else if (d.value.trim()) HN.toast("Санаро ба шакли 07.11.2026 нависед.", "error"); return; }
    if (!e.target.closest('#notebook input[data-meta="code"]')) return;
    // Same code on another sheet → this is the same customer: go there (and move rows) instead of a second sheet.
    const cur = activeSheet(), dup = codeKey(cur.code) && book.sheets.find(x => x.id !== cur.id && codeKey(x.code) === codeKey(cur.code));
    if (dup) { mergeInto(cur, dup); return; }
    // A new code may match shipments already in the database → redraw the sheet.
    const pos = selected; render().then(() => { if (pos) selectCell(pos.r, pos.c, true); });
  });
  document.addEventListener("keydown", e => {
    const input = e.target.closest("#notebook .xl-c input"); if (!input) return;
    const cell = input.closest(".xl-c"), r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    const go = dr => {
      for (let rr = r + dr, k = 0; k < 60; k++, rr += dr) {
        const t = root().querySelector(`.xl-c[data-r="${rr}"][data-c="${c}"] input`);
        if (t) { e.preventDefault(); t.focus(); t.select?.(); return; }
        if (!root().querySelector(`.xl-c[data-r="${rr}"][data-c="${c}"]`)) return;
      }
    };
    const side = dc => {
      for (let cc = c + dc, k = 0; k < 20 && cc >= 0; k++, cc += dc) {
        const t = root().querySelector(`.xl-c[data-r="${r}"][data-c="${cc}"] input`);
        if (t) { e.preventDefault(); t.focus(); t.select?.(); return; }
        if (!root().querySelector(`.xl-c[data-r="${r}"][data-c="${cc}"]`)) return;
      }
    };
    const len = input.value.length, a0 = input.selectionStart, b0 = input.selectionEnd, all = a0 === 0 && b0 === len;
    if (e.key === "Enter" || e.key === "ArrowDown") go(1);
    else if (e.key === "ArrowUp") go(-1);
    else if (e.key === "ArrowRight" && (all || a0 === len)) side(1);
    else if (e.key === "ArrowLeft" && (all || b0 === 0)) side(-1);
  });

  /* ---------- Sheet actions ---------- */
  function validName(name, exceptId) {
    const n = String(name || "").trim();
    if (!n) return "Номи варақро нависед.";
    if (n.length > 31) return "Номи варақ бояд то 31 аломат бошад.";
    if (/[\\/?*[\]:]/.test(n)) return "Дар номи варақ аломатҳои \\ / ? * [ ] : иҷозат нестанд.";
    if (book.sheets.some(x => x.id !== exceptId && x.name.toLowerCase() === n.toLowerCase())) return "Варақ бо ҳамин ном аллакай ҳаст.";
    return "";
  }
  function nextName() {
    const nums = book.sheets.map(s => (/^лист\s*(\d+)$/i.exec(s.name) || [])[1]).filter(Boolean).map(Number);
    let n = Math.max(book.sheets.length, ...nums, 0) + 1;
    while (book.sheets.some(s => s.name.toLowerCase() === "лист" + n)) n++;
    return "Лист" + n;
  }
  function startRename(tab) {
    const id = tab.dataset.sheet, old = tab.textContent;
    tab.innerHTML = `<input class="xl-tabinput" value="${esc(old)}" maxlength="31" aria-label="Номи нави варақ">`;
    const box = tab.querySelector("input"); box.focus(); box.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      const name = box.value.trim();
      if (ok && name !== old) {
        const bad = validName(name, id);
        if (bad) HN.toast(bad, "error");
        else { const sh = book.sheets.find(s => s.id === id); sh.name = name; save(sh); HN.toast("Номи варақ иваз шуд: " + name, "ok"); }
      }
      render();
    };
    box.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); finish(true); } if (ev.key === "Escape") finish(false); });
    box.addEventListener("blur", () => finish(true));
  }
  async function action(kind) {
    const sh = activeSheet();
    if (kind === "tabs-left" || kind === "tabs-right") { root().querySelector(".xl-tabs")?.scrollBy({ left: kind === "tabs-left" ? -200 : 200, behavior: "smooth" }); return; }
    if (kind === "add-sheet") {
      const n = blankSheet(0, { name: nextName() });
      book.sheets.push(n); book.active = n.id; selected = null; savePositions(); await render();
      setStatus("Варақи «" + n.name + "» илова шуд"); return;
    }
    if (kind === "clean") { await cleanEmpty(); return; }
    if (kind === "customer") { HN.openCustomerHistory(showTotal ? "" : (sh.code || sh.phone || "")); return; }
    if (kind === "all-sheets") { HN.$("xlSheetMenu")?.classList.toggle("hidden"); return; }
    if (kind === "rename") { const t = root().querySelector(".xl-tab.on"); if (t) startRename(t); return; }
    if (kind === "remove-sheet") {
      if (book.sheets.length < 2) return;
      const filled = sh.rows.filter(used).length;
      if (!(await HN.confirm(`Варақи «${sh.name}»${filled ? ` (${filled} сатр)` : ""} нест карда шавад? Борҳое, ки аллакай дар система сабт шудаанд, нест намешаванд.`, { title: "Нест кардани варақ", ok: "Нест кардан", danger: true }))) return;
      book.sheets = book.sheets.filter(s => s.id !== sh.id); book.active = book.sheets[0].id; selected = null; savePositions();
      if (S.features.sheetData) await S.db.from("customer_sheets").delete().eq("customer_key", "sheet:" + sh.id);
      await render(); return;
    }
    if (kind === "del-row") {
      const tr = root().querySelector(".xl-c.sel")?.closest("tr.xl-data");
      if (!tr) { HN.toast("Аввал ҳуҷайраеро дар сатр интихоб кунед."); return; }
      if (tr.classList.contains("xl-datarow")) { HN.toast("Ин сатр аз база аст. Борро дар қисми «Борҳо» таҳрир ё нест кунед."); return; }
      const li = Number(tr.dataset.i) - dbRows(sh).length, r = sh.rows[li];
      if (!r) return;
      if (used(r) && !(await HN.confirm(`Сатри ${FIRST + Number(tr.dataset.i)} нест карда шавад?${r.syncTrackingNo ? " Он аз система (борҳо ва ҳисобот) ҳам нест мешавад." : ""}`, { ok: "Нест кардан", danger: true }))) return;
      const warn = await removeSynced(r); if (warn) HN.toast(warn, "info");
      sh.rows.splice(li, 1); save(sh); await render(); return;
    }
    if (showTotal && ["sync", "del-row", "rename", "remove-sheet"].includes(kind)) { HN.toast("Аввал варақи муштариро (Лист…) интихоб кунед."); return; }
    if (kind === "add-sheet") showTotal = false;
    if (kind === "sync") { await sync(sh); return; }
    if (kind === "export-sheet") { exportBook(showTotal ? book.sheets : [sh]); return; }
    if (kind === "export-all") exportBook(book.sheets);
  }

  /* ---------- Save rows into the system as shipments ---------- */
  // A row is ready for the system when it has a date, a price > 0 and the sheet has a code.
  const rowReady = r => used(r) && !!toISO(r.date) && calc(r).price > 0;
  const rowSig = (sh, r) => JSON.stringify([sh.code, sh.phone, ...["date", "shop", "city", "item", "height", "width", "length", "places", "kgPerPlace", "cubePrice", "kgPrice"].map(k => String(r[k] ?? ""))]);
  async function upsertRow(sh, r, rate) {
    const x = calc(r), code = String(sh.code || "").trim(), phone = String(sh.phone || "").trim();
    if (HN.isLocked?.(toISO(r.date) || HN.today())) throw new Error(HN.lockMsg());
    if (!r.syncTrackingNo) { const d = (toISO(r.date) || HN.today()).replace(/-/g, ""); r.syncTrackingNo = "SHEET-" + d + "-" + (code.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "CLIENT") + "-" + uid().toUpperCase(); }
    const existing = S.shipments.find(s => s.tracking_no === r.syncTrackingNo);
    const parts = { "Коди муштарӣ": code, "Телефон": phone, "Ҷойҳо": x.places, "Кг барои ҷой": N(r.kgPerPlace), "Нархи куб": x.cubePrice, "Сумма куб": x.cubeAmount.toFixed(2), "Нархи кг": x.kgPrice, "Сумма кг": x.kgAmount.toFixed(2), "Шаҳр": r.city || "", "Мол": r.item || "", "Андоза": N(r.height) && N(r.width) && N(r.length) ? `${r.height} × ${r.width} × ${r.length} м` : "", "Мағоза": r.shop || "" };
    const notes = HN.buildNotes(existing ? existing.notes : "Дафтари Excel", parts, existing ? undefined : "");
    if (existing && N(existing.fx_rate) > 0) rate = N(existing.fx_rate);   // a saved shipment keeps its own rate
    const tjs = HN.round2(x.price * rate);
    if (existing && tjs < HN.paid(existing) - 0.005) throw new Error(`бори ${r.syncTrackingNo}: ҳисоби нав аз пардохтшуда кам аст`);
    const payload = { client_phone: phone, tracking_no: r.syncTrackingNo, shipment_date: toISO(r.date) || HN.today(), billing_type: x.billingType, weight_kg: x.kg, volume_m3: Math.round(x.cube * 10000) / 10000, currency: "USD", unit_price: x.billingType === "kg" ? x.kgPrice : x.cubePrice, fx_rate: rate, total_original: HN.round2(x.price), total_tjs: tjs, notes, client_name: existing?.client_name && existing.client_name !== existing.tracking_no ? existing.client_name : code };
    if (!existing) payload.created_by = S.user.id;
    const { error } = await S.db.from("shipments").upsert(payload, { onConflict: "tracking_no" });
    if (error) throw error;
    r.syncSig = rowSig(sh, r);
  }
  async function sync(sh) {
    if (!HN.can("staff")) { HN.toast("Барои сабт дар система иҷозати корманд лозим аст."); return; }
    const code = String(sh.code || "").trim();
    if (!code) { HN.toast("Дар ҳуҷайраи «Код» (B1) коди муштариро нависед.", "error"); root().querySelector('input[data-meta="code"]')?.focus(); return; }
    const rows = sh.rows.filter(used);
    if (!rows.length) { HN.toast("Дар варақ ҳоло сатри пуршуда нест."); return; }
    const bad = rows.find(r => calc(r).price <= 0);
    if (bad) { HN.toast(`Сатри ${FIRST + dbRows(sh).length + sh.rows.indexOf(bad)}: место, андоза ё кг пур нашудааст — нарх 0 аст.`, "error"); return; }
    const rate = N(book.usdRate);
    if (rate <= 0) { HN.toast("Курси долларро (I1) дуруст нависед.", "error"); return; }
    setStatus("Сабт шуда истодааст…");
    let done = 0;
    try {
      for (const r of rows) { await upsertRow(sh, r, rate); done++; }
      save(sh); await HN.reload();
      HN.toast(`Варақи «${sh.name}» ба система сабт шуд: ${done} бор.`, "ok");
    } catch (err) {
      console.error("Notebook sync", err); save(sh);
      HN.toast(`Сабт пас аз ${done} сатр қатъ шуд: ${HN.dbError(err)}`, "error"); setStatus("Хатои сабт");
    }
  }
  /* Automatic: what is typed in Excel goes into the system by itself (reports, debts, Telegram).
     Only finished rows (date + место + size or kg) are written; unchanged rows are skipped. */
  let autoTimer = null, autoBusy = false, autoWarned = "";
  function scheduleAuto() { clearTimeout(autoTimer); autoTimer = setTimeout(autoSync, 2500); }
  async function autoSync() {
    if (autoBusy) { scheduleAuto(); return; }
    if (!S.user || !HN.can("staff")) return;
    const rate = N(book.usdRate); if (rate <= 0) return;
    const jobs = [];
    book.sheets.forEach(sh => {
      if (!String(sh.code || "").trim()) return;
      sh.rows.forEach(r => {
        // rows saved earlier with the button: take them as up to date (no re-pricing of old shipments)
        if (r.syncTrackingNo && !r.syncSig && S.shipments.some(x => x.tracking_no === r.syncTrackingNo)) { r.syncSig = rowSig(sh, r); save(sh); return; }
        if (rowReady(r) && r.syncSig !== rowSig(sh, r)) jobs.push([sh, r]);
      });
    });
    if (!jobs.length) return;
    autoBusy = true; setStatus("Ба система сабт шуда истодааст…");
    let done = 0;
    try {
      for (const [sh, r] of jobs) { await upsertRow(sh, r, rate); done++; save(sh); }
      await HN.reload();
      setStatus(`Дар система сабт шуд ✓ (${done}) · ` + new Date().toLocaleTimeString("ru-RU").slice(0, 5));
      autoWarned = "";
    } catch (err) {
      console.warn("Auto sync", err); const m = HN.dbError(err);
      setStatus("Ба система сабт нашуд: " + m);
      if (autoWarned !== m) { autoWarned = m; HN.toast("Дафтар ба система сабт нашуд: " + m, "error"); }
    } finally { autoBusy = false; }
  }
  HN.notebookAutoSync = autoSync;
  // Deleting a row that is already in the system also removes that shipment (if it has no payments).
  async function removeSynced(r) {
    const s = r.syncTrackingNo && S.shipments.find(x => x.tracking_no === r.syncTrackingNo);
    if (!s) return "";
    if (HN.paid(s) > 0.005) return "Бор пардохт дорад, барои ҳамин дар система монд. Онро дар «Борҳо» тағйир диҳед.";
    if (!HN.can("delete")) return "Бор дар система монд: барои нест кардан иҷозати админ лозим аст.";
    const res = await S.db.rpc("admin_delete_shipment", { target_shipment_id: s.id });
    if (res.error) return "Бор дар система монд: " + HN.dbError(res.error);
    await HN.reload(); return "";
  }

  /* ---------- Real .xlsx in the company's template layout («Новый образец 2025») ---------- */
  async function exportBook(sheets) {
    let X;
    try { if (!window.XLSX?.utils) setStatus("Файли Excel омода мешавад…"); X = await HN.loadXlsx(); }
    catch { HN.toast("Китобхонаи Excel бор нашуд. Интернетро санҷед ва дубора кӯшиш кунед.", "error"); return; }
    const wb = X.utils.book_new(), names = new Set(), exported = [];
    const side = st => ({ style: st, color: { rgb: "000000" } });
    const B = { top: side("thin"), bottom: side("thin"), left: side("thin"), right: side("thin") };
    const BM = { top: side("medium"), bottom: side("medium"), left: side("medium"), right: side("medium") };
    const font = (o = {}) => ({ name: "Calibri", sz: 12, ...o });
    const fill = rgb => ({ patternType: "solid", fgColor: { rgb } });
    const ctr = { horizontal: "center", vertical: "center", wrapText: true };
    sheets.forEach(sh => {
      const all = [...dbRows(sh), ...sh.rows.filter(used)];
      const total = Math.max(MIN_ROWS, all.length), last = FIRST + total - 1;
      const ws = {}, merges = [];
      const put = (ref, cell) => (ws[ref] = cell);
      const txt = (ref, v, s = {}) => put(ref, { t: "s", v, s: { font: font(s.font), alignment: s.alignment || { vertical: "center" }, border: s.border, fill: s.fill, numFmt: s.numFmt } });
      const merge = r => merges.push(X.utils.decode_range(r));
      txt("A1", "Код", { font: { bold: true }, border: B }); txt("B1", sh.code || "", { font: { sz: 14, bold: true }, border: B, alignment: ctr, numFmt: "@" }); ["C1", "D1", "E1", "F1"].forEach(r => txt(r, "", { border: B })); merge("B1:F1");
      txt("A2", "Тел", { font: { bold: true }, border: B }); txt("B2", sh.phone || "", { font: { sz: 14, bold: true }, border: B, alignment: ctr, numFmt: "@" }); ["C2", "D2", "E2", "F2"].forEach(r => txt(r, "", { border: B })); merge("B2:F2");
      txt("H1", "Курс $", { font: { bold: true }, alignment: { horizontal: "right" } }); put("I1", { t: "n", v: N(book.usdRate), z: "0.0000", s: { font: font(), border: B, numFmt: "0.0000" } });
      txt("H2", "Курс ¥", { font: { bold: true }, alignment: { horizontal: "right" } }); put("I2", { t: "n", v: N(book.cnyRate), z: "0.0000", s: { font: font(), border: B, numFmt: "0.0000" } });
      txt("L4", "", { border: B, fill: fill("CCCCFF") });
      [["M4", "N4", "Место"], ["O4", "P4", "Юань"], ["Q4", "R4", "Доллар"]].forEach(([a, b, t]) => { txt(a, t, { border: B, alignment: ctr, fill: fill("CCCCFF") }); txt(b, "", { border: B, fill: fill("CCCCFF") }); merge(a + ":" + b); });
      txt("L5", "Карго", { border: B });
      [["M5", "N5", "cargoPlaces", "General"], ["O5", "P5", "cargoYuan", "General"], ["Q5", "R5", "cargoUsd", '0"$"']].forEach(([a, b, k, z]) => {
        const v = sh[k]; if (String(v ?? "").trim() !== "" && Number.isFinite(Number(String(v).replace(",", ".")))) put(a, { t: "n", v: N(v), z, s: { font: font(), border: B, numFmt: z, alignment: ctr } }); else txt(a, String(v ?? ""), { border: B, alignment: ctr });
        txt(b, "", { border: B }); merge(a + ":" + b);
      });
      const T = all.reduce((t, r) => { const x = r.ro ? r.c : calc(r); ["places", "cube", "kg", "cubeAmount", "kgAmount", "price"].forEach(k => (t[k] += x[k] || 0)); return t; }, { places: 0, cube: 0, kg: 0, cubeAmount: 0, kgAmount: 0, price: 0 });
      COLS.forEach(([k, title], c) => {
        const L = String.fromCharCode(65 + c);
        const tot = ["places", "cube", "kg", "cubeAmount", "kgAmount", "price"].includes(k);
        if (tot || k === "density") txt(L + "6", "Итого:", { font: { sz: 16, bold: true }, border: B, alignment: ctr, fill: fill("C0C0C0") }); else txt(L + "6", "", { border: B });
        if (tot) { const z = k === "places" ? "General" : "#,##0.0"; put(L + "7", { t: "n", f: `SUM(${L}${FIRST}:${L}${last})`, v: T[k], z, s: { font: font({ bold: true }), border: B, numFmt: z } }); }
        else if (k === "density") put(L + "7", { t: T.cube > 0 ? "n" : "s", f: 'IFERROR(L7/J7,"")', v: T.cube > 0 ? T.kg / T.cube : "", z: "#,##0.0", s: { font: font({ bold: true }), border: B, numFmt: "#,##0.0" } });
        else txt(L + "7", "", { border: B });
        txt(L + "8", title.replace("Наим-ие товвара", "Наим-ие\nтоввара").replace("Общий объем", "Общий\nобъем"), { font: { sz: 10, bold: true, color: { rgb: "003366" } }, border: B, alignment: ctr, fill: fill("C0C0C0") });
      });
      for (let i = 0; i < total; i++) {
        const R = FIRST + i, r = all[i] || {}, x = r.ro ? r.c : calc(r);
        const band = i % 2 ? fill("CCCCFF") : undefined;
        COLS.forEach(([k, , kind], c) => {
          const ref = String.fromCharCode(65 + c) + R, base = { border: B, fill: band, alignment: { vertical: "center" } };
          if (kind === "f" && k === "cube" && r.ro && !(N(r.height) && N(r.width) && N(r.length))) {
            // shipment from the database without dimensions: keep its real volume
            put(ref, { t: "n", v: x.cube, z: "#,##0.00", s: { ...base, numFmt: "#,##0.00", font: font({ color: { rgb: "FF0000" }, bold: true }) } });
            return;
          }
          if (kind === "f") {
            const f = FORMULA[k](R).slice(1).replace(/;/g, ",");
            const v = k === "no" ? i + 1 : k === "density" ? (x.density ?? "") : x[k];
            const z = k === "no" ? "General" : "#,##0.00";
            put(ref, { t: v === "" ? "s" : "n", v, f, z, s: { ...base, numFmt: z, font: font({ color: RED.has(k) ? { rgb: "FF0000" } : undefined, bold: RED.has(k) || k === "price" }), alignment: { horizontal: k === "no" ? "center" : undefined, vertical: "center" } } });
            return;
          }
          let raw = r[k];
          if (raw === undefined || raw === null || raw === "") raw = k === "cubePrice" ? D.cubePrice : k === "kgPrice" ? D.kgPrice : "";
          if (k === "date" && toISO(raw)) { const d = HN.parseDate(toISO(raw)); put(ref, { t: "d", v: d, z: "dd.mm.yyyy", s: { ...base, font: font(), numFmt: "dd.mm.yyyy" } }); }
          else if (TEXT.has(k) || raw === "") put(ref, { t: "s", v: String(raw), s: { ...base, font: font() } });
          else put(ref, { t: "n", v: N(raw), s: { ...base, font: font() } });
        });
      }
      ws["!ref"] = "A1:R" + last; ws["!merges"] = merges;
      ws["!cols"] = [6.8, 13.6, 9.7, 9.1, 12.8, 9.6, 10.1, 10.8, 10, 12.6, 8.7, 11.6, 9.1, 12.1, 11.8, 12, 12.1, 11.6].map(w => ({ wch: w }));
      ws["!rows"] = Array.from({ length: last }, (_, i) => ({ hpt: [18.75, 18.75, 12.75, 15.75, 15.75, 21.75, 29.25, 50.25][i] || 15.75 }));
      const name = HN.safeSheetName(sh.name, names);
      exported.push({ name, sh, T: { ...T, n: all.length } });
      X.utils.book_append_sheet(wb, ws, name);
    });
    // «Итого Куб» — the last sheet, linked to every Лист by formulas (as in the company's file).
    if (sheets.length > 1) {
      const totalRows = exported.filter(e => filled({ n: e.T.n, cargo: N(e.sh.cargoUsd) }));
      const ws = {}, L = c => String.fromCharCode(65 + c), last = 4 + Math.max(1, totalRows.length);
      const put = (ref, cell) => (ws[ref] = cell);
      const st = (o = {}) => ({ font: font({ sz: 14, ...o.font }), alignment: o.alignment || ctr, border: o.border || B, fill: o.fill, numFmt: o.numFmt });
      put("B1", { t: "s", v: "Общий итоги куб,кг (сумма куб,кг)", s: st({ font: { sz: 18, bold: true }, border: BM }) });
      for (let c = 2; c <= 9; c++) put(L(c) + "1", { t: "s", v: "", s: st({ border: BM }) });
      ["Код", "Место", "Куб", "Кг", "Сумма куб", "Сумма кг", "Сумма оплаты", "Кг в одном кубе", "Сумма карго"].forEach((t, i) => put(L(i + 1) + "2", { t: "s", v: t, s: st({ font: { sz: 18, bold: true } }) }));
      put("B3", { t: "s", v: "Итого:", s: st({ font: { sz: 18, bold: true }, alignment: { vertical: "center" } }) });
      const sumOf = k => totalRows.reduce((n, e) => n + (k === "cargo" ? N(e.sh.cargoUsd) : e.T[k] || 0), 0);
      [["C", "places"], ["D", "cube"], ["E", "kg"], ["F", "cubeAmount"], ["G", "kgAmount"], ["H", "price"], ["I", null], ["J", "cargo"]].forEach(([c, k]) => {
        const v = k ? sumOf(k) : 0, z = c === "J" ? '0"$"' : c === "C" ? "0" : "#,##0.0";
        put(c + "3", { t: "n", f: `SUBTOTAL(9,${c}5:${c}${last})`, v, z, s: st({ font: { bold: true, color: { rgb: "FF0000" } }, numFmt: z }) });
      });
      put("A4", { t: "s", v: "", s: st({ border: BM }) });
      for (let c = 1; c <= 9; c++) put(L(c) + "4", { t: "s", v: "", s: st({ border: BM, fill: fill("C0C0C0") }) });
      totalRows.forEach((e, i) => {
        const R = 5 + i, ref = `'${e.name.replace(/'/g, "''")}'!`;
        put("A" + R, { t: "n", v: i + 1, s: st({ font: { sz: 18 } }) });
        put("B" + R, { t: "s", f: ref + "B1", v: e.sh.code || "", s: st({ font: { bold: true } }) });
        [["C", "I7", e.T.places, "0"], ["D", "J7", e.T.cube, "#,##0.0"], ["E", "L7", e.T.kg, "#,##0.0"], ["F", "N7", e.T.cubeAmount, "#,##0.0"], ["G", "P7", e.T.kgAmount, "#,##0.0"], ["H", "Q7", e.T.price, "#,##0.0"], ["I", "R7", e.T.cube > 0 ? e.T.kg / e.T.cube : 0, "#,##0.0"], ["J", "Q5", N(e.sh.cargoUsd), '0"$"']]
          .forEach(([c, src, v, z]) => put(c + R, { t: "n", f: ref + src, v, z, s: st({ alignment: { horizontal: "right", vertical: "center" }, numFmt: z }) }));
      });
      ws["!ref"] = "A1:J" + last; ws["!merges"] = [X.utils.decode_range("B1:J1")];
      ws["!cols"] = [9.14, 19.14, 14.14, 14, 14, 14, 14, 16, 16, 14].map(w => ({ wch: w }));
      ws["!rows"] = [{ hpt: 45.75 }, { hpt: 67.5 }, { hpt: 28.5 }, { hpt: 30 }, ...totalRows.map(() => ({ hpt: 22.5 }))];
      X.utils.book_append_sheet(wb, ws, HN.safeSheetName(TOTAL_NAME, names));
    }
    const file = sheets.length === 1 ? `HOJI-NAIM-${sheets[0].name}-${HN.today()}.xlsx` : `HOJI-NAIM-Дафтар-${HN.today()}.xlsx`;
    X.writeFile(wb, file.replace(/[\\/?*[\]:]/g, "-"), { compression: true, cellStyles: true });
    setStatus("Файл омода шуд: " + file);
  }

  HN.notebook = {
    render,
    // Open the sheet of a customer (by customer key). Creates one with that code if missing.
    select(key) {
      if (!book) book = loadBook();
      const c = HN.customers().find(x => x.key === key);
      const code = (c?.code || "").toLocaleLowerCase();
      let sh = code ? book.sheets.find(s => String(s.code || "").trim().toLocaleLowerCase() === code) : null;
      if (!sh && c?.code) { sh = blankSheet(0, { name: nextName(), code: c.code, phone: c.phone || "" }); if (!validName(c.code, sh.id)) sh.name = c.code; book.sheets.push(sh); save(sh); }
      if (sh) { book.active = sh.id; selected = null; save(); }
      else if (c) setTimeout(() => HN.toast("Ин муштарӣ код надорад. Варақи нав созед ва дар «Код» коди ӯро нависед."), 300);
      if (!HN.$("rtab-notebook")?.classList.contains("hidden")) render();
    },
  };
})();
