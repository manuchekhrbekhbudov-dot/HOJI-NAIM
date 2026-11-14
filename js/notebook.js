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
  const MIN_ROWS = 30;       // empty template rows always shown
  const N = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, "").slice(0, 8);

  // Excel-like number display: "1 250,00" (comma decimals as in the company's Excel).
  const xf = (v, d = 2) => { const s = HN.fmt(v, d).replace("−", "-"); return d ? s.replace(/\.(\d+)$/, ",$1") : s; };

  /* ---------- Template columns ---------- */
  // key, header, kind (in = input, f = formula), width px
  const COLS = [
    ["no", "п/н", "f", 38], ["date", "Дата", "in", 92], ["shop", "магазин", "in", 80], ["city", "город", "in", 72],
    ["item", "Наим-ие товара", "in", 104], ["height", "высота", "in", 58], ["width", "ширина", "in", 58], ["length", "длина", "in", 58],
    ["places", "место", "in", 52], ["cube", "Общий объем, куб", "f", 76], ["kgPerPlace", "кг", "in", 52], ["kg", "Общий объем, кг", "f", 76],
    ["cubePrice", "цена куб", "in", 58], ["cubeAmount", "Сумма за куб", "f", 78], ["kgPrice", "цена кг", "in", 56], ["kgAmount", "Сумма за кг", "f", 78],
    ["price", "итоговая цена", "f", 84], ["density", "кг в одном кубе", "f", 70],
  ];
  const LETTER = Object.fromEntries(COLS.map(([k], i) => [k, String.fromCharCode(65 + i)]));
  const RED = new Set(["cube", "kg", "cubeAmount", "kgAmount"]);
  const TEXT = new Set(["date", "shop", "city", "item"]);
  const FORMULA = {
    no: r => `=IF(ISBLANK(F${r});"";COUNTA($F$${FIRST}:F${r}))`,
    cube: r => `=F${r}*G${r}*H${r}*I${r}`, kg: r => `=K${r}*I${r}`, cubeAmount: r => `=J${r}*M${r}`, kgAmount: r => `=L${r}*O${r}`,
    price: r => `=IF(N${r}>P${r};N${r};P${r})`, density: r => `=IF(J${r}>0;L${r}/J${r};"")`,
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
    const remote = (r.data || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (!remote.length) { book.sheets.forEach(sh => dirty.add(sh.id)); flushRemote(); return; } // first upload
    const local = new Map(book.sheets.map(s => [s.id, s]));
    book.sheets = remote.map(x => { const id = x.customer_key.slice(6); return { ...(local.get(id) || {}), id, name: x.sheet_name, code: x.client_code || "", phone: x.phone || "", rows: Array.isArray(x.data?.rows) ? x.data.rows : [] }; });
    const before = book.sheets.length; topUp(book); book.sheets.slice(before).forEach(x => dirty.add(x.id)); if (dirty.size) flushRemote();
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

  /* ---------- Rendering ---------- */
  const root = () => HN.$("notebook");
  const activeSheet = () => book.sheets.find(s => s.id === book.active) || book.sheets[0];
  let selected = null, ready = false;

  async function render() {
    const el = root(); if (!el || !S.user) return;
    if (!book) book = loadBook();
    if (!ready) { ready = true; await loadRemote(); }
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
            <button class="xl-btn xl-btn-lg" data-xl="sync"><svg><use href="#i-refresh"/></svg><span>Сабт дар система</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="del-row"><svg><use href="#i-trash"/></svg><span>Нест кардани сатр</span></button></div>
          </div><span class="xl-group-label">Сатрҳо</span></div>
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="add-sheet"><svg><use href="#i-sheet"/></svg><span>Варақи нав</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="rename"><svg><use href="#i-edit"/></svg><span>Номи варақ</span></button>
            <button class="xl-btn" data-xl="remove-sheet" ${book.sheets.length < 2 ? "disabled" : ""}><svg><use href="#i-trash"/></svg><span>Нест кардани варақ</span></button></div>
          </div><span class="xl-group-label">Варақҳо</span></div>
          <div class="xl-group"><div class="xl-group-btns">
            <button class="xl-btn xl-btn-lg" data-xl="export-all"><svg><use href="#i-download"/></svg><span>Ҳамаи дафтар (.xlsx)</span></button>
            <div class="xl-stack"><button class="xl-btn" data-xl="export-sheet"><svg><use href="#i-download"/></svg><span>Ин варақ (.xlsx)</span></button></div>
          </div><span class="xl-group-label">Содирот</span></div>
        </div>
        <div class="xl-formula"><span class="xl-namebox" id="xlName">A${FIRST}</span><span class="xl-fxicons" aria-hidden="true"><i>✕</i><i>✓</i><em>fx</em></span><input id="xlFx" readonly aria-label="Сатри формула" value=""></div>
        <div class="xl-gridwrap" id="xlGridWrap">${grid(sh, ro)}</div>
        <div class="xl-tabsbar">
          <button class="xl-tabnav" data-xl="tabs-left" aria-label="Варақҳои пешина">◀</button><button class="xl-tabnav" data-xl="tabs-right" aria-label="Варақҳои баъдина">▶</button>
          <div class="xl-tabs" id="xlTabs" role="tablist" aria-label="Варақҳо">
            ${book.sheets.map(x => `<button class="xl-tab${x.id === sh.id ? " on" : ""}" data-sheet="${esc(x.id)}" role="tab" aria-selected="${x.id === sh.id}" title="${esc(x.code ? "Код: " + x.code : "Код нанавишта")} — барои иваз кардани ном ду бор пахш кунед">${esc(x.name)}</button>`).join("")}
          </div>
          <button class="xl-more" data-xl="all-sheets" title="Ҳамаи варақҳо" aria-label="Ҳамаи варақҳо">⋯</button>
          <button class="xl-addtab" data-xl="add-sheet" title="Варақи нав (Shift+F11)" aria-label="Варақи нав">+</button>
          <div class="xl-sheetmenu hidden" id="xlSheetMenu" role="menu">${book.sheets.map(x => `<button role="menuitem" data-sheet="${esc(x.id)}" class="${x.id === sh.id ? "on" : ""}">${esc(x.name)}${x.code ? ` <small>${esc(x.code)}</small>` : ""}</button>`).join("")}</div>
        </div>
        <div class="xl-status"><span id="xlStatus">Омода</span><span id="xlAgg"></span><span class="xl-sheetcount">${book.sheets.length} варақ</span><span class="xl-zoom" aria-hidden="true"><i class="xl-view on"></i><i class="xl-view v2"></i><i class="xl-view v3"></i><b>−</b><span class="xl-slider"><i></i></span><b>+</b>100%</span></div>
      </div>`;
    const tab = el.querySelector(".xl-tab.on"), bar = el.querySelector(".xl-tabs");
    if (tab && bar && (tab.offsetLeft < bar.scrollLeft || tab.offsetLeft + tab.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = tab.offsetLeft - 40;
    refresh();
    if (selected) selectCell(selected.r, selected.c, true);
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
    h += row(4, blanks(0, 10, 4) + td(4, 11, "", "xl-box") + `<td class="xl-c xl-box xl-center" colspan="2" data-r="4" data-c="12">Место</td><td class="xl-c xl-box xl-center" colspan="2" data-r="4" data-c="14">Юань</td><td class="xl-c xl-box xl-center" colspan="2" data-r="4" data-c="16">Доллар</td>`);
    h += row(5, blanks(0, 10, 5) + td(5, 11, "Карго", "xl-box") + `<td class="xl-c xl-box xl-num" colspan="2" data-r="5" data-c="12" data-t="places" data-f="=I7"></td><td class="xl-c xl-box xl-num" colspan="2" data-r="5" data-c="14" data-t="yuan" data-f="=Q7*I1/I2"></td><td class="xl-c xl-box xl-num" colspan="2" data-r="5" data-c="16" data-t="usd" data-f="=Q7"></td>`);
    const itogo = new Set(["places", "cube", "kg", "cubeAmount", "kgAmount", "price", "density"]);
    h += row(6, COLS.map(([k], c) => itogo.has(k) ? td(6, c, "Итого:", "xl-b xl-box xl-center") : td(6, c, "", "xl-box")).join(""), "xl-r6");
    h += row(7, COLS.map(([k], c) => itogo.has(k) && k !== "density" ? td(7, c, "", "xl-box xl-num", ` data-t="${k}" data-f="=SUM(${LETTER[k]}${FIRST}:${LETTER[k]}${last})"`) : td(7, c, "", "xl-box")).join(""), "xl-r7");
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
        cell.textContent = k === "no" ? (hasF ? n : "") : k === "density" ? (x.density === null ? "" : xf(x.density)) : xf(x[k]);
      });
    });
    g.querySelectorAll("[data-t]").forEach(cell => {
      const k = cell.dataset.t;
      cell.textContent = k === "places" ? xf(T.places, 0) : k === "usd" ? xf(T.price) : k === "yuan" ? xf(book.cnyRate > 0 ? (T.price * book.usdRate) / book.cnyRate : 0) : xf(T[k], 1);
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
    const tab = e.target.closest("[data-sheet]");
    if (tab && !tab.querySelector("input")) {
      const id = tab.dataset.sheet;
      if (id !== book.active) { book.active = id; selected = null; save(); await render(); }
      if (e.detail === 2) { const on = root().querySelector(".xl-tab.on"); if (on) startRename(on); }
      return;
    }
    const btn = e.target.closest("[data-xl]");
    if (btn) { action(btn.dataset.xl); return; }
    const cell = e.target.closest(".xl-c[data-r]");
    if (cell) selectCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  document.addEventListener("keydown", e => { if (e.shiftKey && e.key === "F11" && HN.$("notebook")?.offsetParent) { e.preventDefault(); action("add-sheet"); } });
  document.addEventListener("click", e => { const m = HN.$("xlSheetMenu"); if (m && !m.classList.contains("hidden") && !e.target.closest("#xlSheetMenu, [data-xl=all-sheets]")) m.classList.add("hidden"); });
  document.addEventListener("dblclick", e => {
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
      save(sh); refresh(); return;
    }
    const i = Number(input.dataset.row);
    while (sh.rows.length <= i) sh.rows.push({});
    sh.rows[i][input.dataset.key] = input.value;
    HN.$("xlFx").value = input.value;
    save(sh); refresh();
  });
  document.addEventListener("change", e => {
    const d = e.target.closest('#notebook input[data-key="date"]');
    if (d) { const iso = toISO(d.value); const sh = activeSheet(), i = Number(d.dataset.row); if (sh.rows[i]) { sh.rows[i].date = iso || d.value; save(sh); } if (iso) d.value = HN.fmtDate(iso); else if (d.value.trim()) HN.toast("Санаро ба шакли 07.11.2026 нависед.", "error"); return; }
    if (!e.target.closest('#notebook input[data-meta="code"]')) return;
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
    if (e.key === "Enter" || e.key === "ArrowDown") go(1);
    else if (e.key === "ArrowUp") go(-1);
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
      book.sheets.splice(book.sheets.indexOf(sh) + 1, 0, n); book.active = n.id; selected = null; save(n); await render();
      setStatus("Варақи «" + n.name + "» илова шуд"); return;
    }
    if (kind === "all-sheets") { HN.$("xlSheetMenu")?.classList.toggle("hidden"); return; }
    if (kind === "rename") { const t = root().querySelector(".xl-tab.on"); if (t) startRename(t); return; }
    if (kind === "remove-sheet") {
      if (book.sheets.length < 2) return;
      const filled = sh.rows.filter(used).length;
      if (!(await HN.confirm(`Варақи «${sh.name}»${filled ? ` (${filled} сатр)` : ""} нест карда шавад? Борҳое, ки аллакай дар система сабт шудаанд, нест намешаванд.`, { title: "Нест кардани варақ", ok: "Нест кардан", danger: true }))) return;
      book.sheets = book.sheets.filter(s => s.id !== sh.id); book.active = book.sheets[0].id; selected = null; save();
      if (S.features.sheetData) await S.db.from("customer_sheets").delete().eq("customer_key", "sheet:" + sh.id);
      await render(); return;
    }
    if (kind === "del-row") {
      const tr = root().querySelector(".xl-c.sel")?.closest("tr.xl-data");
      if (!tr) { HN.toast("Аввал ҳуҷайраеро дар сатр интихоб кунед."); return; }
      if (tr.classList.contains("xl-datarow")) { HN.toast("Ин сатр аз база аст. Борро дар қисми «Борҳо» таҳрир ё нест кунед."); return; }
      const li = Number(tr.dataset.i) - dbRows(sh).length, r = sh.rows[li];
      if (!r) return;
      if (used(r) && !(await HN.confirm(`Сатри ${FIRST + Number(tr.dataset.i)} нест карда шавад?${r.syncTrackingNo ? " Бори аллакай дар система сабтшуда нест намешавад." : ""}`, { ok: "Нест кардан", danger: true }))) return;
      sh.rows.splice(li, 1); save(sh); await render(); return;
    }
    if (kind === "sync") { await sync(sh); return; }
    if (kind === "export-sheet") { exportBook([sh]); return; }
    if (kind === "export-all") exportBook(book.sheets);
  }

  /* ---------- Save rows into the system as shipments ---------- */
  async function sync(sh) {
    if (!HN.can("staff")) { HN.toast("Барои сабт дар система иҷозати корманд лозим аст."); return; }
    const code = String(sh.code || "").trim(), phone = String(sh.phone || "").trim();
    if (!code) { HN.toast("Дар ҳуҷайраи «Код» (B1) коди муштариро нависед.", "error"); root().querySelector('input[data-meta="code"]')?.focus(); return; }
    const rows = sh.rows.filter(used);
    if (!rows.length) { HN.toast("Дар варақ ҳоло сатри пуршуда нест."); return; }
    const bad = rows.find(r => calc(r).price <= 0);
    if (bad) { HN.toast(`Сатри ${FIRST + dbRows(sh).length + sh.rows.indexOf(bad)}: место, андоза ё кг пур нашудааст — нарх 0 аст.`, "error"); return; }
    const rate = N(book.usdRate);
    if (rate <= 0) { HN.toast("Курси долларро (I1) дуруст нависед.", "error"); return; }
    if (!(await HN.confirm(`${rows.length} сатри варақи «${sh.name}» (Код: ${code}) ба система сабт шавад? Сатрҳои аллакай сабтшуда нав карда мешаванд, такрор намешаванд.`, { ok: "Сабт дар система" }))) return;
    setStatus("Сабт шуда истодааст…");
    let done = 0;
    try {
      for (const r of rows) {
        const x = calc(r);
        if (!r.syncTrackingNo) { const d = (toISO(r.date) || HN.today()).replace(/-/g, ""); r.syncTrackingNo = "SHEET-" + d + "-" + (code.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "CLIENT") + "-" + uid().toUpperCase(); save(sh); }
        const existing = S.shipments.find(s => s.tracking_no === r.syncTrackingNo);
        const parts = { "Коди муштарӣ": code, "Телефон": phone, "Ҷойҳо": x.places, "Кг барои ҷой": N(r.kgPerPlace), "Нархи куб": x.cubePrice, "Сумма куб": x.cubeAmount.toFixed(2), "Нархи кг": x.kgPrice, "Сумма кг": x.kgAmount.toFixed(2), "Шаҳр": r.city || "", "Мол": r.item || "", "Андоза": N(r.height) && N(r.width) && N(r.length) ? `${r.height} × ${r.width} × ${r.length} м` : "", "Мағоза": r.shop || "" };
        const notes = HN.buildNotes(existing ? existing.notes : "Дафтари Excel", parts, existing ? undefined : "");
        const tjs = HN.round2(x.price * rate);
        if (existing && tjs < HN.paid(existing) - 0.005) throw new Error(`бори ${r.syncTrackingNo}: ҳисоби нав аз пардохтшуда кам аст`);
        const payload = { client_phone: phone, tracking_no: r.syncTrackingNo, shipment_date: toISO(r.date) || HN.today(), billing_type: x.billingType, weight_kg: x.kg, volume_m3: Math.round(x.cube * 10000) / 10000, currency: "USD", unit_price: x.billingType === "kg" ? x.kgPrice : x.cubePrice, fx_rate: rate, total_original: HN.round2(x.price), total_tjs: tjs, notes };
        if (!existing) Object.assign(payload, { client_name: code, created_by: S.user.id });
        const { error } = await S.db.from("shipments").upsert(payload, { onConflict: "tracking_no" });
        if (error) throw error;
        done++;
      }
      save(sh); await HN.reload();
      HN.toast(`Варақи «${sh.name}» ба система сабт шуд: ${done} бор.`, "ok");
    } catch (err) {
      console.error("Notebook sync", err); save(sh);
      HN.toast(`Сабт пас аз ${done} сатр қатъ шуд: ${HN.dbError(err)}`, "error"); setStatus("Хатои сабт");
    }
  }

  /* ---------- Real .xlsx in the company's template layout ---------- */
  async function exportBook(sheets) {
    let X;
    try { if (!window.XLSX?.utils) setStatus("Файли Excel омода мешавад…"); X = await HN.loadXlsx(); }
    catch { HN.toast("Китобхонаи Excel бор нашуд. Интернетро санҷед ва дубора кӯшиш кунед.", "error"); return; }
    const wb = X.utils.book_new(), names = new Set();
    const thin = { style: "thin", color: { rgb: "000000" } }, B = { top: thin, bottom: thin, left: thin, right: thin };
    const font = (o = {}) => ({ name: "Calibri", sz: 11, ...o });
    const ctr = { horizontal: "center", vertical: "center" };
    sheets.forEach(sh => {
      const all = [...dbRows(sh), ...sh.rows.filter(used)];
      const total = Math.max(MIN_ROWS, all.length), last = FIRST + total - 1;
      const ws = {}, merges = [];
      const put = (ref, cell) => (ws[ref] = cell);
      const txt = (ref, v, s = {}) => put(ref, { t: "s", v, s: { font: font(s.font), alignment: s.alignment || { vertical: "center" }, border: s.border, fill: s.fill } });
      const merge = a => merges.push(X.utils.decode_range(a));
      txt("A1", "Код", { font: { bold: true }, border: B }); txt("B1", sh.code || "", { border: B }); ["C1", "D1", "E1", "F1"].forEach(r => txt(r, "", { border: B })); merge("B1:F1");
      txt("A2", "Тел", { font: { bold: true }, border: B }); txt("B2", sh.phone || "", { border: B }); ["C2", "D2", "E2", "F2"].forEach(r => txt(r, "", { border: B })); merge("B2:F2");
      txt("H1", "Курс $", { font: { bold: true }, alignment: { horizontal: "right" } }); put("I1", { t: "n", v: N(book.usdRate), z: "0.0000", s: { font: font(), border: B, numFmt: "0.0000" } });
      txt("H2", "Курс ¥", { font: { bold: true }, alignment: { horizontal: "right" } }); put("I2", { t: "n", v: N(book.cnyRate), z: "0.0000", s: { font: font(), border: B, numFmt: "0.0000" } });
      txt("L4", "", { border: B });
      [["M4", "N4", "Место"], ["O4", "P4", "Юань"], ["Q4", "R4", "Доллар"]].forEach(([a, b, t]) => { txt(a, t, { border: B, alignment: ctr }); txt(b, "", { border: B }); merge(a + ":" + b); });
      txt("L5", "Карго", { border: B });
      const T = all.reduce((t, r) => { const x = r.ro ? r.c : calc(r); t.places += x.places; t.price += x.price; return t; }, { places: 0, price: 0 });
      [["M5", "N5", "I7", T.places, "0"], ["O5", "P5", "IF(I2>0,Q7*I1/I2,0)", N(book.cnyRate) > 0 ? (T.price * N(book.usdRate)) / N(book.cnyRate) : 0, "#,##0.00"], ["Q5", "R5", "Q7", T.price, "#,##0.00"]]
        .forEach(([a, b, f, v, z]) => { put(a, { t: "n", f, v, z, s: { font: font(), border: B, numFmt: z, alignment: ctr } }); txt(b, "", { border: B }); merge(a + ":" + b); });
      COLS.forEach(([k, title], c) => {
        const L = String.fromCharCode(65 + c);
        const tot = ["places", "cube", "kg", "cubeAmount", "kgAmount", "price"].includes(k);
        txt(L + "6", tot || k === "density" ? "Итого:" : "", { font: { bold: true }, border: B, alignment: ctr });
        if (tot) { const v = all.reduce((n, r) => n + ((r.ro ? r.c : calc(r))[k] || 0), 0), z = k === "places" ? "0" : "#,##0.0"; put(L + "7", { t: "n", f: `SUM(${L}${FIRST}:${L}${last})`, v, z, s: { font: font(), border: B, numFmt: z, alignment: { horizontal: "right" } } }); }
        else txt(L + "7", "", { border: B });
        txt(L + "8", title, { font: { bold: true }, border: B, alignment: { horizontal: "center", vertical: "center", wrapText: true } });
      });
      for (let i = 0; i < total; i++) {
        const R = FIRST + i, r = all[i] || {}, x = r.ro ? r.c : calc(r);
        const fill = i % 2 ? { patternType: "solid", fgColor: { rgb: "DDEBF7" } } : undefined;
        COLS.forEach(([k, , kind], c) => {
          const ref = String.fromCharCode(65 + c) + R, base = { border: B, fill, alignment: { vertical: "center" } };
          if (kind === "f") {
            const f = FORMULA[k](R).slice(1).replace(/;/g, ",");
            const v = k === "no" ? (r.ro || String(r.height ?? "").trim() !== "" ? i + 1 : "") : k === "density" ? (x.density ?? "") : x[k];
            const z = k === "no" ? "0" : "#,##0.00";
            put(ref, { t: v === "" ? "s" : "n", v, f, z, s: { ...base, numFmt: z, font: font({ color: RED.has(k) ? { rgb: "FF0000" } : undefined, bold: k === "price" }), alignment: { horizontal: k === "no" ? "center" : "right", vertical: "center" } } });
            return;
          }
          let raw = r[k];
          if (raw === undefined || raw === null || raw === "") raw = k === "cubePrice" ? D.cubePrice : k === "kgPrice" ? D.kgPrice : "";
          if (k === "date" && toISO(raw)) { const d = HN.parseDate(toISO(raw)); put(ref, { t: "d", v: d, z: "dd.mm.yyyy", s: { ...base, font: font(), numFmt: "dd.mm.yyyy", alignment: ctr } }); }
          else if (TEXT.has(k) || raw === "") put(ref, { t: "s", v: String(raw), s: { ...base, font: font() } });
          else put(ref, { t: "n", v: N(raw), s: { ...base, font: font(), alignment: { horizontal: "right", vertical: "center" } } });
        });
      }
      ws["!ref"] = "A1:R" + last; ws["!merges"] = merges;
      ws["!cols"] = [5, 11, 11, 10, 15, 8, 8, 8, 8, 11, 7, 11, 9, 10, 8, 10, 11, 9].map(w => ({ wch: w }));
      ws["!rows"] = Array.from({ length: last }, (_, i) => (i === 7 ? { hpt: 48 } : i === 5 || i === 6 ? { hpt: 22 } : { hpt: 15.75 }));
      X.utils.book_append_sheet(wb, ws, HN.safeSheetName(sh.name, names));
    });
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
