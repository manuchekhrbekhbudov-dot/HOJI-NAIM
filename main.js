
(() => {
  "use strict";

  // 1. Танзимоти Supabase
  // URL ва KEY-и лоиҳаи худро баъдтар гузор.
  const SUPABASE_URL = "sb_publishable_RHfMgPtLrfPEJzqvBwk5Vg_ksk-iBr2";
const SUPABASE_ANON_KEY = "sb_secret";

  const $ = (id) => document.getElementById(id);

  const today = () => new Date().toISOString().slice(0, 10);

  const money = (n) =>
    `${Number(n || 0).toLocaleString("tg-TJ", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} сомонӣ`;

  let db = null;
  let session = null;
  let profile = null;
  let shipments = [];
  let expenses = [];
  let payments = [];
  let signupMode = false;
  let toastTimer;

  // 2. Паёмҳо ва функсияҳои ёрирасон
  function toast(msg) {
    const el = $("toast");
    if (!el) {
      alert(msg);
      return;
    }

    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 2800);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function fmtDate(value) {
    return value
      ? new Date(value + "T00:00:00").toLocaleDateString("tg-TJ")
      : "—";
  }

  function totalBase(shipment) {
    return Number(shipment.total_tjs || 0);
  }

  function paidBase(shipment) {
    return payments
      .filter((p) => p.shipment_id === shipment.id)
      .reduce((sum, p) => sum + Number(p.amount_tjs || 0), 0);
  }

  function debtBase(shipment) {
    return Math.max(0, totalBase(shipment) - paidBase(shipment));
  }

  function status(shipment) {
    const total = totalBase(shipment);
    const paid = paidBase(shipment);

    if (total > 0 && paid >= total - 0.005) return "paid";
    if (paid > 0) return "partial";

    return "unpaid";
  }

  function statusLabel(value) {
    return {
      paid: "Пардохт шуд",
      partial: "Қисман пардохт шуд",
      unpaid: "Қарздор"
    }[value];
  }

  function roleLabel(role) {
    return {
      admin: "Администратор",
      manager: "Менеҷер",
      accountant: "Муҳосиб",
      operator: "Оператор"
    }[role] || "Корманд";
  }

  function showOnly(id) {
    ["setupScreen", "authScreen", "app"].forEach((name) => {
      const element = $(name);
      if (element) {
        element.classList.toggle("hidden", name !== id);
      }
    });
  }

  // 3. Гузариш байни саҳифаҳо
  function showView(name) {
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("active", view.id === `view-${name}`);
    });

    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === name);
    });

    const titles = {
      dashboard: "Ҳисоботи умумӣ",
      shipments: "Борҳо / Клиентҳо",
      expenses: "Расходҳо",
      reports: "Ҳисобот"
    };

    if ($("pageTitle")) {
      $("pageTitle").textContent = titles[name] || "Ҳисобот";
    }

    if (name === "shipments") renderShipments();
    if (name === "expenses") renderExpenses();
    if (name === "reports") renderReports();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 4. Ҳисоби пешакии бор
  function fxDefault() {
    const currency = $("currency").value;
    $("fxRate").value = currency === "TJS" ? "1" : "";
    updateCalc();
  }

  function updateCalc() {
    const type = $("billingType").value;

    const quantity =
      type === "kg"
        ? Number($("weight").value || 0)
        : type === "cube"
          ? Number($("volume").value || 0)
          : 1;

    const total =
      quantity *
      Number($("unitPrice").value || 0) *
      Number($("fxRate").value || 0);

    const paid =
      Number($("paidAmount").value || 0) *
      Number($("fxRate").value || 0);

    $("weight").disabled = type !== "kg";
    $("volume").disabled = type !== "cube";

    $("calcTotal").textContent = money(total);
    $("calcPaid").textContent = money(Math.min(total, paid));
    $("calcDebt").textContent = money(Math.max(0, total - paid));
  }

  // 5. Гирифтани маълумот аз база
  async function loadAll() {
    $("syncStatus").innerHTML = "<i></i> Навсозӣ...";

    const [shipmentsResult, expensesResult, paymentsResult] =
      await Promise.all([
        db.from("shipments")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),

        db.from("expenses")
          .select("*")
          .order("expense_date", { ascending: false })
          .limit(1000),

        db.from("payments")
          .select("*")
          .order("payment_date", { ascending: false })
          .limit(5000)
      ]);

    const error =
      shipmentsResult.error ||
      expensesResult.error ||
      paymentsResult.error;

    if (error) {
      console.error(error);
      $("syncStatus").textContent = "Хатои пайвастшавӣ";
      toast("Маълумот бор нашуд. Танзимоти база ва иҷозатҳоро санҷед.");
      return;
    }

    shipments = shipmentsResult.data || [];
    expenses = expensesResult.data || [];
    payments = paymentsResult.data || [];

    $("syncStatus").innerHTML = "<i></i> Синхрон шуд";

    renderAll();
  }

  // 6. Ҳисоботи асосӣ
  function renderDashboard() {
    const income = payments.reduce(
      (sum, payment) => sum + Number(payment.amount_tjs || 0),
      0
    );

    const cost = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount_tjs || 0),
      0
    );

    const debt = shipments.reduce(
      (sum, shipment) => sum + debtBase(shipment),
      0
    );

    $("statRevenue").textContent = money(income);
    $("statExpenses").textContent = money(cost);
    $("statProfit").textContent = money(income - cost);
    $("statDebt").textContent = money(debt);
    $("statShipmentCount").textContent = `Борҳо: ${shipments.length}`;

    const rows = shipments.slice(0, 6);

    $("recentRows").innerHTML = rows.map((shipment) => `
      <tr>
        <td>
          <b>${esc(shipment.client_name)}</b>
          <span class="sub">${esc(shipment.client_phone || "Телефон нест")}</span>
        </td>
        <td>${esc(shipment.tracking_no)}</td>
        <td class="money">${money(totalBase(shipment))}</td>
        <td>${money(paidBase(shipment))}</td>
        <td>
          <span class="pill ${status(shipment)}">
            ${statusLabel(status(shipment))}
          </span>
        </td>
      </tr>
    `).join("");

    $("recentEmpty").classList.toggle("hidden", rows.length > 0);
  }

  // 7. Ҷустуҷӯ ва рӯйхати борҳо
  function renderShipments() {
    const q = $("searchShipments").value.trim().toLowerCase();
    const filter = $("filterStatus").value;

    const rows = shipments.filter((shipment) => {
      const matchesSearch = [
        shipment.client_name,
        shipment.client_phone,
        shipment.tracking_no
      ].some((value) =>
        String(value || "").toLowerCase().includes(q)
      );

      return matchesSearch &&
        (filter === "all" || status(shipment) === filter);
    });

    $("shipmentsRows").innerHTML = rows.map((shipment) => `
      <tr>
        <td>
          <b>${esc(shipment.client_name)}</b>
          <span class="sub">${esc(shipment.client_phone || "—")}</span>
        </td>
        <td>
          ${esc(shipment.tracking_no)}
          <span class="sub">${fmtDate(shipment.shipment_date)}</span>
        </td>
        <td>
          ${esc(
            shipment.billing_type === "kg"
              ? "Аз рӯи кг"
              : shipment.billing_type === "cube"
                ? "Аз рӯи куб"
                : "Нархи муайян"
          )}
          <span class="sub">
            ${Number(shipment.unit_price).toLocaleString()}
            ${esc(shipment.currency)}
            / ${Number(shipment.fx_rate)} TJS
          </span>
        </td>
        <td>
          ${
            shipment.billing_type === "kg"
              ? `${shipment.weight_kg} кг`
              : shipment.billing_type === "cube"
                ? `${shipment.volume_m3} м³`
                : "Собит"
          }
        </td>
        <td class="money">${money(totalBase(shipment))}</td>
        <td>
          ${money(paidBase(shipment))}
          <span class="sub">Қарз: ${money(debtBase(shipment))}</span>
        </td>
        <td>
          <span class="pill ${status(shipment)}">
            ${statusLabel(status(shipment))}
          </span>
        </td>
        <td>
          <button class="action" data-pay="${shipment.id}">
            + Пардохт
          </button>
        </td>
      </tr>
    `).join("");

    $("shipmentsEmpty").classList.toggle("hidden", rows.length > 0);
  }

  // 8. Рӯйхати расходҳо
  function renderExpenses() {
    $("expenseRows").innerHTML = expenses.map((expense) => `
      <tr>
        <td>${fmtDate(expense.expense_date)}</td>
        <td>${esc(expense.category)}</td>
        <td>${esc(expense.description || "—")}</td>
        <td>
          ${Number(expense.amount_original).toLocaleString()}
          ${esc(expense.currency)}
        </td>
        <td class="money">${money(expense.amount_tjs)}</td>
        <td>
          <button class="action danger"
            data-delete-expense="${expense.id}">
            Нест
          </button>
        </td>
      </tr>
    `).join("");

    $("expensesEmpty").classList.toggle("hidden", expenses.length > 0);
  }

  // 9. Ҳисоботи молиявӣ
  function renderReports() {
    const billed = shipments.reduce(
      (sum, shipment) => sum + totalBase(shipment),
      0
    );

    const paid = payments.reduce(
      (sum, payment) => sum + Number(payment.amount_tjs || 0),
      0
    );

    const debt = shipments.reduce(
      (sum, shipment) => sum + debtBase(shipment),
      0
    );

    const cost = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount_tjs || 0),
      0
    );

    $("reportBilled").textContent = money(billed);
    $("reportPaid").textContent = money(paid);
    $("reportDebt").textContent = money(debt);
    $("reportProfit").textContent = money(paid - cost);
  }

  function renderAll() {
    renderDashboard();
    renderShipments();
    renderExpenses();
    renderReports();
  }

  // 10. Санҷиши ҳисоб ва воридшавӣ
  async function initApp() {
    const {
      data: { user }
    } = await db.auth.getUser();

    if (!user) {
      showOnly("authScreen");
      return;
    }

    session = user;

    const { data, error } = await db
      .from("profiles")
      .select("display_name,role,active")
      .eq("id", user.id)
      .single();

    if (error || !data || !data.active) {
      await db.auth.signOut();
      $("authError").textContent =
        "Ҳисоб фаъол нест. Бо администратор тамос гиред.";
      showOnly("authScreen");
      return;
    }

    profile = data;

    $("userEmail").textContent =
      user.email || data.display_name || "Корбар";

    $("userAvatar").textContent =
      (data.display_name || user.email || "U")
        .slice(0, 1)
        .toUpperCase();

    $("userRole").textContent = roleLabel(data.role);

    showOnly("app");

    await loadAll();
  }

  // 11. Илова кардани бор
  function openShipment() {
    $("shipmentForm").reset();
    $("shipmentDate").value = today();
    $("paidAmount").value = "0";
    $("currency").value = "TJS";
    $("fxRate").value = "1";
    $("shipmentError").textContent = "";

    updateCalc();
    $("shipmentDialog").showModal();
  }

  // 12. Илова кардани пардохт
  function openPayment(shipment) {
    $("paymentForm").reset();
    $("paymentShipmentId").value = shipment.id;
    $("paymentDate").value = today();
    $("paymentCurrency").value = "TJS";
    $("paymentFx").value = "1";
    $("paymentError").textContent = "";

    $("paymentContext").textContent =
      `${shipment.client_name} · ${shipment.tracking_no} · ` +
      `Қарзи ҳозира: ${money(debtBase(shipment))}`;

    $("paymentDialog").showModal();
  }

  async function saveShipment(event) {
    event.preventDefault();
    $("shipmentError").textContent = "";

    const type = $("billingType").value;
    const currency = $("currency").value;

    const quantity =
      type === "kg"
        ? Number($("weight").value || 0)
        : type === "cube"
          ? Number($("volume").value || 0)
          : 1;

    const price = Number($("unitPrice").value);
    const fx = Number($("fxRate").value);
    const paid = Number($("paidAmount").value || 0);
    const total = quantity * price;

    if (!Number.isFinite(fx) || fx <= 0) {
      $("shipmentError").textContent = "Қурб бояд аз 0 зиёд бошад.";
      return;
    }

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(paid) ||
      paid < 0
    ) {
      $("shipmentError").textContent = "Нарх ё пардохт нодуруст аст.";
      return;
    }

    if (
      (type === "kg" && quantity <= 0) ||
      (type === "cube" && quantity <= 0)
    ) {
      $("shipmentError").textContent =
        "Вазн ё ҳаҷм бояд аз 0 зиёд бошад.";
      return;
    }

    if (paid > total + 0.000001) {
      $("shipmentError").textContent =
        "Пардохти аввал аз маблағи умумӣ зиёд аст.";
      return;
    }

    const row = {
      client_name: $("clientName").value.trim(),
      client_phone: $("clientPhone").value.trim(),
      tracking_no: $("tracking").value.trim(),
      shipment_date: $("shipmentDate").value,
      billing_type: type,
      weight_kg: type === "kg" ? quantity : 0,
      volume_m3: type === "cube" ? quantity : 0,
      currency,
      unit_price: price,
      fx_rate: fx,
      total_original: total,
      total_tjs: total * fx,
      notes: $("shipmentNotes").value.trim(),
      created_by: session.id
    };

    const { data: shipment, error } = await db
      .from("shipments")
      .insert(row)
      .select()
      .single();

    if (error) {
      $("shipmentError").textContent = error.message;
      return;
    }

    if (paid > 0) {
      const payment = {
        shipment_id: shipment.id,
        currency,
        amount_original: paid,
        fx_rate: fx,
        amount_tjs: paid * fx,
        payment_date: $("shipmentDate").value,
        notes: "Пардохти аввал",
        created_by: session.id
      };

      const result = await db.from("payments").insert(payment);

      if (result.error) {
        console.error(result.error);
        toast(
          "Бор сабт шуд, аммо пардохт сабт нашуд. " +
          "Борро кушода пардохтро илова кунед."
        );
      }
    }

    $("shipmentDialog").close();
    await loadAll();
    toast("Бор дар база сабт шуд.");
  }

  async function savePayment(event) {
    event.preventDefault();
    $("paymentError").textContent = "";

    const shipmentId = $("paymentShipmentId").value;
    const amount = Number($("paymentAmount").value);
    const fx = Number($("paymentFx").value);

    const shipment = shipments.find(
      (item) => item.id === shipmentId
    );

    if (!shipment) return;

    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(fx) ||
      amount <= 0 ||
      fx <= 0
    ) {
      $("paymentError").textContent =
        "Маблағ ва қурб бояд аз 0 зиёд бошанд.";
      return;
    }

    if (amount * fx > debtBase(shipment) + 0.005) {
      $("paymentError").textContent =
        `Пардохт аз қарзи боқимонда ` +
        `(${money(debtBase(shipment))}) зиёд аст. Қурбро санҷед.`;
      return;
    }

    const row = {
      shipment_id: shipmentId,
      currency: $("paymentCurrency").value,
      amount_original: amount,
      fx_rate: fx,
      amount_tjs: amount * fx,
      payment_date: $("paymentDate").value,
      notes: $("paymentNotes").value.trim(),
      created_by: session.id
    };

    const { error } = await db.from("payments").insert(row);

    if (error) {
      $("paymentError").textContent = error.message;
      return;
    }

    $("paymentDialog").close();
    await loadAll();
    toast("Пардохт сабт шуд.");
  }

  // 13. Сабти расход
  async function saveExpense(event) {
    event.preventDefault();
    $("expenseError").textContent = "";

    const amount = Number($("expenseAmount").value);
    const fx = Number($("expenseFx").value);

    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(fx) ||
      amount <= 0 ||
      fx <= 0
    ) {
      $("expenseError").textContent =
        "Маблағ ва қурб бояд аз 0 зиёд бошанд.";
      return;
    }

    const row = {
      expense_date: $("expenseDate").value,
      category: $("expenseCategory").value,
      currency: $("expenseCurrency").value,
      amount_original: amount,
      fx_rate: fx,
      amount_tjs: amount * fx,
      description: $("expenseDescription").value.trim(),
      created_by: session.id
    };

    const { error } = await db.from("expenses").insert(row);

    if (error) {
      $("expenseError").textContent = error.message;
      return;
    }

    $("expenseDialog").close();
    await loadAll();
    toast("Расход сабт шуд.");
  }

  // 14. Баровардани ҳисобот ба CSV
  function exportCsv() {
    const rows = [
      [
        "Клиент",
        "Телефон",
        "Трек",
        "Сана",
        "Навъи",
        "Асъор",
        "Нарх",
        "Қурб",
        "Ҷамъ TJS",
        "Пардохт TJS",
        "Қарз TJS"
      ],
      ...shipments.map((shipment) => [
        shipment.client_name,
        shipment.client_phone,
        shipment.tracking_no,
        shipment.shipment_date,
        shipment.billing_type,
        shipment.currency,
        shipment.unit_price,
        shipment.fx_rate,
        totalBase(shipment),
        paidBase(shipment),
        debtBase(shipment)
      ])
    ];

    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map((value) =>
              `"${String(value ?? "").replace(/"/g, '""')}"`
            )
            .join(";")
        )
        .join("\r\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `hoji-naim-report-${today()}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  // 15. Воридшавӣ ва сабти ҳисоб
  $("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("authError").textContent = "";
    $("authSubmit").disabled = true;

    try {
      const email = $("authEmail").value.trim();
      const password = $("authPassword").value;

      if (signupMode) {
        const { error } = await db.auth.signUp({
          email,
          password
        });

        if (error) throw error;

        $("authError").textContent =
          "Агар сабти ном фаъол бошад, почтаи тасдиқро бинед. " +
          "Администратор бояд профили шуморо фаъол кунад.";
      } else {
        const { error } = await db.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        await initApp();
      }
    } catch (error) {
      $("authError").textContent =
        error.message || "Хатои воридшавӣ";
    } finally {
      $("authSubmit").disabled = false;
    }
  });

  $("toggleAuth").addEventListener("click", () => {
    signupMode = !signupMode;

    $("authTitle").textContent =
      signupMode ? "Сабти ҳисоби нав" : "Воридшавӣ";

    $("authSubmit").textContent =
      signupMode ? "Сабти ном" : "Ворид шудан";

    $("toggleAuth").textContent =
      signupMode
        ? "Аллакай ҳисоб доред? Ворид шавед"
        : "Ҳисоби нав сабт кардан";

    $("authPassword").autocomplete =
      signupMode ? "new-password" : "current-password";
  });

  $("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    showOnly("authScreen");
  });

  // 16. Тугмаҳои меню
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
    });
  });

  document.querySelectorAll("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.goto);
    });
  });

  // 17. Тугмаҳои илова кардани бор ва расход
  $("addShipmentBtn").addEventListener("click", openShipment);
  $("addShipmentBtn2").addEventListener("click", openShipment);

  $("addExpenseBtn").addEventListener("click", () => {
    $("expenseForm").reset();
    $("expenseDate").value = today();
    $("expenseFx").value = "1";
    $("expenseError").textContent = "";
    $("expenseDialog").showModal();
  });

  // 18. Формҳо
  $("shipmentForm").addEventListener("submit", saveShipment);
  $("paymentForm").addEventListener("submit", savePayment);
  $("expenseForm").addEventListener("submit", saveExpense);

  // 19. Ҳисоби автоматии нарх ва қурб
  [
    "billingType",
    "weight",
    "volume",
    "unitPrice",
    "fxRate",
    "paidAmount"
  ].forEach((id) => {
    $(id).addEventListener("input", updateCalc);
  });

  $("currency").addEventListener("change", fxDefault);

  $("paymentCurrency").addEventListener("change", () => {
    $("paymentFx").value =
      $("paymentCurrency").value === "TJS" ? "1" : "";
  });

  $("expenseCurrency").addEventListener("change", () => {
    $("expenseFx").value =
      $("expenseCurrency").value === "TJS" ? "1" : "";
  });

  // 20. Ҷустуҷӯ, навсозӣ ва экспорт
  $("searchShipments").addEventListener("input", renderShipments);
  $("filterStatus").addEventListener("change", renderShipments);
  $("refreshBtn").addEventListener("click", loadAll);
  $("exportBtn").addEventListener("click", exportCsv);

  // 21. Тугмаҳои пардохт, пӯшидани равзана ва нест кардани расход
  document.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-close]");

    if (closeButton) {
      $(closeButton.dataset.close).close();
      return;
    }

    const payButton = event.target.closest("[data-pay]");

    if (payButton) {
      const shipment = shipments.find(
        (item) => item.id === payButton.dataset.pay
      );

      if (shipment) openPayment(shipment);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-expense]");

    if (
      deleteButton &&
      confirm("Ин расходро нест мекунед?")
    ) {
      const { error } = await db
        .from("expenses")
        .delete()
        .eq("id", deleteButton.dataset.deleteExpense);

      if (error) {
        toast("Хатогӣ: " + error.message);
      } else {
        await loadAll();
        toast("Расход нест шуд.");
      }
    }
  });

  // 22. Санаҳои аввалия
  $("shipmentDate").value = today();
  $("paymentDate").value = today();
  $("expenseDate").value = today();

  // 23. Пайваст кардани Supabase
  if (
    !window.supabase ||
    SUPABASE_URL.includes("PASTE_") ||
    SUPABASE_ANON_KEY.includes("PASTE_")
  ) {
    showOnly("setupScreen");
    return;
  }

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      showOnly("authScreen");
    }
  });

  initApp().catch((error) => {
    console.error(error);
    showOnly("authScreen");
    $("authError").textContent =
      "Пайвастшавӣ ба система ноком шуд.";
  });
})();
