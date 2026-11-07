/* HOJI-NAIM CARGO — core: state, formatting, data model and calculations.
   Everything here is shared by main.js, exporter.js and notebook.js through window.HN. */
(() => {
  "use strict";
  const HN = (window.HN = window.HN || {});

  // Public (publishable) Supabase key only. Never put the service_role key in the browser.
  HN.config = {
    supabaseUrl: "https://wfxbgkasstkxzmyrjwpi.supabase.co",
    supabaseKey: "sb_publishable_RHfMgPtLrfPEJzqvBwk5Vg_ksk-iBr2",
    defaults: { usdRate: 9.2361, cnyRate: 1.3803, kgPrice: 1, cubePrice: 200 },
  };

  HN.state = {
    db: null, user: null, profile: null,
    shipments: [], payments: [], expenses: [], sheets: [],
    features: { warehouse: true, audit: false, sheets: false },
    paidIndex: new Map(), paymentsIndex: new Map(),
  };

  /* ---------- DOM & text helpers ---------- */
  HN.$ = id => document.getElementById(id);
  HN.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  HN.num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // 1250.5 -> "1 250.50" (space thousands, dot decimals — same in every browser locale).
  HN.fmt = (v, d = 2) => {
    const n = HN.num(v), neg = n < 0;
    const [i, f] = Math.abs(n).toFixed(d).split(".");
    return (neg ? "−" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (d ? "." + f : "");
  };
  HN.fmtQty = (v, d = 2) => { const s = HN.fmt(v, d); return d ? s.replace(/\.?0+$/, "") || "0" : s; };
  HN.money = v => HN.fmt(v, 2);

  /* ---------- Dates (local time, not UTC) ---------- */
  HN.isoDate = (d = new Date()) => {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  };
  HN.today = () => HN.isoDate(new Date());
  HN.parseDate = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return y ? new Date(y, (m || 1) - 1, d || 1) : null; };
  HN.addDays = (s, n) => { const d = HN.parseDate(s); d.setDate(d.getDate() + n); return HN.isoDate(d); };
  HN.weekStart = s => { const d = HN.parseDate(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return HN.isoDate(d); };
  HN.monthStart = s => String(s).slice(0, 7) + "-01";
  HN.MONTHS = ["Январ", "Феврал", "Март", "Апрел", "Май", "Июн", "Июл", "Август", "Сентябр", "Октябр", "Ноябр", "Декабр"];
  HN.fmtDate = s => { if (!s) return "—"; const v = String(s).slice(0, 10).split("-"); return v.length === 3 ? v[2] + "." + v[1] + "." + v[0] : String(s); };
  HN.fmtDateTime = s => { if (!s) return "—"; const d = new Date(s); return HN.fmtDate(HN.isoDate(d)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  HN.shipmentDate = s => String(s.shipment_date || s.created_at || "").slice(0, 10);
  HN.inRange = (date, from, to) => !!date && (!from || date >= from) && (!to || date <= to);

  /* ---------- Shipment notes: structured "Калид: қимат" parts ----------
     The live table has no columns for client code, places or dimensions, so (as before)
     they are kept inside `notes`. Unknown parts are preserved untouched. */
  const FREE_KEY = "Ёддошт";
  HN.parseNotes = notes => {
    const text = String(notes || "");
    const out = { parts: [], free: "" };
    const freeAt = text.indexOf(FREE_KEY + ":");
    const head = freeAt >= 0 ? text.slice(0, freeAt) : text;
    if (freeAt >= 0) out.free = text.slice(freeAt + FREE_KEY.length + 1).trim();
    head.split(";").map(x => x.trim()).filter(Boolean).forEach(p => {
      const i = p.indexOf(":");
      if (i > 0) out.parts.push([p.slice(0, i).trim(), p.slice(i + 1).trim()]);
      else out.parts.push([p, null]);
    });
    // Old shipments had plain notes without any "key:" — treat them as free text.
    if (freeAt < 0 && out.parts.length && out.parts.every(([, v]) => v === null) && !/^Дафтари Excel$/i.test(out.parts[0][0])) {
      out.free = text.trim(); out.parts = [];
    }
    return out;
  };
  HN.noteValue = (s, key) => {
    const p = HN.parseNotes(s.notes).parts.find(([k]) => k.toLocaleLowerCase() === key.toLocaleLowerCase());
    return p ? p[1] : null;
  };
  HN.noteNumber = (s, key) => { const v = HN.noteValue(s, key); if (v === null || v === "") return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
  HN.buildNotes = (previous, updates, free) => {
    const parsed = HN.parseNotes(previous);
    const parts = parsed.parts.slice();
    Object.entries(updates).forEach(([k, v]) => {
      const i = parts.findIndex(([pk]) => pk.toLocaleLowerCase() === k.toLocaleLowerCase());
      const empty = v === null || v === undefined || v === "";
      if (empty) { if (i >= 0) parts.splice(i, 1); return; }
      if (i >= 0) parts[i] = [k, String(v)]; else parts.push([k, String(v)]);
    });
    const body = parts.map(([k, v]) => (v === null ? k : k + ": " + v)).join("; ");
    const f = (free ?? parsed.free ?? "").trim();
    return [body, f ? FREE_KEY + ": " + f : ""].filter(Boolean).join("; ");
  };
  HN.freeNotes = s => HN.parseNotes(s.notes).free;

  /* ---------- Customers ---------- */
  HN.customerCode = s => String(s.client_code || HN.noteValue(s, "Коди муштарӣ") || "").trim();
  HN.places = s => { const n = HN.noteNumber(s, "Ҷойҳо"); return n === null ? 1 : n; };
  // Same key format as the previous version, so saved sheet names keep working.
  HN.customerKey = s => {
    const code = HN.customerCode(s), phone = String(s.client_phone || "").trim(), name = String(s.client_name || "").trim();
    return code ? "code:" + code.toLocaleLowerCase() : phone ? "phone:" + phone.toLocaleLowerCase() : "name:" + (name || "Муштарӣ").toLocaleLowerCase();
  };
  HN.digits = s => String(s || "").replace(/\D/g, "");

  /* ---------- Money ---------- */
  HN.total = s => HN.num(s.total_tjs);
  HN.paid = s => HN.state.paidIndex.get(String(s.id)) || 0;
  HN.debt = s => Math.max(0, HN.total(s) - HN.paid(s));
  HN.payStatus = s => (HN.debt(s) <= 0.005 ? "paid" : HN.paid(s) > 0 ? "partial" : "unpaid");
  HN.payStatusText = { paid: "Пардохт шуд", partial: "Қисман", unpaid: "Қарздор" };
  HN.whStatus = s => s.warehouse_status || "unknown";
  HN.whStatusText = { in_warehouse: "Дар анбор", delivered: "Супурда шуд", unknown: "Номуайян" };
  HN.methodText = { cash: "Нақд", online: "Онлайн", bank_transfer: "Интиқоли бонкӣ", other: "Дигар" };

  // Same rule as the Excel workbook: bill whichever is larger — weight × $/kg or volume × $/m³.
  HN.charge = ({ weight, volume, kgPrice, cubePrice, rate }) => {
    const kgAmount = HN.num(weight) * HN.num(kgPrice);
    const cubeAmount = HN.num(volume) * HN.num(cubePrice);
    const type = cubeAmount > kgAmount ? "cube" : "kg";
    const usd = Math.max(kgAmount, cubeAmount);
    return { kgAmount, cubeAmount, type, unitPrice: type === "kg" ? HN.num(kgPrice) : HN.num(cubePrice), usd: round2(usd), tjs: round2(usd * HN.num(rate)), density: HN.num(volume) > 0 ? HN.num(weight) / HN.num(volume) : 0 };
  };
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  HN.round2 = round2;

  /* ---------- Indexes & groupings ---------- */
  HN.reindex = () => {
    const paid = new Map(), list = new Map();
    HN.state.payments.forEach(p => {
      const k = String(p.shipment_id);
      paid.set(k, (paid.get(k) || 0) + HN.num(p.amount_tjs));
      if (!list.has(k)) list.set(k, []);
      list.get(k).push(p);
    });
    HN.state.paidIndex = paid; HN.state.paymentsIndex = list;
    HN.state.shipmentById = new Map(HN.state.shipments.map(s => [String(s.id), s]));
  };
  HN.shipmentById = id => HN.state.shipmentById?.get(String(id)) || null;

  HN.customers = () => {
    const groups = new Map();
    const ordered = HN.state.shipments.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    ordered.forEach(s => {
      const key = HN.customerKey(s);
      if (!groups.has(key)) groups.set(key, { key, code: "", name: "", phone: "", shipments: [], places: 0, kg: 0, cube: 0, billed: 0, paid: 0, debt: 0, first: s.created_at || "" });
      const g = groups.get(key);
      const code = HN.customerCode(s), name = String(s.client_name || "").trim(), phone = String(s.client_phone || "").trim();
      if (code) g.code = code; if (name) g.name = name; if (phone) g.phone = phone;
      g.shipments.push(s); g.places += HN.places(s); g.kg += HN.num(s.weight_kg); g.cube += HN.num(s.volume_m3);
      g.billed += HN.total(s); g.paid += HN.paid(s); g.debt += HN.debt(s);
    });
    groups.forEach(g => { if (!g.name) g.name = g.code || g.phone || "Муштарӣ"; g.shipments.sort((a, b) => HN.shipmentDate(b).localeCompare(HN.shipmentDate(a))); });
    return [...groups.values()];
  };

  HN.matches = (s, q) => {
    if (!q) return true;
    const query = q.toLocaleLowerCase();
    // Phone search ignores spaces/dashes, but only when the query itself looks like a phone number.
    const phoneQuery = /^[\d\s+()-]+$/.test(q) ? HN.digits(q) : "";
    return [HN.customerCode(s), s.client_name, s.tracking_no].some(v => String(v || "").toLocaleLowerCase().includes(query)) ||
      String(s.client_phone || "").toLocaleLowerCase().includes(query) || (phoneQuery.length >= 3 && HN.digits(s.client_phone).includes(phoneQuery));
  };

  /* ---------- Roles ---------- */
  HN.role = () => String(HN.state.profile?.role || "").toLowerCase();
  HN.can = action => {
    const r = HN.role();
    const rules = {
      admin: ["owner", "admin"],
      delete: ["owner", "admin"],
      finance: ["owner", "admin", "accountant"],
      editShipment: ["owner", "admin", "accountant"],
      staff: ["owner", "admin", "accountant", "operator"],
    };
    return (rules[action] || []).includes(r);
  };
  HN.roleText = { owner: "Соҳиб", admin: "Админ", accountant: "Муҳосиб", operator: "Оператор", customer: "Муштарӣ" };

  /* ---------- UI primitives ---------- */
  let toastTimer;
  HN.toast = (text, kind = "info") => {
    const t = HN.$("toast"); if (!t) return;
    t.textContent = text; t.dataset.kind = kind; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3600);
  };
  // Promise-based confirmation dialog (replaces window.confirm).
  HN.confirm = (message, { title = "Тасдиқ", ok = "Тасдиқ", danger = false } = {}) => new Promise(resolve => {
    const dlg = HN.$("confirmDialog");
    HN.$("confirmTitle").textContent = title;
    HN.$("confirmText").textContent = message;
    const okBtn = HN.$("confirmOk");
    okBtn.textContent = ok; okBtn.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    const done = v => { dlg.close(); okBtn.onclick = null; HN.$("confirmCancel").onclick = null; resolve(v); };
    okBtn.onclick = () => done(true);
    HN.$("confirmCancel").onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
  HN.isMissingTable = err => !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "42703" || /does not exist|could not find/i.test(err.message || ""));
  HN.dbError = err => {
    const m = String(err?.message || "хатои номаълум");
    if (err?.code === "23505") return "Ин рақами бор аллакай вуҷуд дорад. Рақами дигар нависед.";
    if (/has payments/i.test(m)) return "Ин бор пардохт дорад. Барои нест кардани бор бо пардохтҳояш дар Supabase → SQL Editor файли supabase/admin_delete_shipment.sql-ро иҷро кунед (як бор).";
    if (err?.code === "42501" || /row-level security|permission/i.test(m)) return "Барои ин амал иҷозат надоред.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Пайваст бо интернет ё база нест. Дубора кӯшиш кунед.";
    return m;
  };
  HN.lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };
  HN.lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
})();
