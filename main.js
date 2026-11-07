/* HOJI-NAIM CARGO — application: auth, navigation, views, forms and database actions.
   Database contract is unchanged: tables shipments / payments / expenses / profiles and the
   RPCs admin_delete_shipment, admin_set_profile_role, admin_delete_profile. */
(() => {
  "use strict";
  const HN = window.HN, S = HN.state, $ = HN.$, esc = HN.esc, fmt = HN.fmt, money = HN.money;
  const D = HN.config.defaults;
  const RATE_KEY = "hn-usd-rate";
  const usdRate = () => HN.num(HN.lsGet(RATE_KEY, D.usdRate)) || D.usdRate;
  const fxDefault = cur => (cur === "USD" ? usdRate() : cur === "CNY" ? D.cnyRate : 1);

  /* ================= Navigation ================= */
  const VIEWS = {
    dashboard: ["Асосӣ", "Ҷамъбасти кор"],
    shipments: ["Борҳо", "Сабт, таҳрир ва ҷустуҷӯи борҳо"],
    warehouse: ["Анбор", "Борҳои ҳозира ва супоридашуда"],
    payments: ["Пардохтҳо", "Пардохтҳои қисман ва пурра"],
    expenses: ["Хароҷот", "Хароҷоти ҳаррӯзаи ширкат", "finance"],
    reports: ["Ҳисобот", "Ҳисоботи давравӣ ва дафтари Excel"],
    admin: ["Админ-панел", "Кормандон, нусхаи эҳтиётӣ ва ҳолати система", "admin"],
  };
  let current = "dashboard";
  function viewFromHash() {
    let v = (location.hash || "").replace("#", "");
    if (v === "inventory") v = "warehouse";
    return VIEWS[v] ? v : "dashboard";
  }
  function showView(name) {
    if (!VIEWS[name]) name = "dashboard";
    const perm = VIEWS[name][2];
    if (perm && !HN.can(perm)) name = "dashboard";
    current = name;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
    document.querySelectorAll(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.view === name));
    $("pageTitle").textContent = VIEWS[name][0];
    $("pageSub").textContent = VIEWS[name][1];
    document.title = VIEWS[name][0] + " · HOJI-NAIM CARGO";
    document.body.classList.remove("nav-open");
    if (name === "admin" && !staffLoaded) loadStaff();
    renderView(name);
    $("views").scrollTop = 0; window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", () => showView(viewFromHash()));
  $("menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));
  HN.go = name => { if (location.hash === "#" + name) showView(name); else location.hash = name; };

  function applyPermissions() {
    document.querySelectorAll("[data-perm]").forEach(el => el.classList.toggle("perm-hidden", !HN.can(el.dataset.perm)));
  }

  /* ================= Auth ================= */
  let authMode = "signin";
  function showScreen(which) {
    $("boot").classList.add("hidden");
    $("authScreen").classList.toggle("hidden", which !== "auth");
    $("app").classList.toggle("hidden", which !== "app");
  }
  $("authModeToggle").addEventListener("click", () => {
    authMode = authMode === "signin" ? "signup" : "signin";
    const up = authMode === "signup";
    $("authHeading").textContent = up ? "Сохтани ҳисоб" : "Ворид шудан";
    $("authDescription").textContent = up ? "Email ва пароли нав ворид кунед. Пас аз тасдиқи Email админ ба шумо нақш медиҳад." : "Email ва пароли худро ворид кунед.";
    $("authSubmit").textContent = up ? "Сабти ном" : "Ворид шудан";
    $("password").autocomplete = up ? "new-password" : "current-password";
    $("authModeToggle").textContent = up ? "Ҳисоб доред? Ворид шудан" : "Ҳисоб надоред? Сабти ном";
    $("authMessage").textContent = "";
  });
  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!S.db) return;
    const email = $("email").value.trim(), password = $("password").value, msg = $("authMessage");
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Email-ро дуруст нависед."; return; }
    if (password.length < 8) { msg.textContent = "Парол бояд ҳадди ақал 8 аломат бошад."; return; }
    msg.dataset.kind = ""; msg.textContent = authMode === "signin" ? "Ворид шуда истодааст…" : "Ҳисоб сохта шуда истодааст…";
    $("authSubmit").disabled = true;
    try {
      const r = authMode === "signin" ? await S.db.auth.signInWithPassword({ email, password }) : await S.db.auth.signUp({ email, password });
      if (r.error) { msg.dataset.kind = "error"; msg.textContent = /invalid login/i.test(r.error.message) ? "Email ё парол нодуруст аст." : r.error.message; return; }
      if (authMode === "signup" && !r.data.session) { msg.dataset.kind = "ok"; msg.textContent = "Ҳисоб сохта шуд. Email-ро тасдиқ кунед, баъд ворид шавед."; return; }
      if (r.data.session) { msg.textContent = ""; await enterApp(r.data.session.user || r.data.user); }
    } catch (err) { msg.dataset.kind = "error"; msg.textContent = err.message || "Хатои номаълум."; }
    finally { $("authSubmit").disabled = false; }
  });
  $("logoutBtn").addEventListener("click", async () => {
    if (!(await HN.confirm("Аз система баромадан мехоҳед?", { ok: "Баромадан" }))) return;
    await S.db?.auth.signOut();
  });

  async function enterApp(user) {
    if (S.user && user && S.user.id === user.id && S.loadedOnce) return;
    S.user = user;
    showScreen("app");
    await loadData();
    if (!S.greeted) { S.greeted = true; HN.toast("Хуш омадед" + (S.profile?.full_name ? ", " + S.profile.full_name : "") + "!", "ok"); }
  }
  function leaveApp() {
    Object.assign(S, { user: null, profile: null, shipments: [], payments: [], expenses: [], sheets: [], loadedOnce: false, greeted: false });
    staffLoaded = false;
    showScreen("auth");
  }

  /* ================= Data ================= */
  async function fetchAll(table, order) {
    const all = [], size = 1000;
    for (let from = 0; ; from += size) {
      const r = await S.db.from(table).select("*").order(order, { ascending: false }).order("id", { ascending: true }).range(from, from + size - 1);
      if (r.error) throw r.error;
      all.push(...(r.data || []));
      if (!r.data || r.data.length < size) break;
    }
    return all;
  }
  let loading = null;
  function loadData() { if (!loading) loading = doLoad().finally(() => (loading = null)); return loading; }
  async function doLoad() {
    setConn("busy", "Маълумот бор шуда истодааст…");
    try {
      const prof = await S.db.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
      if (prof.error) console.warn("Profile read failed", prof.error);
      S.profile = prof.data || null;
      paintUser();
      if (!HN.can("staff")) { setConn("ok", "Пайваст шуд"); $("noAccess").classList.remove("hidden"); $("views").classList.add("hidden"); applyPermissions(); S.loadedOnce = true; return; }
      $("noAccess").classList.add("hidden"); $("views").classList.remove("hidden");
      const [shipments, payments, expenses] = await Promise.all([
        fetchAll("shipments", "created_at"),
        fetchAll("payments", "payment_date"),
        HN.can("finance") ? fetchAll("expenses", "expense_date") : Promise.resolve([]),
      ]);
      Object.assign(S, { shipments, payments, expenses });
      HN.reindex();
      if (!S.loadedOnce) await detectFeatures();
      else if (S.features.sheets) await loadSheets();
      S.loadedOnce = true;
      setConn("ok", "Пайваст шуд");
    } catch (err) {
      console.error(err);
      setConn("error", "Хатои база");
      HN.toast("Маълумот хонда нашуд: " + HN.dbError(err), "error");
      return;
    }
    applyPermissions();
    showView(viewFromHash());
  }
  HN.reload = loadData;
  async function detectFeatures() {
    const f = S.features;
    if (S.shipments.length) f.warehouse = Object.prototype.hasOwnProperty.call(S.shipments[0], "warehouse_status");
    else { const r = await S.db.from("shipments").select("warehouse_status").limit(1); f.warehouse = !r.error; }
    const a = await S.db.from("audit_log").select("id").limit(1);
    f.audit = !a.error;
    await loadSheets();
  }
  async function loadSheets() {
    const r = await S.db.from("customer_sheets").select("*").order("created_at", { ascending: true });
    S.features.sheets = !r.error;
    S.sheets = r.error ? [] : r.data || [];
    if (r.error && !HN.isMissingTable(r.error)) console.warn("customer_sheets", r.error);
  }
  function setConn(kind, text) { $("connDot").dataset.kind = kind; $("connectionStatus").textContent = text; }
  function paintUser() {
    const name = S.profile?.full_name || S.user?.email || "Корманд";
    $("userName").textContent = name;
    $("userAvatar").textContent = name.trim().charAt(0).toUpperCase() || "?";
    $("connectionStatus").title = HN.roleText[HN.role()] || "";
    $("userName").title = (HN.roleText[HN.role()] || "") + " · " + (S.user?.email || "");
  }
  $("reloadBtn").addEventListener("click", async () => { $("reloadBtn").classList.add("spin"); await loadData(); $("reloadBtn").classList.remove("spin"); HN.toast("Маълумот нав шуд."); });

  /* ================= Render ================= */
  function renderView(name) {
    const fn = { dashboard: renderDashboard, shipments: renderShipments, warehouse: renderWarehouse, payments: renderPayments, expenses: renderExpenses, reports: renderReports, admin: renderAdmin }[name];
    fn && fn();
    $("navWarehouseCount").textContent = S.features.warehouse ? (S.shipments.filter(s => HN.whStatus(s) === "in_warehouse").length || "") : "";
  }
  const rerender = () => renderView(current);
  const payPill = s => { const st = HN.payStatus(s); return `<span class="pill pay-${st}">${HN.payStatusText[st]}</span>`; };
  const whPill = s => { const st = HN.whStatus(s); return `<span class="pill wh-${st}">${HN.whStatusText[st]}</span>`; };
  const td = (v, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;
  const empty = (id, show) => $(id).classList.toggle("hidden", !show);

  function periodRange(p) {
    const t = HN.today();
    return { today: [t, t], week: [HN.weekStart(t), t], month: [HN.monthStart(t), t], year: [t.slice(0, 4) + "-01-01", t], all: [null, null] }[p] || [null, null];
  }

  /* ----- Dashboard ----- */
  let period = "month";
  $("periodSeg").addEventListener("click", e => { const b = e.target.closest("[data-period]"); if (!b) return; period = b.dataset.period; $("periodSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderDashboard(); });
  function renderDashboard() {
    const [from, to] = periodRange(period);
    const now = new Date();
    $("todayLabel").textContent = HN.fmtDate(HN.today()) + " · " + ["Якшанбе", "Душанбе", "Сешанбе", "Чоршанбе", "Панҷшанбе", "Ҷумъа", "Шанбе"][now.getDay()];
    const h = now.getHours();
    $("greeting").textContent = (h < 12 ? "Субҳ ба хайр" : h < 18 ? "Рӯз ба хайр" : "Шом ба хайр") + (S.profile?.full_name ? ", " + S.profile.full_name : "");
    const pays = S.payments.filter(p => HN.inRange(String(p.payment_date || "").slice(0, 10), from, to));
    const exps = S.expenses.filter(e => HN.inRange(String(e.expense_date || "").slice(0, 10), from, to));
    const ships = S.shipments.filter(s => HN.inRange(HN.shipmentDate(s), from, to));
    const income = pays.reduce((n, p) => n + HN.num(p.amount_tjs), 0), cost = exps.reduce((n, e) => n + HN.num(e.amount_tjs), 0);
    const debtors = HN.customers().filter(c => c.debt > 0.005).sort((a, b) => b.debt - a.debt);
    const totalDebt = debtors.reduce((n, c) => n + c.debt, 0);
    $("kIncome").textContent = money(income);
    $("kExpense").textContent = money(cost);
    $("kProfit").textContent = money(income - cost);
    $("kProfit").classList.toggle("neg", income - cost < 0);
    $("kDebt").textContent = money(totalDebt);
    $("kDebtCount").textContent = debtors.length + " муштарӣ қарздор";
    $("kShipments").textContent = ships.length;
    $("kShipmentsSub").textContent = fmt(ships.reduce((n, s) => n + HN.num(s.weight_kg), 0), 1) + " кг · " + fmt(ships.reduce((n, s) => n + HN.num(s.volume_m3), 0), 2) + " м³";
    $("kCustomers").textContent = HN.customers().length;
    const stock = S.shipments.filter(s => HN.whStatus(s) === "in_warehouse");
    $("kStock").textContent = S.features.warehouse ? stock.length : "—";
    $("kStockSub").textContent = S.features.warehouse ? fmt(stock.reduce((n, s) => n + HN.num(s.weight_kg), 0), 1) + " кг" : "SQL-и анбор лозим";
    $("kBilled").textContent = money(ships.reduce((n, s) => n + HN.total(s), 0));
    drawChart();
    const top = debtors.slice(0, 6), max = top[0]?.debt || 1;
    $("debtorList").innerHTML = top.map(c => `<li><button class="rank-row" data-sheet-key="${esc(c.key)}"><span class="rank-name"><b>${esc(c.name)}</b><small>${esc([c.code, c.phone].filter(Boolean).join(" · ") || "—")}</small></span><span class="rank-val">${money(c.debt)}</span><span class="rank-bar"><i style="width:${Math.max(4, (c.debt / max) * 100)}%"></i></span></button></li>`).join("");
    empty("debtorEmpty", !top.length);
    const recent = S.shipments.slice(0, 8);
    $("recentRows").innerHTML = recent.map(s => `<tr data-ship="${esc(s.id)}">${td(HN.fmtDate(HN.shipmentDate(s)), "nowrap")}${td(`<b>${esc(s.tracking_no || "—")}</b>`)}${td(esc(s.client_name || "—"))}${td(HN.fmtQty(s.weight_kg) + " кг / " + HN.fmtQty(s.volume_m3, 3) + " м³", "num nowrap")}${td(money(HN.total(s)), "num")}${td(money(HN.debt(s)), "num" + (HN.debt(s) > 0.005 ? " neg" : ""))}${td(payPill(s))}</tr>`).join("");
    empty("recentEmpty", !recent.length);
  }
  function drawChart() {
    const months = [];
    const d = new Date(); d.setDate(1);
    for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(HN.isoDate(x).slice(0, 7)); }
    const inc = months.map(m => S.payments.filter(p => String(p.payment_date || "").startsWith(m)).reduce((n, p) => n + HN.num(p.amount_tjs), 0));
    const exp = months.map(m => S.expenses.filter(e => String(e.expense_date || "").startsWith(m)).reduce((n, e) => n + HN.num(e.amount_tjs), 0));
    const fin = HN.can("finance");
    const max = Math.max(1, ...inc, ...(fin ? exp : []));
    const nice = niceMax(max), W = 640, H = 250, L = 56, B = 30, T = 14, cw = (W - L - 8) / 6, bw = fin ? cw * 0.28 : cw * 0.42;
    const y = v => T + (H - T - B) * (1 - v / nice);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Даромад ва хароҷот, 6 моҳи охир">`;
    for (let i = 0; i <= 4; i++) { const v = (nice / 4) * i, yy = y(v); svg += `<line class="grid" x1="${L}" x2="${W - 4}" y1="${yy}" y2="${yy}"/><text class="axis" x="${L - 8}" y="${yy + 4}" text-anchor="end">${shortNum(v)}</text>`; }
    months.forEach((m, i) => {
      const cx = L + cw * i + cw / 2;
      const bar = (v, x, cls) => { const yy = y(v), h = H - B - yy; return `<rect class="${cls}" x="${x}" y="${yy}" width="${bw}" height="${Math.max(0, h)}" rx="3"><title>${money(v)} TJS</title></rect>`; };
      svg += fin ? bar(inc[i], cx - bw - 2, "bar-income") + bar(exp[i], cx + 2, "bar-expense") : bar(inc[i], cx - bw / 2, "bar-income");
      svg += `<text class="axis" x="${cx}" y="${H - 10}" text-anchor="middle">${HN.MONTHS[+m.slice(5) - 1].slice(0, 3)}</text>`;
    });
    $("incomeChart").innerHTML = svg + "</svg>";
  }
  const niceMax = v => { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  const shortNum = v => (v >= 1e6 ? fmt(v / 1e6, 1) + "M" : v >= 1e3 ? fmt(v / 1e3, v >= 1e4 ? 0 : 1) + "k" : fmt(v, 0));

  /* ----- Shipments ----- */
  ["shipSearch", "shipFrom", "shipTo"].forEach(id => $(id).addEventListener("input", renderShipments));
  ["shipPay", "shipWh"].forEach(id => $(id).addEventListener("change", renderShipments));
  function filteredShipments() {
    const q = $("shipSearch").value.trim(), pay = $("shipPay").value, wh = $("shipWh").value, from = $("shipFrom").value, to = $("shipTo").value;
    return S.shipments.filter(s => HN.matches(s, q) && (!pay || HN.payStatus(s) === pay) && (!wh || HN.whStatus(s) === wh) && ((!from && !to) || HN.inRange(HN.shipmentDate(s), from, to)));
  }
  function renderShipments() {
    const list = filteredShipments();
    const canPay = HN.can("finance"), canEdit = HN.can("editShipment");
    $("shipRows").innerHTML = list.map(s => {
      const debt = HN.debt(s);
      const acts = [debt > 0.005 && canPay ? `<button class="btn btn-xs btn-soft" data-act="pay" data-id="${esc(s.id)}">Пардохт</button>` : "", canEdit ? `<button class="icon-btn sm" data-act="edit" data-id="${esc(s.id)}" title="Таҳрир" aria-label="Таҳрир"><svg><use href="#i-edit"/></svg></button>` : ""].join("");
      return `<tr data-ship="${esc(s.id)}">${td(HN.fmtDate(HN.shipmentDate(s)), "nowrap")}${td(`<b>${esc(s.tracking_no || "—")}</b>`, "nowrap")}${td(esc(HN.customerCode(s) || "—"), "code")}${td(esc(s.client_name || "—"))}${td(esc(s.client_phone || "—"), "nowrap")}${td(HN.places(s), "num")}${td(HN.fmtQty(s.weight_kg), "num")}${td(HN.fmtQty(s.volume_m3, 3), "num")}${td(money(HN.total(s)), "num")}${td(money(HN.paid(s)), "num")}${td(money(debt), "num" + (debt > 0.005 ? " neg" : ""))}${td(payPill(s))}${td(S.features.warehouse ? whPill(s) : "—")}<td class="acts">${acts}</td></tr>`;
    }).join("");
    empty("shipEmpty", !list.length);
    const sum = k => list.reduce((n, s) => n + k(s), 0);
    $("shipSummary").innerHTML = chips([["Борҳо", list.length], ["Ҷой", fmt(sum(HN.places), 0)], ["Вазн", fmt(sum(s => HN.num(s.weight_kg)), 1) + " кг"], ["Ҳаҷм", fmt(sum(s => HN.num(s.volume_m3)), 3) + " м³"], ["Ҳисоб", money(sum(HN.total)) + " TJS"], ["Қарз", money(sum(HN.debt)) + " TJS", "neg"]]);
  }
  const chips = arr => arr.map(([k, v, c]) => `<span class="chip${c ? " " + c : ""}"><small>${k}</small><b>${v}</b></span>`).join("");
  $("shipExport").addEventListener("click", () => {
    const list = filteredShipments();
    if (!list.length) { HN.toast("Барои содирот бор нест."); return; }
    HN.exportXlsx("HOJI-NAIM-Борҳо-" + HN.today() + ".xlsx", [{ name: "Борҳо", title: "HOJI-NAIM CARGO — Борҳо", subtitle: "Сана: " + HN.fmtDate(HN.today()) + " · " + list.length + " бор", columns: HN.cols.shipments(), rows: list }]);
  });

  /* ----- Warehouse ----- */
  let whTab = "in_warehouse";
  $("whTabs").addEventListener("click", e => { const b = e.target.closest("[data-wh]"); if (!b) return; whTab = b.dataset.wh; $("whTabs").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderWarehouse(); });
  $("whSearch").addEventListener("input", () => renderWarehouse());
  function renderWarehouse() {
    const by = st => S.shipments.filter(s => HN.whStatus(s) === st);
    const inS = by("in_warehouse");
    $("whCount").textContent = inS.length;
    $("whKg").textContent = fmt(inS.reduce((n, s) => n + HN.num(s.weight_kg), 0), 1);
    $("whM3").textContent = fmt(inS.reduce((n, s) => n + HN.num(s.volume_m3), 0), 3);
    $("whTabIn").textContent = inS.length; $("whTabOut").textContent = by("delivered").length; $("whTabUnknown").textContent = by("unknown").length;
    $("whHint").textContent = !S.features.warehouse ? "Ҳолати анбор дар база ҳанӯз нест. SQL-и supabase/migrations/20261019_warehouse_inventory.sql-ро иҷро кунед." :
      whTab === "unknown" ? "Борҳои пешина, ки ҳолаташон муайян нест. Онҳоро ба анбор гузоред ё ҳамчун супурдашуда қайд кунед." : "";
    const q = $("whSearch").value.trim();
    const list = by(whTab).filter(s => HN.matches(s, q));
    const can = HN.can("staff") && S.features.warehouse;
    const act = (s, to, label, cls) => `<button class="btn btn-xs ${cls}" data-act="wh" data-to="${to}" data-id="${esc(s.id)}">${label}</button>`;
    $("whRows").innerHTML = list.map(s => {
      const a = !can ? "" : whTab === "in_warehouse" ? act(s, "delivered", "Супоридан", "btn-primary") : whTab === "delivered" ? act(s, "in_warehouse", "Ба анбор баргардонидан", "btn-ghost") : act(s, "in_warehouse", "Ба анбор", "btn-primary") + act(s, "delivered", "Супурда шуд", "btn-ghost");
      const debt = HN.debt(s);
      return `<tr data-ship="${esc(s.id)}">${td(HN.fmtDate(HN.shipmentDate(s)), "nowrap")}${td(`<b>${esc(s.tracking_no || "—")}</b>`, "nowrap")}${td(esc(HN.customerCode(s) || "—"), "code")}${td(esc(s.client_name || "—"))}${td(esc(s.client_phone || "—"), "nowrap")}${td(HN.places(s), "num")}${td(HN.fmtQty(s.weight_kg), "num")}${td(HN.fmtQty(s.volume_m3, 3), "num")}${td(money(debt), "num" + (debt > 0.005 ? " neg" : ""))}${td(whPill(s))}<td class="acts">${a}</td></tr>`;
    }).join("");
    empty("whEmpty", !list.length);
  }
  async function setWarehouse(id, to) {
    const s = HN.shipmentById(id); if (!s) return;
    const debt = HN.debt(s), name = s.tracking_no || s.client_name;
    const ask = to === "delivered" && debt > 0.005
      ? [`Бори «${name}» ${money(debt)} TJS қарз дорад. Бо вуҷуди қарз ба муштарӣ супорида шавад?`, { title: "Бор қарз дорад", ok: "Ҳа, супоридан" }]
      : [`Бори «${name}» ${to === "delivered" ? "ҳамчун супурдашуда қайд карда" : "ба анбор гузошта"} шавад?`, { ok: "Тасдиқ" }];
    if (!(await HN.confirm(...ask))) return;
    const r = await S.db.from("shipments").update({ warehouse_status: to }).eq("id", s.id);
    if (r.error) { HN.toast("Ҳолати анбор нав нашуд: " + HN.dbError(r.error), "error"); return; }
    HN.toast(to === "delivered" ? "Бор супорида шуд." : "Бор ба анбор гузошта шуд.", "ok");
    await loadData(); if ($("detailDialog").open) openDetail(s.id);
  }

  /* ----- Payments ----- */
  ["paySearch", "payFrom", "payTo"].forEach(id => $(id).addEventListener("input", renderPayments));
  $("payMethod").addEventListener("change", renderPayments);
  function filteredPayments() {
    const q = $("paySearch").value.trim().toLocaleLowerCase(), m = $("payMethod").value, from = $("payFrom").value, to = $("payTo").value;
    return S.payments.filter(p => {
      const s = HN.shipmentById(p.shipment_id);
      const hit = !q || [s?.client_name, s?.tracking_no, HN.customerCode(s || {}), p.notes].some(v => String(v || "").toLocaleLowerCase().includes(q));
      return hit && (!m || p.method === m) && ((!from && !to) || HN.inRange(String(p.payment_date || "").slice(0, 10), from, to));
    });
  }
  function renderPayments() {
    const t = HN.today(), m = t.slice(0, 7);
    $("payToday").textContent = money(S.payments.filter(p => String(p.payment_date).slice(0, 10) === t).reduce((n, p) => n + HN.num(p.amount_tjs), 0));
    $("payMonth").textContent = money(S.payments.filter(p => String(p.payment_date).startsWith(m)).reduce((n, p) => n + HN.num(p.amount_tjs), 0));
    $("payDebt").textContent = money(S.shipments.reduce((n, s) => n + HN.debt(s), 0));
    const list = filteredPayments(), del = HN.can("delete");
    $("payRows").innerHTML = list.map(p => {
      const s = HN.shipmentById(p.shipment_id);
      return `<tr>${td(HN.fmtDate(p.payment_date), "nowrap")}${td(s ? `<button class="link-btn" data-open-ship="${esc(s.id)}">${esc(s.tracking_no)}</button>` : "—")}${td(esc(s?.client_name || "—"))}${td(money(p.amount_original) + " " + esc(p.currency || "TJS"), "num nowrap")}${td(`<b>${money(p.amount_tjs)}</b>`, "num")}${td(esc(HN.methodText[p.method] || p.method || "—"))}${td(esc(p.notes || ""), "muted")}<td class="acts">${del ? `<button class="icon-btn sm danger" data-act="del-pay" data-id="${esc(p.id)}" title="Нест кардан" aria-label="Нест кардан"><svg><use href="#i-trash"/></svg></button>` : ""}</td></tr>`;
    }).join("");
    empty("payEmpty", !list.length);
    $("paySummary").innerHTML = chips([["Пардохтҳо", list.length], ["Ҳамагӣ", money(list.reduce((n, p) => n + HN.num(p.amount_tjs), 0)) + " TJS"]]);
  }
  $("payExport").addEventListener("click", () => {
    const list = filteredPayments();
    if (!list.length) { HN.toast("Барои содирот пардохт нест."); return; }
    HN.exportXlsx("HOJI-NAIM-Пардохтҳо-" + HN.today() + ".xlsx", [{ name: "Пардохтҳо", title: "HOJI-NAIM CARGO — Пардохтҳо", columns: HN.cols.payments(), rows: list }]);
  });
  async function deletePayment(id) {
    const p = S.payments.find(x => String(x.id) === String(id)); if (!p) return;
    const s = HN.shipmentById(p.shipment_id);
    if (!(await HN.confirm(`Пардохти ${money(p.amount_tjs)} TJS (бор «${s?.tracking_no || "—"}») нест карда шавад? Қарзи бор ба ҳамин маблағ зиёд мешавад.`, { title: "Нест кардани пардохт", ok: "Нест кардан", danger: true }))) return;
    const r = await S.db.from("payments").delete().eq("id", p.id);
    if (r.error) { HN.toast("Пардохт нест нашуд: " + HN.dbError(r.error), "error"); return; }
    HN.toast("Пардохт нест карда шуд.", "ok"); await loadData();
  }

  /* ----- Payment form ----- */
  const payForm = $("paymentForm");
  let payPreselect = null;
  function openPayment(shipmentId) {
    if (!HN.can("finance")) { HN.toast("Барои сабти пардохт нақши муҳосиб ё админ лозим аст."); return; }
    const due = S.shipments.filter(s => HN.debt(s) > 0.005);
    if (!due.length) { HN.toast("Бори қарздор нест."); return; }
    payForm.reset(); $("paymentMsg").textContent = ""; $("payShipFilter").value = "";
    payPreselect = shipmentId && due.some(s => String(s.id) === String(shipmentId)) ? String(shipmentId) : null;
    fillPayOptions();
    payForm.elements.currency.value = "TJS"; payForm.elements.fx_rate.value = "1"; payForm.elements.method.value = "cash";
    payForm.elements.payment_date.value = HN.today();
    $("paymentDialog").showModal();
    payForm.elements.amount.focus();
  }
  function fillPayOptions() {
    const q = $("payShipFilter").value.trim();
    const sel = $("payShipment"), prev = sel.value || payPreselect;
    const due = S.shipments.filter(s => HN.debt(s) > 0.005 && (HN.matches(s, q) || String(s.id) === prev));
    sel.innerHTML = due.map(s => `<option value="${esc(s.id)}">${esc(s.tracking_no || "—")} — ${esc(s.client_name || "Муштарӣ")}${HN.customerCode(s) ? " (" + esc(HN.customerCode(s)) + ")" : ""} · қарз ${money(HN.debt(s))}</option>`).join("");
    if (prev && due.some(s => String(s.id) === prev)) sel.value = prev;
    updateDebtBox();
  }
  function updateDebtBox() {
    const s = HN.shipmentById($("payShipment").value);
    if (!s) { $("payDebtBox").innerHTML = '<span class="muted">Бор ёфт нашуд.</span>'; return; }
    const pct = HN.total(s) > 0 ? Math.min(100, (HN.paid(s) / HN.total(s)) * 100) : 0;
    $("payDebtBox").innerHTML = `<div class="debt-row"><span>Ҳисоб</span><b>${money(HN.total(s))}</b></div><div class="debt-row"><span>Пардохт шуд</span><b>${money(HN.paid(s))}</b></div><div class="debt-row big"><span>Қарзи боқимонда</span><b class="neg">${money(HN.debt(s))} TJS</b></div><div class="progress"><i style="width:${pct}%"></i></div>`;
  }
  $("payShipFilter").addEventListener("input", fillPayOptions);
  $("payShipment").addEventListener("change", () => { payPreselect = $("payShipment").value; updateDebtBox(); });
  payForm.elements.currency.addEventListener("change", () => { payForm.elements.fx_rate.value = String(fxDefault(payForm.elements.currency.value)); });
  $("payFull").addEventListener("click", () => {
    const s = HN.shipmentById($("payShipment").value); if (!s) return;
    const rate = HN.num(payForm.elements.fx_rate.value) || 1;
    payForm.elements.amount.value = (Math.floor((HN.debt(s) / rate) * 100) / 100).toFixed(2);
  });
  payForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = payForm.elements, msg = $("paymentMsg"); msg.dataset.kind = "error";
    const s = HN.shipmentById(f.shipment_id.value);
    const amount = HN.num(f.amount.value), rate = HN.num(f.fx_rate.value);
    if (!s) { msg.textContent = "Борро интихоб кунед."; return; }
    if (amount <= 0 || rate <= 0) { msg.textContent = "Маблағ ва қурбро дуруст ворид кунед."; return; }
    if (!f.payment_date.value) { msg.textContent = "Санаро интихоб кунед."; return; }
    let tjs = HN.round2(amount * rate);
    const debt = HN.debt(s);
    if (tjs > debt + 0.005) {
      if (tjs - debt > 0.05) { msg.textContent = `Маблағ (${money(tjs)} TJS) аз қарзи боқимонда (${money(debt)} TJS) зиёд аст.`; return; }
      tjs = HN.round2(debt); // currency rounding of a few dirams
    }
    msg.dataset.kind = ""; msg.textContent = "Сабт шуда истодааст…";
    const btn = payForm.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await S.db.from("payments").insert({ shipment_id: s.id, currency: f.currency.value, amount_original: amount, fx_rate: rate, amount_tjs: tjs, payment_date: f.payment_date.value, method: f.method.value, notes: f.notes.value.trim(), created_by: S.user.id });
    btn.disabled = false;
    if (r.error) { msg.dataset.kind = "error"; msg.textContent = HN.dbError(r.error); return; }
    if (f.currency.value === "USD") HN.lsSet(RATE_KEY, rate);
    $("paymentDialog").close();
    HN.toast(tjs >= debt - 0.005 ? "Пардохт сабт шуд. Бор пурра пардохт шуд." : `Пардохт сабт шуд. Қарзи боқимонда: ${money(debt - tjs)} TJS.`, "ok");
    await loadData(); if ($("detailDialog").open) openDetail(s.id);
  });
  $("addPaymentBtn").addEventListener("click", () => openPayment());

  /* ----- Expenses ----- */
  const quick = $("expenseQuickForm"), expForm = $("expenseForm");
  quick.elements.expense_date.value = HN.today();
  quick.elements.currency.addEventListener("change", () => (quick.elements.fx_rate.value = String(fxDefault(quick.elements.currency.value))));
  expForm.elements.currency.addEventListener("change", () => (expForm.elements.fx_rate.value = String(fxDefault(expForm.elements.currency.value))));
  function expensePayload(f) {
    const category = f.category.value.trim(), amount = HN.num(f.amount.value), rate = HN.num(f.fx_rate.value), date = f.expense_date.value;
    if (!category) return "Категорияро нависед.";
    if (amount <= 0) return "Маблағро дуруст нависед.";
    if (rate <= 0) return "Қурбро дуруст нависед.";
    if (!date) return "Санаро интихоб кунед.";
    return { category, currency: f.currency.value, amount_original: amount, fx_rate: rate, amount_tjs: HN.round2(amount * rate), expense_date: date, description: f.description.value.trim() };
  }
  quick.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $("expenseQuickMsg");
    if (!HN.can("finance")) { msg.textContent = "Барои сабти хароҷот нақши муҳосиб лозим аст."; return; }
    const p = expensePayload(quick.elements);
    if (typeof p === "string") { msg.dataset.kind = "error"; msg.textContent = p; return; }
    const btn = quick.querySelector('[type="submit"]'); btn.disabled = true; msg.dataset.kind = ""; msg.textContent = "Сабт шуда истодааст…";
    const r = await S.db.from("expenses").insert({ ...p, created_by: S.user.id });
    btn.disabled = false;
    if (r.error) { msg.dataset.kind = "error"; msg.textContent = HN.dbError(r.error); return; }
    const keepDate = quick.elements.expense_date.value;
    quick.reset(); quick.elements.expense_date.value = keepDate; quick.elements.fx_rate.value = "1";
    msg.dataset.kind = "ok"; msg.textContent = `Сабт шуд: ${p.category} — ${money(p.amount_tjs)} TJS.`;
    await loadData(); quick.elements.category.focus();
  });
  function openExpense(exp) {
    if (!HN.can("finance")) { HN.toast("Барои хароҷот нақши муҳосиб лозим аст."); return; }
    expForm.reset(); $("expenseMsg").textContent = "";
    expForm.dataset.editId = exp ? String(exp.id) : "";
    $("expenseTitle").textContent = exp ? "Таҳрири хароҷот" : "Хароҷоти нав";
    const f = expForm.elements;
    f.category.value = exp?.category || ""; f.amount.value = exp ? exp.amount_original ?? exp.amount ?? "" : "";
    f.currency.value = exp?.currency || "TJS"; f.fx_rate.value = String(exp?.fx_rate ?? exp?.exchange_rate ?? 1);
    f.expense_date.value = exp?.expense_date || HN.today(); f.description.value = exp?.description || exp?.notes || "";
    $("expenseDialog").showModal();
  }
  expForm.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $("expenseMsg"), p = expensePayload(expForm.elements);
    if (typeof p === "string") { msg.dataset.kind = "error"; msg.textContent = p; return; }
    const id = expForm.dataset.editId;
    msg.dataset.kind = ""; msg.textContent = "Сабт шуда истодааст…";
    const r = id ? await S.db.from("expenses").update(p).eq("id", id) : await S.db.from("expenses").insert({ ...p, created_by: S.user.id });
    if (r.error) { msg.dataset.kind = "error"; msg.textContent = HN.dbError(r.error); return; }
    $("expenseDialog").close(); HN.toast(id ? "Хароҷот нав карда шуд." : "Хароҷот сабт шуд.", "ok"); await loadData();
  });
  async function deleteExpense(id) {
    const x = S.expenses.find(e => String(e.id) === String(id)); if (!x) return;
    if (!(await HN.confirm(`Хароҷоти «${x.category}» (${money(x.amount_tjs)} TJS, ${HN.fmtDate(x.expense_date)}) нест карда шавад?`, { title: "Нест кардани хароҷот", ok: "Нест кардан", danger: true }))) return;
    const r = await S.db.from("expenses").delete().eq("id", x.id);
    if (r.error) { HN.toast("Нест нашуд: " + HN.dbError(r.error), "error"); return; }
    HN.toast("Хароҷот нест карда шуд.", "ok"); await loadData();
  }
  let expCat = "";
  ["expSearch", "expFrom", "expTo"].forEach(id => $(id).addEventListener("input", renderExpenses));
  $("expCats").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; expCat = expCat === b.dataset.cat ? "" : b.dataset.cat; renderExpenses(); });
  function filteredExpenses(ignoreCat) {
    const q = $("expSearch").value.trim().toLocaleLowerCase(), from = $("expFrom").value, to = $("expTo").value;
    return S.expenses.filter(e => (!q || [e.category, e.description, e.notes].some(v => String(v || "").toLocaleLowerCase().includes(q))) && ((!from && !to) || HN.inRange(String(e.expense_date || "").slice(0, 10), from, to)) && (ignoreCat || !expCat || e.category === expCat));
  }
  function renderExpenses() {
    const cats = [...new Set(S.expenses.map(e => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $("expenseCategories").innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join("");
    const base = filteredExpenses(true), byCat = new Map();
    base.forEach(e => byCat.set(e.category, (byCat.get(e.category) || 0) + HN.num(e.amount_tjs)));
    $("expCats").innerHTML = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `<button class="chip chip-btn${expCat === c ? " on" : ""}" data-cat="${esc(c)}"><small>${esc(c)}</small><b>${money(v)}</b></button>`).join("");
    const list = filteredExpenses(false), canEdit = HN.can("finance"), canDel = HN.can("delete");
    $("expRows").innerHTML = list.map(e => `<tr>${td(HN.fmtDate(e.expense_date), "nowrap")}${td(`<b>${esc(e.category || "—")}</b>`)}${td(money(e.amount_original ?? e.amount_tjs) + " " + esc(e.currency || "TJS"), "num nowrap")}${td(money(e.amount_tjs), "num")}${td(esc(e.description || e.notes || ""), "muted")}<td class="acts">${canEdit ? `<button class="icon-btn sm" data-act="edit-exp" data-id="${esc(e.id)}" title="Таҳрир" aria-label="Таҳрир"><svg><use href="#i-edit"/></svg></button>` : ""}${canDel ? `<button class="icon-btn sm danger" data-act="del-exp" data-id="${esc(e.id)}" title="Нест кардан" aria-label="Нест кардан"><svg><use href="#i-trash"/></svg></button>` : ""}</td></tr>`).join("");
    $("expTotal").textContent = money(list.reduce((n, e) => n + HN.num(e.amount_tjs), 0));
    empty("expEmpty", !list.length);
  }
  $("expExport").addEventListener("click", () => {
    const list = filteredExpenses(false);
    if (!list.length) { HN.toast("Барои содирот хароҷот нест."); return; }
    HN.exportXlsx("HOJI-NAIM-Хароҷот-" + HN.today() + ".xlsx", [{ name: "Хароҷот", title: "HOJI-NAIM CARGO — Хароҷот", columns: HN.cols.expenses(), rows: list }]);
  });

  /* ----- Reports ----- */
  let repGroup = "month";
  $("view-reports").querySelector(".tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-rtab]"); if (!b) return;
    setReportTab(b.dataset.rtab);
  });
  function setReportTab(tab) {
    document.querySelectorAll("[data-rtab]").forEach(x => x.classList.toggle("on", x.dataset.rtab === tab));
    $("rtab-analysis").classList.toggle("hidden", tab !== "analysis");
    $("rtab-notebook").classList.toggle("hidden", tab !== "notebook");
    HN.lsSet("hn-report-tab", tab);
    if (tab === "notebook") HN.notebook?.render();
  }
  $("repGroup").addEventListener("click", e => { const b = e.target.closest("[data-group]"); if (!b) return; repGroup = b.dataset.group; $("repGroup").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderAnalysis(); });
  ["repFrom", "repTo"].forEach(id => $(id).addEventListener("input", renderAnalysis));
  $("repCustomer").addEventListener("change", renderAnalysis);
  $("custSearch").addEventListener("input", renderAnalysis);
  if (!$("repFrom").value) { $("repFrom").value = HN.today().slice(0, 4) + "-01-01"; $("repTo").value = HN.today(); }
  function renderReports() {
    const tab = HN.lsGet("hn-report-tab", "analysis");
    setReportTab(tab === "notebook" ? "notebook" : "analysis");
    renderAnalysis();
  }
  function bucketOf(date) {
    if (repGroup === "day") return date;
    if (repGroup === "week") return HN.weekStart(date);
    return HN.monthStart(date);
  }
  function bucketLabel(b) {
    if (repGroup === "day") return HN.fmtDate(b);
    if (repGroup === "week") { const e = HN.addDays(b, 6); return HN.fmtDate(b).slice(0, 5) + " – " + HN.fmtDate(e); }
    return HN.MONTHS[+b.slice(5, 7) - 1] + " " + b.slice(0, 4);
  }
  function reportData() {
    const from = $("repFrom").value || null, to = $("repTo").value || null, ck = $("repCustomer").value;
    const ships = S.shipments.filter(s => (!ck || HN.customerKey(s) === ck));
    const shipIds = new Set(ships.map(s => String(s.id)));
    const shipsIn = ships.filter(s => HN.inRange(HN.shipmentDate(s), from, to));
    const pays = S.payments.filter(p => shipIds.has(String(p.shipment_id)) && HN.inRange(String(p.payment_date || "").slice(0, 10), from, to));
    const exps = ck ? [] : S.expenses.filter(e => HN.inRange(String(e.expense_date || "").slice(0, 10), from, to));
    const buckets = new Map();
    const B = k => { if (!buckets.has(k)) buckets.set(k, { key: k, count: 0, kg: 0, m3: 0, billed: 0, income: 0, expense: 0 }); return buckets.get(k); };
    shipsIn.forEach(s => { const b = B(bucketOf(HN.shipmentDate(s))); b.count++; b.kg += HN.num(s.weight_kg); b.m3 += HN.num(s.volume_m3); b.billed += HN.total(s); });
    pays.forEach(p => { B(bucketOf(String(p.payment_date).slice(0, 10))).income += HN.num(p.amount_tjs); });
    exps.forEach(e => { B(bucketOf(String(e.expense_date).slice(0, 10))).expense += HN.num(e.amount_tjs); });
    const rows = [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key));
    return { from, to, ck, shipsIn, pays, exps, rows };
  }
  function renderAnalysis() {
    const sel = $("repCustomer"), prev = sel.value;
    const custs = HN.customers().sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '<option value="">Ҳамаи муштариён</option>' + custs.map(c => `<option value="${esc(c.key)}">${esc(c.name)}${c.code ? " (" + esc(c.code) + ")" : ""}</option>`).join("");
    if (custs.some(c => c.key === prev)) sel.value = prev;
    const d = reportData(), fin = HN.can("finance");
    const sum = (arr, k) => arr.reduce((n, x) => n + HN.num(typeof k === "function" ? k(x) : x[k]), 0);
    const income = sum(d.pays, "amount_tjs"), cost = sum(d.exps, "amount_tjs");
    $("rShipments").textContent = d.shipsIn.length;
    $("rShipmentsSub").textContent = fmt(sum(d.shipsIn, "weight_kg"), 1) + " кг · " + fmt(sum(d.shipsIn, "volume_m3"), 3) + " м³";
    $("rIncome").textContent = money(income);
    $("rExpense").textContent = d.ck ? "—" : money(cost);
    $("rExpenseSub").textContent = d.ck ? "хароҷот ба муштарӣ вобаста нест" : "TJS";
    $("rProfit").textContent = d.ck ? "—" : money(income - cost);
    $("repTableTitle").textContent = { day: "Ҳисоботи рӯзона", week: "Ҳисоботи ҳафтаина", month: "Ҳисоботи моҳона" }[repGroup];
    $("repRangeLabel").textContent = (d.from ? HN.fmtDate(d.from) : "аз аввал") + " — " + (d.to ? HN.fmtDate(d.to) : "то имрӯз") + (d.ck ? " · " + (sel.selectedOptions[0]?.textContent || "") : "");
    const finCells = r => (fin ? td(d.ck ? "—" : money(r.expense), "num") + td(d.ck ? "—" : money(r.income - r.expense), "num" + (!d.ck && r.income - r.expense < 0 ? " neg" : "")) : "");
    $("repRows").innerHTML = d.rows.map(r => `<tr>${td(`<b>${bucketLabel(r.key)}</b>`, "nowrap")}${td(r.count, "num")}${td(fmt(r.kg, 1), "num")}${td(fmt(r.m3, 3), "num")}${td(money(r.billed), "num")}${td(money(r.income), "num")}${finCells(r)}</tr>`).join("");
    const T = { count: sum(d.rows, "count"), kg: sum(d.rows, "kg"), m3: sum(d.rows, "m3"), billed: sum(d.rows, "billed"), income: sum(d.rows, "income"), expense: sum(d.rows, "expense") };
    $("repFoot").innerHTML = d.rows.length ? `<tr>${td("Ҳамагӣ")}${td(T.count, "num")}${td(fmt(T.kg, 1), "num")}${td(fmt(T.m3, 3), "num")}${td(money(T.billed), "num")}${td(money(T.income), "num")}${finCells(T)}</tr>` : "";
    empty("repEmpty", !d.rows.length);
    // customers in range
    const q = $("custSearch").value.trim().toLocaleLowerCase();
    const groups = customerGroups(d.shipsIn).filter(c => !q || [c.name, c.code, c.phone].some(v => String(v || "").toLocaleLowerCase().includes(q)));
    $("custRows").innerHTML = groups.map(c => `<tr class="clickable" data-sheet-key="${esc(c.key)}">${td(esc(c.code || "—"), "code")}${td(`<b>${esc(c.name)}</b>`)}${td(esc(c.phone || "—"), "nowrap")}${td(c.shipments.length, "num")}${td(fmt(c.places, 0), "num")}${td(fmt(c.kg, 1), "num")}${td(fmt(c.cube, 3), "num")}${td(money(c.billed), "num")}${td(money(c.paid), "num")}${td(money(c.debt), "num" + (c.debt > 0.005 ? " neg" : ""))}</tr>`).join("");
    const G = k => groups.reduce((n, c) => n + c[k], 0);
    $("custFoot").innerHTML = groups.length ? `<tr>${td("Ҳамагӣ")}${td("")}${td("")}${td(groups.reduce((n, c) => n + c.shipments.length, 0), "num")}${td(fmt(G("places"), 0), "num")}${td(fmt(G("kg"), 1), "num")}${td(fmt(G("cube"), 3), "num")}${td(money(G("billed")), "num")}${td(money(G("paid")), "num")}${td(money(G("debt")), "num")}</tr>` : "";
    empty("custEmpty", !groups.length);
  }
  function customerGroups(ships) {
    const map = new Map();
    ships.forEach(s => {
      const key = HN.customerKey(s);
      if (!map.has(key)) map.set(key, { key, code: "", name: "", phone: "", shipments: [], places: 0, kg: 0, cube: 0, billed: 0, paid: 0, debt: 0 });
      const g = map.get(key);
      g.code = HN.customerCode(s) || g.code; g.name = String(s.client_name || "").trim() || g.name; g.phone = String(s.client_phone || "").trim() || g.phone;
      g.shipments.push(s); g.places += HN.places(s); g.kg += HN.num(s.weight_kg); g.cube += HN.num(s.volume_m3); g.billed += HN.total(s); g.paid += HN.paid(s); g.debt += HN.debt(s);
    });
    return [...map.values()].map(g => ({ ...g, name: g.name || g.code || "Муштарӣ" })).sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name));
  }
  $("repExport").addEventListener("click", () => {
    const d = reportData(), fin = HN.can("finance");
    const range = (d.from ? HN.fmtDate(d.from) : "аз аввал") + " — " + (d.to ? HN.fmtDate(d.to) : "то имрӯз");
    const periodCols = [
      { header: "Давра", value: r => bucketLabel(r.key), width: 22 },
      { header: "Борҳо", value: r => r.count, type: "int", width: 9, total: true },
      { header: "Вазн (кг)", value: r => r.kg, type: "qty", width: 12, total: true },
      { header: "Ҳаҷм (м³)", value: r => r.m3, type: "qty", width: 12, total: true },
      { header: "Ҳисоби борҳо (TJS)", value: r => r.billed, type: "money", width: 17, total: true },
      { header: "Даромад (TJS)", value: r => r.income, type: "money", width: 15, total: true },
    ];
    if (fin && !d.ck) periodCols.push({ header: "Хароҷот (TJS)", value: r => r.expense, type: "money", width: 15, total: true }, { header: "Фоида (TJS)", value: r => r.income - r.expense, type: "money", width: 15, total: true });
    const specs = [
      { name: { day: "Рӯзона", week: "Ҳафтаина", month: "Моҳона" }[repGroup], title: "HOJI-NAIM CARGO — " + $("repTableTitle").textContent, subtitle: "Давра: " + range, columns: periodCols, rows: d.rows },
      { name: "Муштариён", title: "HOJI-NAIM CARGO — Муштариён", subtitle: "Давра: " + range, columns: HN.cols.customers(), rows: customerGroups(d.shipsIn) },
      { name: "Борҳо", title: "HOJI-NAIM CARGO — Борҳо", subtitle: "Давра: " + range, columns: HN.cols.shipments(), rows: d.shipsIn },
      { name: "Пардохтҳо", title: "HOJI-NAIM CARGO — Пардохтҳо", subtitle: "Давра: " + range, columns: HN.cols.payments(), rows: d.pays },
    ];
    if (fin && !d.ck) specs.push({ name: "Хароҷот", title: "HOJI-NAIM CARGO — Хароҷот", subtitle: "Давра: " + range, columns: HN.cols.expenses(), rows: d.exps });
    HN.exportXlsx("HOJI-NAIM-Ҳисобот-" + HN.today() + ".xlsx", specs);
  });

  /* ----- Admin ----- */
  let staffLoaded = false, staffList = [];
  function renderAdmin() {
    $("aShipments").textContent = S.shipments.length; $("aPayments").textContent = S.payments.length;
    $("aExpenses").textContent = S.expenses.length; $("aCustomers").textContent = HN.customers().length;
    const f = S.features;
    const item = (ok, title, text) => `<li class="${ok ? "ok" : "warn"}"><b>${ok ? "✓" : "!"}</b><span><strong>${title}</strong><small>${text}</small></span></li>`;
    $("systemChecks").innerHTML = [
      item(true, "Пайваст ба база", "Борҳо, пардохтҳо ва хароҷот хонда мешаванд."),
      item(f.warehouse, "Ҳолати анбор", f.warehouse ? "Фаъол." : "SQL: supabase/migrations/20261019_warehouse_inventory.sql"),
      item(f.audit, "Таърихи тағйирот", f.audit ? "Фаъол. Ҳар тағйир дар бор, пардохт ва хароҷот сабт мешавад." : "Ихтиёрӣ. SQL: supabase/migrations/20261107_history_and_sheets.sql"),
      item(f.sheets, "Варақҳои муштариён дар база", f.sheets ? "Номи варақҳо барои ҳамаи кормандон якхела аст." : "Ҳоло номи варақҳо дар ҳамин браузер нигоҳ дошта мешавад. SQL: 20261107_history_and_sheets.sql"),
    ].join("");
  }
  async function loadStaff() {
    if (!HN.can("admin")) return;
    const body = $("staffRows"); body.innerHTML = '<tr><td colspan="5" class="muted">Бор шуда истодааст…</td></tr>';
    const r = await S.db.from("profiles").select("id,full_name,phone,role,created_at").order("created_at", { ascending: true });
    if (r.error) { body.innerHTML = `<tr><td colspan="5" class="neg">Хато: ${esc(HN.dbError(r.error))}</td></tr>`; return; }
    staffLoaded = true; staffList = r.data || [];
    const mine = HN.role();
    body.innerHTML = staffList.map(p => {
      const role = String(p.role || "customer");
      const roles = ["customer", "operator", "accountant", "admin", ...(mine === "owner" ? ["owner"] : [])];
      const locked = p.id === S.user.id || (role === "owner" && mine !== "owner");
      return `<tr>${td(`<b>${esc(p.full_name || "—")}</b>${p.id === S.user.id ? ' <span class="pill pay-paid">Шумо</span>' : ""}`)}${td(esc(p.phone || "—"), "nowrap")}${td(`<span class="pill role-${esc(role)}">${esc(HN.roleText[role] || role)}</span>`)}<td><select class="role-select" data-staff="${esc(p.id)}" ${locked ? "disabled" : ""} aria-label="Нақши нав">${roles.map(x => `<option value="${x}" ${x === role ? "selected" : ""}>${HN.roleText[x]}</option>`).join("")}</select></td><td class="acts"><button class="btn btn-xs btn-soft" data-act="save-role" data-id="${esc(p.id)}" ${locked ? "disabled" : ""}>Сабт</button><button class="icon-btn sm danger" data-act="del-profile" data-id="${esc(p.id)}" ${locked ? "disabled" : ""} title="Нест кардани профил" aria-label="Нест кардани профил"><svg><use href="#i-trash"/></svg></button></td></tr>`;
    }).join("") || '<tr><td colspan="5" class="muted">Аккаунт ёфт нашуд.</td></tr>';
  }
  $("refreshStaffBtn").addEventListener("click", loadStaff);
  async function saveRole(id) {
    const sel = document.querySelector(`.role-select[data-staff="${CSS.escape(id)}"]`); if (!sel) return;
    const p = staffList.find(x => x.id === id);
    if (!(await HN.confirm(`Нақши «${p?.full_name || "корманд"}» ба «${HN.roleText[sel.value]}» иваз карда шавад?`, { ok: "Иваз кардан" }))) return;
    const r = await S.db.rpc("admin_set_profile_role", { target_user_id: id, new_role: sel.value });
    if (r.error) { HN.toast("Нақш иваз нашуд: " + HN.dbError(r.error), "error"); return; }
    HN.toast("Нақш нав шуд.", "ok"); loadStaff();
  }
  async function deleteProfile(id) {
    const p = staffList.find(x => x.id === id);
    if (!(await HN.confirm(`Профили «${p?.full_name || "корманд"}» нест карда шавад? Аккаунти воридшавӣ нест намешавад, танҳо дастрасӣ ба система гирифта мешавад.`, { title: "Нест кардани профил", ok: "Нест кардан", danger: true }))) return;
    const r = await S.db.rpc("admin_delete_profile", { target_user_id: id });
    if (r.error) { HN.toast("Профил нест нашуд: " + HN.dbError(r.error), "error"); return; }
    HN.toast("Профил нест шуд.", "ok"); loadStaff();
  }
  $("backupXlsx").addEventListener("click", () => {
    HN.exportXlsx("HOJI-NAIM-Backup-" + HN.today() + ".xlsx", [
      { name: "Борҳо", title: "Нусхаи эҳтиётӣ — Борҳо", columns: [...HN.cols.shipments(), { header: "Навъи ҳисоб", value: s => s.billing_type, width: 10 }, { header: "Асъор", value: s => s.currency, width: 8 }, { header: "Нархи воҳид", value: s => s.unit_price, type: "qty", width: 11 }, { header: "Қурб", value: s => s.fx_rate, type: "qty", width: 10 }, { header: "Ҳисоб (асъор)", value: s => s.total_original, type: "money", width: 13 }, { header: "Ёддошт", value: s => s.notes, width: 40 }, { header: "ID", value: s => s.id, width: 38 }], rows: S.shipments },
      { name: "Пардохтҳо", title: "Нусхаи эҳтиётӣ — Пардохтҳо", columns: [...HN.cols.payments(), { header: "ID бор", value: p => p.shipment_id, width: 38 }, { header: "ID", value: p => p.id, width: 38 }], rows: S.payments },
      { name: "Хароҷот", title: "Нусхаи эҳтиётӣ — Хароҷот", columns: [...HN.cols.expenses(), { header: "ID", value: e => e.id, width: 38 }], rows: S.expenses },
    ]);
  });
  $("backupJson").addEventListener("click", () => {
    const data = { exported_at: new Date().toISOString(), app: "HOJI-NAIM CARGO", shipments: S.shipments, payments: S.payments, expenses: S.expenses, customer_sheets: S.sheets, local_notebook: { rows: HN.lsGet("hoji-naim-cargo-sheet-v1", []), meta: HN.lsGet("hoji-naim-cargo-sheet-meta-v1", {}), sheet_names: HN.lsGet("hoji-naim-customer-sheet-names-v1", {}) } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "HOJI-NAIM-Backup-" + HN.today() + ".json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ================= Shipment form ================= */
  const form = $("shipmentForm");
  let editing = null;
  function openShipment(shipment, preset) {
    if (!S.user) return;
    if (shipment ? !HN.can("editShipment") : !HN.can("staff")) { HN.toast("Барои ин амал иҷозат надоред."); return; }
    editing = shipment || null;
    form.reset(); $("shipmentMsg").textContent = "";
    $("shipmentEyebrow").textContent = shipment ? "Таҳрир" : "Сабти нав";
    $("shipmentTitle").textContent = shipment ? "Бор " + (shipment.tracking_no || "") : "Бори нав";
    $("shipmentSubmit").textContent = shipment ? "Сабти тағйирот" : "Сабт кардан";
    $("whField").classList.toggle("hidden", !S.features.warehouse);
    const custs = HN.customers().sort((a, b) => a.name.localeCompare(b.name));
    $("existingCustomer").innerHTML = '<option value="">+ Муштарии нав</option>' + custs.map(c => `<option value="${esc(c.key)}">${esc(c.name)}${c.code ? " · " + esc(c.code) : ""}${c.phone ? " · " + esc(c.phone) : ""}</option>`).join("");
    const f = form.elements;
    if (shipment) {
      const s = shipment;
      f.client_name.value = s.client_name || ""; f.client_code.value = HN.customerCode(s); f.client_phone.value = s.client_phone || "";
      f.tracking_no.value = s.tracking_no || ""; f.shipment_date.value = HN.shipmentDate(s) || HN.today();
      f.places.value = HN.places(s); f.warehouse_status.value = HN.whStatus(s);
      f.weight_kg.value = HN.num(s.weight_kg) || ""; f.volume_m3.value = HN.num(s.volume_m3) || "";
      const dims = String(HN.noteValue(s, "Андоза") || "").replace(/м/g, "").split("×").map(x => HN.num(x.trim()));
      if (dims.length === 3 && dims.every(x => x > 0)) { f.hei.value = dims[0]; f.wid.value = dims[1]; f.len.value = dims[2]; }
      const usd = s.currency === "USD";
      f.kg_price.value = HN.noteNumber(s, "Нархи кг") ?? (usd && s.billing_type === "kg" ? HN.num(s.unit_price) : D.kgPrice);
      f.cube_price.value = HN.noteNumber(s, "Нархи куб") ?? (usd && s.billing_type === "cube" ? HN.num(s.unit_price) : D.cubePrice);
      f.fx_rate.value = usd ? HN.num(s.fx_rate) || usdRate() : usdRate();
      f.notes.value = HN.freeNotes(s);
      $("existingCustomer").value = custs.some(c => c.key === HN.customerKey(s)) ? HN.customerKey(s) : "";
    } else {
      f.shipment_date.value = HN.today(); f.places.value = 1; f.warehouse_status.value = "in_warehouse";
      f.kg_price.value = D.kgPrice; f.cube_price.value = D.cubePrice; f.fx_rate.value = usdRate();
      if (preset) { f.client_name.value = preset.name || ""; f.client_code.value = preset.code || ""; f.client_phone.value = preset.phone || ""; if (custs.some(c => c.key === preset.key)) $("existingCustomer").value = preset.key; }
    }
    updateCalc();
    $("shipmentDialog").showModal();
    (shipment || preset ? f.tracking_no : f.client_name).focus();
  }
  HN.openShipment = openShipment;
  $("existingCustomer").addEventListener("change", () => {
    const c = HN.customers().find(x => x.key === $("existingCustomer").value);
    if (!c) return;
    const f = form.elements; f.client_name.value = c.name; f.client_code.value = c.code; f.client_phone.value = c.phone;
  });
  function readDims() {
    const f = form.elements, l = HN.num(f.len.value), w = HN.num(f.wid.value), h = HN.num(f.hei.value), p = Math.max(1, HN.num(f.places.value) || 1);
    return l > 0 && w > 0 && h > 0 ? { l, w, h, p, volume: HN.round2(l * w * h * p * 1000) / 1000 } : null;
  }
  function updateCalc(fromDims) {
    const f = form.elements, dims = readDims();
    if (dims && fromDims) f.volume_m3.value = String(Math.round(dims.volume * 1e4) / 1e4);
    f.volume_m3.classList.toggle("auto", !!dims);
    const c = HN.charge({ weight: f.weight_kg.value, volume: f.volume_m3.value, kgPrice: f.kg_price.value, cubePrice: f.cube_price.value, rate: f.fx_rate.value });
    const has = HN.num(f.weight_kg.value) > 0 || HN.num(f.volume_m3.value) > 0;
    const prev = editing ? `<div class="calc-prev">Ҳисоби пешина: <b>${money(HN.total(editing))} TJS</b> · пардохт шуд: ${money(HN.paid(editing))} TJS</div>` : "";
    $("calcBox").innerHTML = !has ? `<p class="muted">Вазн ё ҳаҷмро ворид кунед — нарх худкор ҳисоб мешавад.</p>${prev}` :
      `<div class="calc-grid"><div class="${c.type === "kg" ? "on" : ""}"><small>Аз рӯи вазн</small><b>$${fmt(c.kgAmount)}</b><span>${HN.fmtQty(f.weight_kg.value || 0)} кг × $${HN.fmtQty(f.kg_price.value || 0)}</span></div><div class="${c.type === "cube" ? "on" : ""}"><small>Аз рӯи ҳаҷм</small><b>$${fmt(c.cubeAmount)}</b><span>${HN.fmtQty(f.volume_m3.value || 0, 4)} м³ × $${HN.fmtQty(f.cube_price.value || 0)}</span></div><div class="calc-total"><small>Ҳисоб · ${c.type === "kg" ? "аз рӯи КГ" : "аз рӯи КУБ"}</small><b>${money(c.tjs)} TJS</b><span>$${fmt(c.usd)}${c.density ? " · зичӣ " + fmt(c.density, 1) + " кг/м³" : ""}</span></div></div>${prev}`;
    return c;
  }
  ["len", "wid", "hei", "places"].forEach(n => form.elements[n].addEventListener("input", () => updateCalc(true)));
  ["weight_kg", "volume_m3", "kg_price", "cube_price", "fx_rate"].forEach(n => form.elements[n].addEventListener("input", () => updateCalc(false)));
  form.elements.volume_m3.addEventListener("input", () => { if (readDims()) { form.elements.len.value = form.elements.wid.value = form.elements.hei.value = ""; updateCalc(false); } });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const f = form.elements, msg = $("shipmentMsg"); msg.dataset.kind = "error";
    const name = f.client_name.value.trim(), phone = f.client_phone.value.trim(), code = f.client_code.value.trim(), tracking = f.tracking_no.value.trim(), date = f.shipment_date.value;
    const weight = HN.num(f.weight_kg.value), volume = HN.num(f.volume_m3.value), places = Math.round(HN.num(f.places.value));
    const kgPrice = HN.num(f.kg_price.value), cubePrice = HN.num(f.cube_price.value), rate = HN.num(f.fx_rate.value);
    const fail = (t, el) => { msg.textContent = t; el?.focus(); };
    if (!name) return fail("Номи муштариро нависед.", f.client_name);
    if (!phone) return fail("Телефони муштариро нависед.", f.client_phone);
    if (!tracking) return fail("Рақами бор / трекро нависед.", f.tracking_no);
    if (!date) return fail("Санаи қабулро интихоб кунед.", f.shipment_date);
    if (places < 1) return fail("Шумораи ҷойҳо бояд ҳадди ақал 1 бошад.", f.places);
    if (weight < 0 || volume < 0) return fail("Вазн ва ҳаҷм манфӣ шуда наметавонанд.", f.weight_kg);
    if (weight <= 0 && volume <= 0) return fail("Вазн ё ҳаҷми борро ворид кунед.", f.weight_kg);
    if (kgPrice < 0 || cubePrice < 0) return fail("Нарх манфӣ шуда наметавонад.", f.kg_price);
    if (rate <= 0) return fail("Қурби долларро дуруст нависед.", f.fx_rate);
    const dup = S.shipments.find(s => String(s.tracking_no || "").toLowerCase() === tracking.toLowerCase() && (!editing || String(s.id) !== String(editing.id)));
    if (dup) return fail(`Рақами «${tracking}» аллакай дар бори «${dup.client_name}» ҳаст.`, f.tracking_no);
    const c = HN.charge({ weight, volume, kgPrice, cubePrice, rate });
    if (editing && c.tjs < HN.paid(editing) - 0.005) return fail(`Ҳисоби нав (${money(c.tjs)} TJS) аз маблағи аллакай пардохтшуда (${money(HN.paid(editing))} TJS) кам аст.`);
    const dims = readDims();
    const notes = HN.buildNotes(editing?.notes || "", {
      "Коди муштарӣ": code, "Ҷойҳо": places,
      "Андоза": dims ? `${dims.h} × ${dims.w} × ${dims.l} м` : (editing && HN.noteValue(editing, "Андоза") && !readDims() && HN.num(f.volume_m3.value) === HN.num(editing.volume_m3) ? HN.noteValue(editing, "Андоза") : ""),
      "Нархи кг": kgPrice, "Нархи куб": cubePrice, "Сумма кг": null, "Сумма куб": null,
    }, f.notes.value);
    const payload = { client_name: name, client_phone: phone, tracking_no: tracking, shipment_date: date, billing_type: c.type, weight_kg: weight, volume_m3: volume, currency: "USD", unit_price: c.unitPrice, fx_rate: rate, total_original: c.usd, total_tjs: c.tjs, notes };
    if (S.features.warehouse) payload.warehouse_status = f.warehouse_status.value || "in_warehouse";
    msg.dataset.kind = ""; msg.textContent = "Сабт шуда истодааст…";
    const btn = $("shipmentSubmit"); btn.disabled = true;
    const r = editing ? await S.db.from("shipments").update(payload).eq("id", editing.id) : await S.db.from("shipments").insert({ ...payload, created_by: S.user.id });
    btn.disabled = false;
    if (r.error) { msg.dataset.kind = "error"; msg.textContent = HN.dbError(r.error); return; }
    HN.lsSet(RATE_KEY, rate);
    const wasEdit = !!editing, id = editing?.id;
    $("shipmentDialog").close();
    HN.toast(wasEdit ? "Тағйирот сабт шуд." : `Бор «${tracking}» сабт шуд: ${money(c.tjs)} TJS.`, "ok");
    await loadData();
    if (wasEdit && $("detailDialog").open) openDetail(id);
  });
  $("addShipmentTop").addEventListener("click", () => openShipment());

  /* ================= Shipment details ================= */
  async function openDetail(id) {
    const s = HN.shipmentById(id); if (!s) { HN.toast("Бор ёфт нашуд. Маълумотро нав кунед."); return; }
    $("detailTitle").textContent = s.tracking_no || "—";
    const pays = (S.paymentsIndex.get(String(s.id)) || []).slice().sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)));
    const pct = HN.total(s) > 0 ? Math.min(100, (HN.paid(s) / HN.total(s)) * 100) : 0;
    const dims = HN.noteValue(s, "Андоза");
    const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const acts = [
      HN.debt(s) > 0.005 && HN.can("finance") ? `<button class="btn btn-primary" data-act="pay" data-id="${esc(s.id)}"><svg><use href="#i-wallet"/></svg><span>Сабти пардохт</span></button>` : "",
      HN.can("editShipment") ? `<button class="btn btn-ghost" data-act="edit" data-id="${esc(s.id)}"><svg><use href="#i-edit"/></svg><span>Таҳрир</span></button>` : "",
      S.features.warehouse && HN.can("staff") ? (HN.whStatus(s) === "in_warehouse" ? `<button class="btn btn-ghost" data-act="wh" data-to="delivered" data-id="${esc(s.id)}"><svg><use href="#i-check"/></svg><span>Супоридан</span></button>` : `<button class="btn btn-ghost" data-act="wh" data-to="in_warehouse" data-id="${esc(s.id)}"><svg><use href="#i-warehouse"/></svg><span>Ба анбор</span></button>`) : "",
      `<button class="btn btn-ghost" data-sheet-key="${esc(HN.customerKey(s))}"><svg><use href="#i-sheet"/></svg><span>Варақи муштарӣ</span></button>`,
      HN.can("delete") ? `<button class="btn btn-danger-soft" data-act="del-ship" data-id="${esc(s.id)}"><svg><use href="#i-trash"/></svg><span>Нест кардан</span></button>` : "",
    ].join("");
    $("detailContent").innerHTML = `
      <div class="detail-pills">${payPill(s)} ${S.features.warehouse ? whPill(s) : ""}</div>
      <div class="detail-money"><div><small>Ҳисоб</small><b>${money(HN.total(s))}</b></div><div><small>Пардохт</small><b>${money(HN.paid(s))}</b></div><div><small>Қарз</small><b class="${HN.debt(s) > 0.005 ? "neg" : ""}">${money(HN.debt(s))}</b></div></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="detail-actions">${acts}</div>
      <dl class="detail-grid">
        ${row("Муштарӣ", esc(s.client_name || "—"))}${row("Коди муштарӣ", esc(HN.customerCode(s) || "—"))}${row("Телефон", esc(s.client_phone || "—"))}${row("Санаи қабул", HN.fmtDate(HN.shipmentDate(s)))}
        ${row("Ҷойҳо", HN.places(s))}${row("Вазн", HN.fmtQty(s.weight_kg, 3) + " кг")}${row("Ҳаҷм", HN.fmtQty(s.volume_m3, 4) + " м³")}${row("Зичӣ", HN.num(s.volume_m3) > 0 ? fmt(HN.num(s.weight_kg) / HN.num(s.volume_m3), 1) + " кг/м³" : "—")}
        ${dims ? row("Андоза (Б × П × Д)", esc(dims)) : ""}${row("Ҳисоб аз рӯи", s.billing_type === "cube" ? "Ҳаҷм (м³)" : "Вазн (кг)")}${row("Нархи воҳид", fmt(s.unit_price, 2) + " " + esc(s.currency || ""))}${row("Ҳисоб бо асъор", money(s.total_original) + " " + esc(s.currency || "") + " · қурб " + HN.fmtQty(s.fx_rate, 4))}
      </dl>
      ${HN.freeNotes(s) ? `<div class="detail-notes"><small>Ёддошт</small><p>${esc(HN.freeNotes(s))}</p></div>` : ""}
      <h3 class="detail-h">Пардохтҳо <span class="muted">(${pays.length})</span></h3>
      ${pays.length ? `<ul class="timeline">${pays.map(p => `<li><span class="tl-dot ok"></span><div><b>${money(p.amount_tjs)} TJS</b><small>${HN.fmtDate(p.payment_date)} · ${esc(HN.methodText[p.method] || p.method || "—")}${p.currency !== "TJS" ? " · " + money(p.amount_original) + " " + esc(p.currency) : ""}${p.notes ? " · " + esc(p.notes) : ""}</small></div></li>`).join("")}</ul>` : '<p class="muted">Ҳоло пардохт нест.</p>'}
      <h3 class="detail-h">Таърихи тағйирот</h3>
      <div id="auditBox"><p class="muted">${S.features.audit ? "Бор шуда истодааст…" : "Таърихи тағйирот пас аз иҷрои SQL-и supabase/migrations/20261107_history_and_sheets.sql фаъол мешавад. Сана сабт: " + HN.fmtDateTime(s.created_at)}</p></div>`;
    if (!$("detailDialog").open) $("detailDialog").showModal();
    if (S.features.audit) loadAudit(s);
  }
  HN.openDetail = openDetail;
  const FIELD = { client_name: "Муштарӣ", client_phone: "Телефон", tracking_no: "Рақами бор", shipment_date: "Сана", weight_kg: "Вазн", volume_m3: "Ҳаҷм", total_tjs: "Ҳисоб (TJS)", warehouse_status: "Анбор", billing_type: "Навъи ҳисоб", unit_price: "Нарх", fx_rate: "Қурб", notes: "Ёддошт" };
  async function loadAudit(s) {
    const r = await S.db.from("audit_log").select("*").eq("table_name", "shipments").eq("record_id", String(s.id)).order("created_at", { ascending: false }).limit(50);
    const box = $("auditBox"); if (!box) return;
    if (r.error) { box.innerHTML = `<p class="muted">Таърих хонда нашуд: ${esc(HN.dbError(r.error))}</p>`; return; }
    const who = id => staffList.find(p => p.id === id)?.full_name || (id === S.user.id ? (S.profile?.full_name || "Шумо") : "Корманд");
    const items = (r.data || []).map(a => {
      const det = a.details || {}, o = det.old || {}, n = det.new || {};
      const changes = String(a.action).toUpperCase() === "UPDATE" ? Object.keys(FIELD).filter(k => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map(k => `${FIELD[k]}: ${esc(k === "warehouse_status" ? HN.whStatusText[o[k]] || o[k] : o[k] ?? "—")} → ${esc(k === "warehouse_status" ? HN.whStatusText[n[k]] || n[k] : n[k] ?? "—")}`) : [];
      const act = { INSERT: "Сабт шуд", UPDATE: "Тағйир ёфт", DELETE: "Нест шуд" }[String(a.action).toUpperCase()] || a.action;
      return `<li><span class="tl-dot"></span><div><b>${act}</b><small>${HN.fmtDateTime(a.created_at)} · ${esc(who(a.actor_id))}</small>${changes.length ? `<ul class="changes">${changes.map(c => `<li>${c}</li>`).join("")}</ul>` : ""}</div></li>`;
    });
    box.innerHTML = items.length ? `<ul class="timeline">${items.join("")}</ul>` : `<p class="muted">Сабт шуд: ${HN.fmtDateTime(s.created_at)}. Тағйироти дигар нест.</p>`;
  }
  async function deleteShipment(id) {
    const s = HN.shipmentById(id); if (!s) return;
    if (!HN.can("delete")) { HN.toast("Нест кардан танҳо барои админ аст."); return; }
    const pays = S.paymentsIndex.get(String(s.id)) || [];
    const warn = pays.length ? ` Бо он ${pays.length} пардохт (${money(pays.reduce((n, p) => n + HN.num(p.amount_tjs), 0))} TJS) низ нест мешавад.` : "";
    if (!(await HN.confirm(`Бори «${s.tracking_no}» (${s.client_name}) нест карда шавад?${warn} Ин амалро баргардонидан мумкин нест.`, { title: "Нест кардани бор", ok: "Нест кардан", danger: true }))) return;
    const r = await S.db.rpc("admin_delete_shipment", { target_shipment_id: s.id });
    if (r.error) { HN.toast("Бор нест нашуд: " + HN.dbError(r.error), "error"); return; }
    $("detailDialog").close();
    HN.toast("Бор нест шуд. Пардохтҳои нестшуда: " + Number(r.data?.deleted_payments ?? pays.length) + ".", "ok");
    await loadData();
  }

  /* ================= Global events ================= */
  document.addEventListener("click", e => {
    const close = e.target.closest("[data-close]");
    if (close) { close.closest("dialog")?.close(); return; }
    const sheet = e.target.closest("[data-sheet-key]");
    if (sheet) { $("detailDialog").close(); HN.lsSet("hn-report-tab", "notebook"); HN.notebook?.select(sheet.dataset.sheetKey); HN.go("reports"); return; }
    const openShip = e.target.closest("[data-open-ship]");
    if (openShip) { openDetail(openShip.dataset.openShip); return; }
    const a = e.target.closest("[data-act]");
    if (a) {
      const id = a.dataset.id;
      ({
        pay: () => openPayment(id), edit: () => openShipment(HN.shipmentById(id)), wh: () => setWarehouse(id, a.dataset.to),
        "del-ship": () => deleteShipment(id), "del-pay": () => deletePayment(id), "edit-exp": () => openExpense(S.expenses.find(x => String(x.id) === String(id))),
        "del-exp": () => deleteExpense(id), "save-role": () => saveRole(id), "del-profile": () => deleteProfile(id),
      }[a.dataset.act] || (() => {}))();
      return;
    }
    const tr = e.target.closest("tr[data-ship]");
    if (tr && !e.target.closest("button,a,input,select")) openDetail(tr.dataset.ship);
  });
  // Click outside a modal closes it.
  document.querySelectorAll("dialog.modal, dialog.drawer").forEach(d => d.addEventListener("click", e => { if (e.target === d && d.id !== "confirmDialog") d.close(); }));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") document.body.classList.remove("nav-open");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && current === "shipments") { e.preventDefault(); $("shipSearch").focus(); }
  });

  /* ================= Start ================= */
  async function start() {
    if (!window.supabase?.createClient) { showScreen("auth"); $("configNotice").classList.remove("hidden"); $("authSubmit").disabled = true; return; }
    S.db = window.supabase.createClient(HN.config.supabaseUrl, HN.config.supabaseKey);
    const { data, error } = await S.db.auth.getSession();
    if (error) console.error(error);
    if (data?.session?.user) await enterApp(data.session.user); else showScreen("auth");
    S.db.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (event === "SIGNED_OUT") leaveApp();
        else if (event === "SIGNED_IN" && session?.user && session.user.id !== S.user?.id) enterApp(session.user);
      }, 0);
    });
  }
  start().catch(err => { console.error(err); showScreen("auth"); $("authMessage").textContent = "Системаро оғоз карда натавонистем: " + (err.message || err); });
})();
