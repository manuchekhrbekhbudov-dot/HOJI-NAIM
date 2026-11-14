/* HOJI-NAIM CARGO — real .xlsx export (xlsx-js-style), styled tables with live SUM formulas. */
(() => {
  "use strict";
  const HN = window.HN;

  const THEMES = {
    corporate: { title: "1F3864", titleText: "FFFFFF", head: "1F3864", headText: "FFFFFF", band: "F4F6FA", total: "F4B400", totalText: "1F3864", line: "D6DCE4" },
    excel: { title: "217346", titleText: "FFFFFF", head: "E2EFDA", headText: "1E4620", band: "F7FBF5", total: "C6E0B4", totalText: "1E4620", line: "BFBFBF" },
  };
  const FMT = { money: "#,##0.00", num: "#,##0.00", qty: "#,##0.###", int: "0", date: "dd.mm.yyyy", text: "@" };

  HN.safeSheetName = (name, used) => {
    let base = String(name || "Варақ").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Варақ";
    let n = base, i = 2;
    while (used && used.has(n.toLowerCase())) { const suffix = " (" + i++ + ")"; n = base.slice(0, 31 - suffix.length) + suffix; }
    if (used) used.add(n.toLowerCase());
    return n;
  };

  const colLetter = c => { let s = ""; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

  /* sheet spec: { name, title, subtitle, columns:[{header,value:(row)=>any,type,width,total,f:(excelRow)=>formula}], rows, theme, totalLabel } */
  function buildSheet(X, spec) {
    const th = THEMES[spec.theme || "corporate"];
    const cols = spec.columns, n = cols.length;
    const border = { top: { style: "thin", color: { rgb: th.line } }, bottom: { style: "thin", color: { rgb: th.line } }, left: { style: "thin", color: { rgb: th.line } }, right: { style: "thin", color: { rgb: th.line } } };
    const ws = {};
    const merges = [];
    let r = 0;
    const put = (R, C, cell) => { ws[X.utils.encode_cell({ r: R, c: C })] = cell; };
    const font = (o = {}) => ({ name: "Calibri", sz: 11, ...o });

    // Title band
    put(r, 0, { v: spec.title || "HOJI-NAIM CARGO", t: "s", s: { font: font({ sz: 16, bold: true, color: { rgb: th.titleText } }), fill: { patternType: "solid", fgColor: { rgb: th.title } }, alignment: { horizontal: "left", vertical: "center", indent: 1 } } });
    for (let c = 1; c < n; c++) put(r, c, { v: "", t: "s", s: { fill: { patternType: "solid", fgColor: { rgb: th.title } } } });
    merges.push({ s: { r, c: 0 }, e: { r, c: n - 1 } }); r++;
    put(r, 0, { v: spec.subtitle || ("Сана: " + HN.fmtDate(HN.today())), t: "s", s: { font: font({ sz: 10, italic: true, color: { rgb: "595959" } }), alignment: { horizontal: "left", indent: 1 } } });
    merges.push({ s: { r, c: 0 }, e: { r, c: n - 1 } }); r++;
    r++; // spacer
    const headRow = r;
    cols.forEach((c, i) => put(r, i, { v: c.header, t: "s", s: { font: font({ bold: true, color: { rgb: th.headText } }), fill: { patternType: "solid", fgColor: { rgb: th.head } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border } }));
    r++;
    const first = r;
    spec.rows.forEach((row, ri) => {
      cols.forEach((c, i) => {
        let v = c.value(row, ri);
        const type = c.type || "text";
        const s = { font: font(), border, alignment: { vertical: "center", horizontal: type === "text" ? "left" : "right", wrapText: type === "text" }, fill: { patternType: "solid", fgColor: { rgb: ri % 2 ? th.band : "FFFFFF" } } };
        let cell;
        if (v === null || v === undefined || v === "") cell = { v: "", t: "s", s };
        else if (type === "date") { const d = HN.parseDate(v); cell = d ? { v: d, t: "d", z: FMT.date, s: { ...s, numFmt: FMT.date, alignment: { ...s.alignment, horizontal: "center" } } } : { v: String(v), t: "s", s }; }
        else if (type === "text") cell = { v: String(v), t: "s", s };
        else { cell = { v: HN.num(v), t: "n", z: FMT[type], s: { ...s, numFmt: FMT[type] } }; if (c.red && HN.num(v) > 0.005) cell.s.font = font({ bold: true, color: { rgb: "C00000" } }); }
        if (c.f) { cell = { ...cell, f: c.f(r + 1), t: "n", v: HN.num(v) }; }
        put(r, i, cell);
      });
      r++;
    });
    const last = r - 1;
    if (spec.totals !== false) {
      cols.forEach((c, i) => {
        const s = { font: font({ bold: true, color: { rgb: th.totalText } }), fill: { patternType: "solid", fgColor: { rgb: th.total } }, border, alignment: { horizontal: i === 0 ? "left" : "right", vertical: "center" } };
        if (i === 0) put(r, i, { v: spec.totalLabel || "ҶАМЪ", t: "s", s });
        else if (c.total && spec.rows.length) {
          const L = colLetter(i), sum = spec.rows.reduce((a, row, ri) => a + HN.num(c.value(row, ri)), 0);
          put(r, i, { f: `SUM(${L}${first + 1}:${L}${last + 1})`, v: sum, t: "n", z: FMT[c.type] || FMT.num, s: { ...s, numFmt: FMT[c.type] || FMT.num } });
        } else if (c.total) put(r, i, { v: 0, t: "n", s: { ...s, numFmt: FMT[c.type] || FMT.num } });
        else put(r, i, { v: "", t: "s", s });
      });
      r++;
    }
    ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, headRow), c: n - 1 } });
    ws["!merges"] = merges;
    ws["!cols"] = cols.map(c => ({ wch: c.width || 14 }));
    ws["!rows"] = [{ hpt: 30 }, { hpt: 18 }, { hpt: 8 }, { hpt: 34 }];
    if (spec.rows.length) ws["!autofilter"] = { ref: `A${headRow + 1}:${colLetter(n - 1)}${last + 1}` };
    ws["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    return ws;
  }

  HN.exportXlsx = async (filename, specs) => {
    let X;
    try { if (!window.XLSX?.utils) HN.toast("Файли Excel омода мешавад…"); X = await HN.loadXlsx(); }
    catch { HN.toast("Китобхонаи Excel бор нашуд. Интернетро санҷед ва дубора кӯшиш кунед.", "error"); return false; }
    const wb = X.utils.book_new();
    const used = new Set();
    specs.forEach(spec => X.utils.book_append_sheet(wb, buildSheet(X, spec), HN.safeSheetName(spec.name, used)));
    wb.Props = { Title: "HOJI-NAIM CARGO", Author: "HOJI-NAIM CARGO", CreatedDate: new Date() };
    X.writeFile(wb, filename.replace(/[\\/?*[\]:]/g, "-"), { compression: true, cellStyles: true });
    return true;
  };

  /* Reusable column sets */
  HN.cols = {
    shipments: () => [
      { header: "Сана", value: s => HN.shipmentDate(s), type: "date", width: 12 },
      { header: "Рақами бор", value: s => s.tracking_no, width: 18 },
      { header: "Коди муштарӣ", value: s => HN.customerCode(s), width: 13 },
      { header: "Муштарӣ", value: s => s.client_name, width: 22 },
      { header: "Телефон", value: s => s.client_phone, width: 17 },
      { header: "Ҷой", value: s => HN.places(s), type: "int", width: 7, total: true },
      { header: "Вазн (кг)", value: s => s.weight_kg, type: "qty", width: 11, total: true },
      { header: "Ҳаҷм (м³)", value: s => s.volume_m3, type: "qty", width: 11, total: true },
      { header: "Ҳисоб (TJS)", value: s => HN.total(s), type: "money", width: 14, total: true },
      { header: "Пардохт (TJS)", value: s => HN.paid(s), type: "money", width: 14, total: true },
      { header: "Қарз (TJS)", value: s => HN.debt(s), type: "money", width: 14, total: true, red: true },
      { header: "Пардохт", value: s => HN.payStatusText[HN.payStatus(s)], width: 13 },
      { header: "Анбор", value: s => HN.whStatusText[HN.whStatus(s)], width: 13 },
    ],
    payments: () => [
      { header: "Сана", value: p => p.payment_date, type: "date", width: 12 },
      { header: "Рақами бор", value: p => HN.shipmentById(p.shipment_id)?.tracking_no || "", width: 18 },
      { header: "Муштарӣ", value: p => HN.shipmentById(p.shipment_id)?.client_name || "", width: 22 },
      { header: "Маблағ", value: p => p.amount_original, type: "money", width: 12 },
      { header: "Асъор", value: p => p.currency, width: 8 },
      { header: "Қурб", value: p => p.fx_rate, type: "qty", width: 9 },
      { header: "Маблағ (TJS)", value: p => p.amount_tjs, type: "money", width: 14, total: true },
      { header: "Усул", value: p => HN.methodText[p.method] || p.method || "", width: 14 },
      { header: "Эзоҳ", value: p => p.notes, width: 28 },
    ],
    expenses: () => [
      { header: "Сана", value: e => e.expense_date, type: "date", width: 12 },
      { header: "Категория", value: e => e.category, width: 20 },
      { header: "Маблағ", value: e => e.amount_original, type: "money", width: 12 },
      { header: "Асъор", value: e => e.currency, width: 8 },
      { header: "Қурб", value: e => e.fx_rate, type: "qty", width: 9 },
      { header: "Маблағ (TJS)", value: e => e.amount_tjs, type: "money", width: 14, total: true },
      { header: "Шарҳ", value: e => e.description || e.notes, width: 32 },
    ],
    customers: () => [
      { header: "Коди муштарӣ", value: c => c.code, width: 13 },
      { header: "Муштарӣ", value: c => c.name, width: 24 },
      { header: "Телефон", value: c => c.phone, width: 17 },
      { header: "Борҳо", value: c => c.shipments.length, type: "int", width: 8, total: true },
      { header: "Ҷой", value: c => c.places, type: "int", width: 8, total: true },
      { header: "Вазн (кг)", value: c => c.kg, type: "qty", width: 12, total: true },
      { header: "Ҳаҷм (м³)", value: c => c.cube, type: "qty", width: 12, total: true },
      { header: "Ҳисоб (TJS)", value: c => c.billed, type: "money", width: 14, total: true },
      { header: "Пардохт (TJS)", value: c => c.paid, type: "money", width: 14, total: true },
      { header: "Қарз (TJS)", value: c => c.debt, type: "money", width: 14, total: true, red: true },
    ],
  };
})();
