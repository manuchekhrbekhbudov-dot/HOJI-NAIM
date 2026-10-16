(() => {
  "use strict";
  // Танҳо public/publishable key истифода баред. service_role ба браузер манъ аст.
  const SUPABASE_URL = "https://wfxbgkasstkxzmyrjwpi.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_RHfMgPtLrfPEJzqvBwk5Vg_ksk-iBr2";
  const $ = (id) => document.getElementById(id);
  const state = { db: null, user: null, profile: null, shipments: [], payments: [], expenses: [] };
  const fmt = (n) => Number(n || 0).toLocaleString("tg-TJ", {minimumFractionDigits:2, maximumFractionDigits:2});
  const safe = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = (s) => { $("toast").textContent = s; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),3000); };
  const total = s => Number(s.total_tjs || 0);
  const paid = s => state.payments.filter(p=>p.shipment_id===s.id).reduce((n,p)=>n+Number(p.amount_tjs||0),0);
  const debt = s => Math.max(0,total(s)-paid(s));
  const status = s => debt(s)<=0.005 ? "paid" : paid(s)>0 ? "partial" : "unpaid";
  const statusText = s => ({paid:"Пардохт шуд",partial:"Қисман пардохт",unpaid:"Қарздор"}[s]);
  function showAuth(show) { $("authPanel").classList.toggle("hidden",!show); $("appContent").classList.toggle("hidden",show); $("logoutBtn").classList.toggle("hidden",!state.user); }
  function showView(name) {
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
    document.querySelectorAll(".nav").forEach(v=>v.classList.toggle("active",v.dataset.view===name));
    const titles={dashboard:"Ҳисоботи умумӣ",shipments:"Борҳо",payments:"Пардохтҳо",expenses:"Хароҷот",reports:"Ҳисобот"};
    $("pageTitle").textContent=titles[name]||titles.dashboard;
  }
  async function loadData() {
    $("connectionStatus").textContent="Маълумот бор шуда истодааст…";
    const results=await Promise.all([
      state.db.from("shipments").select("*, customers(name, phone)").order("created_at",{ascending:false}).limit(1000),
      state.db.from("payments").select("*").order("payment_date",{ascending:false}).limit(5000),
      state.db.from("expenses").select("*").order("expense_date",{ascending:false}).limit(2000)
    ]);
    const err=results.find(r=>r.error);
    if(err){console.error(err.error);$("connectionStatus").textContent="Хатои база";toast("Маълумот бор нашуд. SQL schema ва RLS-ро санҷед.");return;}
    [state.shipments,state.payments,state.expenses]=results.map(r=>r.data||[]);
    $("connectionStatus").textContent="Пайваст шуд";
    render();
  }
  function render() {
    const revenue=state.payments.reduce((n,p)=>n+Number(p.amount_tjs||0),0);
    const costs=state.expenses.reduce((n,e)=>n+Number(e.amount_tjs||0),0);
    const debts=state.shipments.reduce((n,s)=>n+debt(s),0);
    $("statPaid").textContent=fmt(revenue);$("statExpenses").textContent=fmt(costs);$("statProfit").textContent=fmt(revenue-costs);$("statDebt").textContent=fmt(debts);$("statCargoCount").textContent="Борҳо: "+state.shipments.length;
    $("reportShipments").textContent=state.shipments.length;$("reportPaid").textContent=fmt(revenue);$("reportDebt").textContent=fmt(debts);$("reportExpenses").textContent=fmt(costs);
    const rows=state.shipments.map(s=>{const c=s.customers||{};return `<tr><td>${safe(c.name||"—")}</td><td>${safe(s.tracking_number)}</td><td>${fmt(s.weight_kg)} кг / ${fmt(s.volume_m3)} м³</td><td>${fmt(total(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td></tr>`;}).join("");
    $("recentRows").innerHTML=state.shipments.slice(0,8).map(s=>{const c=s.customers||{};return `<tr><td>${safe(c.name||"—")}</td><td>${safe(s.tracking_number)}</td><td>${fmt(s.weight_kg)} кг / ${fmt(s.volume_m3)} м³</td><td>${fmt(total(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td></tr>`;}).join("");
    $("recentEmpty").classList.toggle("hidden",state.shipments.length>0);
    const search=$("shipmentSearch").value.toLowerCase(),filter=$("shipmentFilter").value;
    const filtered=state.shipments.filter(s=>{const c=s.customers||{};return (!search||[c.name,c.phone,s.tracking_number].some(v=>String(v||"").toLowerCase().includes(search)))&&(!filter||status(s)===filter);});
    $("shipmentRows").innerHTML=filtered.map(s=>{const c=s.customers||{};return `<tr><td>${safe(c.name||"—")}</td><td>${safe(c.phone||"—")}</td><td>${safe(s.tracking_number)}</td><td>${fmt(s.weight_kg)}</td><td>${fmt(s.volume_m3)}</td><td>${fmt(total(s))}</td><td>${fmt(paid(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td></tr>`;}).join("");
    $("shipmentEmpty").classList.toggle("hidden",filtered.length>0);
    $("paymentRows").innerHTML=state.payments.map(p=>`<tr><td>${safe(p.payment_date||"—")}</td><td>${safe(p.shipment_id||"—")}</td><td>${fmt(p.amount_tjs)}</td><td>${safe(p.currency||"TJS")}</td><td>${safe(p.method||"—")}</td><td>${safe(p.notes||"—")}</td></tr>`).join("");$("paymentEmpty").classList.toggle("hidden",state.payments.length>0);
    $("expenseRows").innerHTML=state.expenses.map(e=>`<tr><td>${safe(e.expense_date||"—")}</td><td>${safe(e.category||"—")}</td><td>${fmt(e.amount_tjs)}</td><td>${safe(e.notes||"—")}</td></tr>`).join("");$("expenseEmpty").classList.toggle("hidden",state.expenses.length>0);
  }
  async function start() {
    if(!window.supabase||!SUPABASE_URL||!SUPABASE_ANON_KEY){$("configNotice").classList.remove("hidden");showAuth(false);return;}
    state.db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    const {data:{session},error}=await state.db.auth.getSession();
    if(error) console.error(error);
    state.user=session?.user||null;
    if(state.user){showAuth(false);await loadData();}else showAuth(true);
    state.db.auth.onAuthStateChange((_event,session)=>{state.user=session?.user||null;setTimeout(()=>state.user?loadData():showAuth(true),0);});
  }
  $("phoneForm").addEventListener("submit",async e=>{e.preventDefault();const phone=$("phone").value.trim();$("authMessage").textContent="SMS фиристода мешавад…";const {error}=await state.db.auth.signInWithOtp({phone});$("authMessage").textContent=error?error.message:"Агар Phone Auth танзим шуда бошад, SMS-код фиристода шуд.";if(!error)$("otpForm").classList.remove("hidden");});
  $("otpForm").addEventListener("submit",async e=>{e.preventDefault();const {error}=await state.db.auth.verifyOtp({phone:$("phone").value.trim(),token:$("otp").value.trim(),type:"sms"});$("authMessage").textContent=error?error.message:"Рақам тасдиқ шуд.";});
  $("logoutBtn").addEventListener("click",async()=>{if(state.db)await state.db.auth.signOut();});
  document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
  $("shipmentSearch").addEventListener("input",render);$("shipmentFilter").addEventListener("change",render);
  const dialog=$("shipmentDialog");const openDialog=()=>{if(!state.user){toast("Аввал ворид шавед.");return;}dialog.showModal();};
  $("addShipmentBtn").addEventListener("click",openDialog);$("addShipmentTop").addEventListener("click",openDialog);$("closeDialog").addEventListener("click",()=>dialog.close());
  $("shipmentForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!state.db||!state.user)return;
    const f=new FormData(e.currentTarget);const name=String(f.get("customer_name")).trim(),phone=String(f.get("customer_phone")).trim(),currency=String(f.get("currency")),rate=Number(f.get("exchange_rate")),price=Number(f.get("unit_price")),type=String(f.get("billing_type")),weight=Number(f.get("weight_kg")||0),volume=Number(f.get("volume_m3")||0);
    if(!Number.isFinite(rate)||rate<=0||price<0){$("formMessage").textContent="Нарх ва қурб бояд дуруст бошанд.";return;}
    const quantity=type==="kg"?weight:type==="volume"?volume:1;const totalTjs=quantity*price*rate;
    $("formMessage").textContent="Сабт шуда истодааст…";
    let customer=await state.db.from("customers").select("id").eq("phone",phone).maybeSingle();
    if(customer.error){$("formMessage").textContent=customer.error.message;return;}
    let customerId=customer.data?.id;
    if(!customerId){const inserted=await state.db.from("customers").insert({name,phone}).select("id").single();if(inserted.error){$("formMessage").textContent=inserted.error.message;return;}customerId=inserted.data.id;}
    const result=await state.db.from("shipments").insert({customer_id:customerId,tracking_number:String(f.get("tracking_number")).trim(),weight_kg:weight,volume_m3:volume,billing_type:type,unit_price:price,currency,exchange_rate:rate,total_tjs:totalTjs,notes:String(f.get("notes")||"").trim(),created_by:state.user.id}).select("id").single();
    if(result.error){$("formMessage").textContent=result.error.message;return;}
    $("shipmentForm").reset();dialog.close();toast("Бор сабт шуд.");await loadData();
  });
  $("exportCsv").addEventListener("click",()=>{const rows=[["Муштарӣ","Телефон","Рақами бор","Вазн кг","Ҳаҷм м3","Ҳисоб TJS","Пардохт TJS","Қарз TJS"],...state.shipments.map(s=>{const c=s.customers||{};return[c.name||"",c.phone||"",s.tracking_number||"",s.weight_kg||0,s.volume_m3||0,total(s),paid(s),debt(s)];})];const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download="hoji-naim-cargo-report.csv";a.click();URL.revokeObjectURL(url);});
  $("language").addEventListener("change",e=>{const lang=e.target.value;const labels={tg:{dashboard:"Асосӣ",shipments:"Борҳо",payments:"Пардохтҳо",expenses:"Расходҳо",reports:"Ҳисобот"},ru:{dashboard:"Главная",shipments:"Грузы",payments:"Платежи",expenses:"Расходы",reports:"Отчёты"},en:{dashboard:"Dashboard",shipments:"Shipments",payments:"Payments",expenses:"Expenses",reports:"Reports"}};document.querySelectorAll("[data-i18n]").forEach(el=>el.textContent=labels[lang][el.dataset.i18n]);});
  start().catch(err=>{console.error(err);$("connectionStatus").textContent="Хатои оғоз";toast("Системаро оғоз карда натавонистем.");});
})();