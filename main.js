(() => {
  "use strict";
  const SUPABASE_URL = "https://wfxbgkasstkxzmyrjwpi.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_RHfMgPtLrfPEJzqvBwk5Vg_ksk-iBr2";
  const $ = id => document.getElementById(id);
  const state = { db:null, user:null, profile:null, shipments:[], payments:[], expenses:[] };
  const fmt = n => Number(n||0).toLocaleString("tg-TJ",{minimumFractionDigits:2,maximumFractionDigits:2});
  const safe = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = s => { $("toast").textContent=s; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),3000); };
  const total = s => Number(s.total_tjs||0);
  const paid = s => state.payments.filter(p=>p.shipment_id===s.id).reduce((n,p)=>n+Number(p.amount_tjs||0),0);
  const debt = s => Math.max(0,total(s)-paid(s));
  const status = s => debt(s)<=0.005?"paid":paid(s)>0?"partial":"unpaid";
  const statusText = s => ({paid:"Пардохт шуд",partial:"Қисман пардохт",unpaid:"Қарздор"}[s]);
  function showAuth(show){$("authPanel").classList.toggle("hidden",!show);$("appContent").classList.toggle("hidden",show);$("logoutBtn").classList.toggle("hidden",!state.user);}
  function showView(name){document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));document.querySelectorAll(".nav").forEach(v=>v.classList.toggle("active",v.dataset.view===name));const t={dashboard:"Ҳисоботи умумӣ",shipments:"Борҳо",payments:"Пардохтҳо",expenses:"Хароҷот",reports:"Ҳисобот"};$("pageTitle").textContent=t[name]||t.dashboard;}
  async function loadData(){
    $("connectionStatus").textContent="Маълумот бор шуда истодааст…";
    const results=await Promise.all([
      state.db.from("shipments").select("*").order("created_at",{ascending:false}).limit(1000),
      state.db.from("payments").select("*").order("payment_date",{ascending:false}).limit(5000),
      state.db.from("expenses").select("*").order("expense_date",{ascending:false}).limit(2000),
      state.db.from("profiles").select("display_name,role,active").eq("id",state.user.id).maybeSingle()
    ]);
    const err=results.slice(0,3).find(r=>r.error);
    if(err){console.error(err.error);$("connectionStatus").textContent="Хатои база";toast("Хатои хондани ҷадвалҳо: "+err.error.message);return;}
    [state.shipments,state.payments,state.expenses]=results.slice(0,3).map(r=>r.data||[]);
    state.profile=results[3].data||null;
    if(results[3].error) console.warn("Profile could not be read",results[3].error);
    if(state.profile?.active===false){toast("Ҳисоби шумо ғайрифаъол аст.");await state.db.auth.signOut();return;}
    $("connectionStatus").textContent="Пайваст шуд"+(state.profile?.role?" · "+state.profile.role:"");
    render();
  }
  function render(){
    const revenue=state.payments.reduce((n,p)=>n+Number(p.amount_tjs||0),0);
    const costs=state.expenses.reduce((n,e)=>n+Number(e.amount_tjs||0),0);
    const debts=state.shipments.reduce((n,s)=>n+debt(s),0);
    $("statPaid").textContent=fmt(revenue);$("statExpenses").textContent=fmt(costs);$("statProfit").textContent=fmt(revenue-costs);$("statDebt").textContent=fmt(debts);$("statCargoCount").textContent="Борҳо: "+state.shipments.length;
    $("reportShipments").textContent=state.shipments.length;$("reportPaid").textContent=fmt(revenue);$("reportDebt").textContent=fmt(debts);$("reportExpenses").textContent=fmt(costs);
    const payButton=s=>debt(s)>0.005?`<button class="button secondary pay-shipment" data-shipment-id="${safe(s.id)}">Пардохт</button>`:`<span class="pill paid">Пардохт шуд</span>`;
    const row=s=>`<tr><td>${safe(s.client_name||"—")}</td><td>${safe(s.tracking_no||"—")}</td><td>${fmt(s.weight_kg)} кг / ${fmt(s.volume_m3)} м³</td><td>${fmt(total(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td><td>${payButton(s)}</td></tr>`;
    $("recentRows").innerHTML=state.shipments.slice(0,8).map(row).join("");$("recentEmpty").classList.toggle("hidden",state.shipments.length>0);
    const search=$("shipmentSearch").value.toLowerCase(),filter=$("shipmentFilter").value;
    const filtered=state.shipments.filter(s=>(!search||[s.client_name,s.client_phone,s.tracking_no].some(v=>String(v||"").toLowerCase().includes(search)))&&(!filter||status(s)===filter));
    $("shipmentRows").innerHTML=filtered.map(s=>`<tr><td>${safe(s.client_name||"—")}</td><td>${safe(s.client_phone||"—")}</td><td>${safe(s.tracking_no||"—")}</td><td>${fmt(s.weight_kg)}</td><td>${fmt(s.volume_m3)}</td><td>${fmt(total(s))}</td><td>${fmt(paid(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td><td>${payButton(s)}</td></tr>`).join("");
    $("shipmentEmpty").classList.toggle("hidden",filtered.length>0);
    $("paymentRows").innerHTML=state.payments.map(p=>`<tr><td>${safe(p.payment_date||"—")}</td><td>${safe(state.shipments.find(s=>s.id===p.shipment_id)?.tracking_no||p.shipment_id||"—")}</td><td>${fmt(p.amount_tjs)}</td><td>${safe(p.currency||"TJS")}</td><td>${safe(p.method||"—")}</td><td>${safe(p.notes||"—")}</td></tr>`).join("");$("paymentEmpty").classList.toggle("hidden",state.payments.length>0);
    $("expenseRows").innerHTML=state.expenses.map(e=>`<tr><td>${safe(e.expense_date||"—")}</td><td>${safe(e.category||"—")}</td><td>${fmt(e.amount_tjs)}</td><td>${safe(e.description||e.notes||"—")}</td></tr>`).join("");$("expenseEmpty").classList.toggle("hidden",state.expenses.length>0);
  }
  async function start(){
    if(!window.supabase||!SUPABASE_URL||!SUPABASE_ANON_KEY){$("configNotice").classList.remove("hidden");showAuth(false);return;}
    state.db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    const {data:{session},error}=await state.db.auth.getSession();if(error)console.error(error);
    state.user=session?.user||null;if(state.user){showAuth(false);await loadData();}else showAuth(true);
    state.db.auth.onAuthStateChange((_event,session)=>{state.user=session?.user||null;setTimeout(()=>state.user? (showAuth(false),loadData()):showAuth(true),0);});
  }
  let authMode="signin";
  const authModeToggle=$("authModeToggle");
  if(authModeToggle) authModeToggle.addEventListener("click",()=>{
    authMode=authMode==="signin"?"signup":"signin";
    $("authHeading").textContent=authMode==="signin"?"Воридшавӣ бо Email":"Сохтани ҳисоб";
    $("authDescription").textContent=authMode==="signin"?"Email ва паролро ворид кунед.":"Email ва пароли нав ворид кунед. Барои тасдиқи Email паёмро дар почта санҷед.";
    $("authSubmit").textContent=authMode==="signin"?"Ворид шудан":"Сабти ном";
    $("password").autocomplete=authMode==="signin"?"current-password":"new-password";
    authModeToggle.textContent=authMode==="signin"?"Ҳисоб надорӣ? Сабти ном":"Аллакай ҳисоб дорӣ? Воридшавӣ";
    $("authMessage").textContent="";
  });
  const emailForm=$("emailForm");
  if(emailForm) emailForm.addEventListener("submit",async e=>{
    e.preventDefault();if(!state.db)return;
    const email=$("email").value.trim(),password=$("password").value;
    $("authMessage").textContent=authMode==="signin"?"Ворид шуда истодааст…":"Ҳисоб сохта шуда истодааст…";
    $("authSubmit").disabled=true;
    try {
      const result=authMode==="signin"
        ? await state.db.auth.signInWithPassword({email,password})
        : await state.db.auth.signUp({email,password});
      if(result.error){$("authMessage").textContent=result.error.message;return;}
      if(authMode==="signup"&&!result.data.session){
        $("authMessage").textContent="Ҳисоб сохта шуд. Барои фаъол кардан Email-и худро тасдиқ кунед, баъд ворид шавед.";
        return;
      }
      if(result.data.session){$("authMessage").textContent="Муваффақ шуд.";state.user=result.data.user;showAuth(false);await loadData();}
    } catch(err) {
      $("authMessage").textContent=err.message||"Хатои номаълум.";
    } finally {
      $("authSubmit").disabled=false;
    }
  });
  $("logoutBtn").addEventListener("click",async()=>{if(state.db)await state.db.auth.signOut();});
  document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
  $("shipmentSearch").addEventListener("input",render);$("shipmentFilter").addEventListener("change",render);
  const dialog=$("shipmentDialog"),openDialog=()=>{if(!state.user){toast("Аввал ворид шавед.");return;}if(!["owner","admin","accountant","operator"].includes(state.profile?.role)){toast("Барои сабти бор иҷозати корманд лозим аст.");return;}dialog.showModal();};
  $("addShipmentBtn").addEventListener("click",openDialog);$("addShipmentTop").addEventListener("click",openDialog);$("closeDialog").addEventListener("click",()=>dialog.close());
  const shipmentForm=$("shipmentForm");
  const moneyRates={USD:9.2361,TJS:1,CNY:1.3803};
  function chooseBillingType(weight,volume){
    if(weight<=0 || volume<=0) return "";
    return weight/volume>=200 ? "kg" : "volume";
  }
  function updateShipmentEstimate(){
    const currency=shipmentForm.elements.currency.value;
    const weight=Number(shipmentForm.elements.weight_kg.value||0);
    const volume=Number(shipmentForm.elements.volume_m3.value||0);
    const type=chooseBillingType(weight,volume);
    const rate=Number(shipmentForm.elements.exchange_rate.value||0);
    const usdPrice=type==="kg"?1:type==="volume"?200:0;
    const price=currency==="USD"?usdPrice:currency==="TJS"?usdPrice*moneyRates.USD:usdPrice*moneyRates.USD/moneyRates.CNY;
    const qty=type==="kg"?weight:type==="volume"?volume:0;
    const original=qty*price;
    const tjs=original*rate;
    shipmentForm.elements.billing_type.value=type||"kg";
    shipmentForm.elements.unit_price.value=price.toFixed(2);
    const decision=$("billingDecision");
    if(decision) decision.textContent=type ? (type==="kg"?"Ин бор бо КГ ҳисоб мешавад (зичӣ ≥ 200 кг/м³)":"Ин бор бо КУБ ҳисоб мешавад (зичӣ < 200 кг/м³)") : "Вазн ва ҳаҷмро ворид кунед, то барнома интихоб кунад.";
    const estimate=$("shipmentEstimate"),estimateTjs=$("shipmentEstimateTjs");
    if(estimate) estimate.textContent=(currency==="USD"?"$":currency==="CNY"?"¥":"SM ")+original.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    if(estimateTjs) estimateTjs.textContent=tjs.toLocaleString("tg-TJ",{minimumFractionDigits:2,maximumFractionDigits:2})+" сомонӣ";
  }
  ["weight_kg","volume_m3"].forEach(name=>shipmentForm.elements[name].addEventListener("input",updateShipmentEstimate));
  shipmentForm.elements.currency.addEventListener("change",()=>{
    shipmentForm.elements.exchange_rate.value=String(moneyRates[shipmentForm.elements.currency.value]||1);
    updateShipmentEstimate();
  });
  shipmentForm.elements.exchange_rate.addEventListener("input",updateShipmentEstimate);
  updateShipmentEstimate();
  const paymentDialog=$("paymentDialog"),paymentForm=$("paymentForm");
  const paymentRates={TJS:1,USD:9.2361,CNY:1.3803};
  function openPayment(shipmentId){
    if(!["owner","admin","accountant"].includes(state.profile?.role)){toast("Барои сабти пардохт иҷозати муҳосиб лозим аст.");return;}
    const dueShipments=state.shipments.filter(s=>debt(s)>0.005);
    if(!dueShipments.length){toast("Бори қарздор ёфт нашуд.");return;}
    paymentForm.reset();
    const select=$("paymentShipmentSelect");
    select.innerHTML=dueShipments.map(s=>`<option value="${safe(s.id)}">${safe(s.tracking_no||"Бе рақам")} — ${safe(s.client_name||"Муштарӣ")} (қарз: ${fmt(debt(s))} сомонӣ)</option>`).join("");
    if(shipmentId && dueShipments.some(s=>s.id===shipmentId)) select.value=shipmentId;
    paymentForm.elements.currency.value="TJS";
    paymentForm.elements.fx_rate.value="1";
    const s=dueShipments.find(x=>x.id===select.value)||dueShipments[0];
    $("paymentCargoLabel").textContent="Муштарӣ: "+(s.client_name||"—");
    $("paymentDebtInfo").textContent="Қарзи боқимонда: "+fmt(debt(s))+" сомонӣ.";
    $("paymentMessage").textContent="";
    paymentDialog.showModal();
  }
  $("paymentShipmentSelect").addEventListener("change",()=>{
    const s=state.shipments.find(x=>x.id===$("paymentShipmentSelect").value);
    if(s){$("paymentCargoLabel").textContent="Муштарӣ: "+(s.client_name||"—");$("paymentDebtInfo").textContent="Қарзи боқимонда: "+fmt(debt(s))+" сомонӣ.";}
  });
  $("addPaymentBtn").addEventListener("click",()=>openPayment());
  document.addEventListener("click",e=>{
    const btn=e.target.closest(".pay-shipment");
    if(btn)openPayment(btn.dataset.shipmentId);
  });
  $("closePaymentDialog").addEventListener("click",()=>paymentDialog.close());
  paymentForm.elements.currency.addEventListener("change",()=>{
    paymentForm.elements.fx_rate.value=String(paymentRates[paymentForm.elements.currency.value]||1);
  });
  paymentForm.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!state.db||!state.user)return;
    const f=new FormData(paymentForm),shipmentId=String(f.get("shipment_id")),amount=Number(f.get("amount")),currency=String(f.get("currency")),rate=Number(f.get("fx_rate")),notes=String(f.get("notes")||"").trim();
    const s=state.shipments.find(x=>x.id===shipmentId);
    if(!s){$("paymentMessage").textContent="Бор ёфт нашуд.";return;}
    if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(rate)||rate<=0){$("paymentMessage").textContent="Маблағ ва қурбро дуруст ворид кунед.";return;}
    const amountTjs=Number((amount*rate).toFixed(2));
    if(amountTjs>debt(s)+0.005){$("paymentMessage").textContent="Маблағи пардохт аз қарзи боқимонда зиёд аст.";return;}
    $("paymentMessage").textContent="Пардохт сабт шуда истодааст…";
    const result=await state.db.from("payments").insert({shipment_id:shipmentId,currency,amount_original:amount,fx_rate:rate,amount_tjs:amountTjs,payment_date:new Date().toISOString().slice(0,10),notes,created_by:state.user.id});
    if(result.error){$("paymentMessage").textContent=result.error.message;return;}
    paymentDialog.close();toast("Пардохт сабт шуд.");await loadData();
  });
  const expenseDialog=$("expenseDialog"),expenseForm=$("expenseForm");
  const expenseRates={TJS:1,USD:9.2361,CNY:1.3803};
  if(expenseForm.elements.expense_date) expenseForm.elements.expense_date.value=new Date().toISOString().slice(0,10);
  $("addExpenseBtn").addEventListener("click",()=>{
    if(!state.user){toast("Аввал ворид шавед.");return;}
    if(!["owner","admin","accountant"].includes(state.profile?.role)){toast("Барои сабти хароҷот иҷозати муҳосиб лозим аст.");return;}
    expenseForm.reset();expenseForm.elements.expense_date.value=new Date().toISOString().slice(0,10);expenseForm.elements.currency.value="TJS";expenseForm.elements.fx_rate.value="1";$("expenseMessage").textContent="";expenseDialog.showModal();
  });
  $("closeExpenseDialog").addEventListener("click",()=>expenseDialog.close());
  expenseForm.elements.currency.addEventListener("change",()=>{expenseForm.elements.fx_rate.value=String(expenseRates[expenseForm.elements.currency.value]||1);});
  expenseForm.addEventListener("submit",async e=>{
    e.preventDefault();if(!state.db||!state.user)return;
    if(!["owner","admin","accountant"].includes(state.profile?.role)){ $("expenseMessage").textContent="Барои сабти хароҷот иҷозати муҳосиб лозим аст.";return;}
    const f=new FormData(expenseForm),category=String(f.get("category")).trim(),amount=Number(f.get("amount")),currency=String(f.get("currency")),rate=Number(f.get("fx_rate")),expenseDate=String(f.get("expense_date")),description=String(f.get("description")||"").trim();
    if(!category||amount<=0||rate<=0){$("expenseMessage").textContent="Категория, маблағ ва қурбро дуруст ворид кунед.";return;}
    $("expenseMessage").textContent="Сабт шуда истодааст…";
    const result=await state.db.from("expenses").insert({category,currency,amount_original:amount,fx_rate:rate,amount_tjs:Number((amount*rate).toFixed(2)),expense_date:expenseDate,description,created_by:state.user.id});
    if(result.error){$("expenseMessage").textContent=result.error.message;return;}
    expenseDialog.close();toast("Хароҷот сабт шуд.");await loadData();
  });
  $("shipmentForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!state.db||!state.user)return;
    const f=new FormData(e.currentTarget),name=String(f.get("customer_name")).trim(),phone=String(f.get("customer_phone")).trim(),currency=String(f.get("currency")),rate=Number(f.get("exchange_rate")),weight=Number(f.get("weight_kg")||0),volume=Number(f.get("volume_m3")||0),type=chooseBillingType(weight,volume);
    if(weight<=0){$("formMessage").textContent="Вазни борро аз сифр зиёд ворид кунед.";return;}
    if(volume<=0){$("formMessage").textContent="Барои муайян кардани зичӣ ҳаҷми бор (м³)-ро низ ворид кунед. Танҳо вазн кофӣ нест.";return;}
    if(!type){$("formMessage").textContent="Вазн ва ҳаҷмро санҷед.";return;}
    if(!Number.isFinite(rate)||rate<=0){$("formMessage").textContent="Қурби асъор бояд дуруст бошад.";return;}
    const price=currency==="USD"?(type==="kg"?1:200):currency==="TJS"?(type==="kg"?moneyRates.USD:200*moneyRates.USD):(type==="kg"?moneyRates.USD/moneyRates.CNY:200*moneyRates.USD/moneyRates.CNY);
    const qty=type==="kg"?weight:volume,totalTjs=Number((qty*price*rate).toFixed(2));
    $("formMessage").textContent="Сабт шуда истодааст…";
    const result=await state.db.from("shipments").insert({client_name:name,client_phone:phone,tracking_no:String(f.get("tracking_number")).trim(),shipment_date:new Date().toISOString().slice(0,10),billing_type:type,weight_kg:weight,volume_m3:volume,currency,unit_price:price,fx_rate:rate,total_original:Number((qty*price).toFixed(2)),total_tjs:totalTjs,notes:String(f.get("notes")||"").trim(),created_by:state.user.id});
    if(result.error){$("formMessage").textContent=result.error.message;return;}
    $("shipmentForm").reset();dialog.close();toast("Бор сабт шуд.");await loadData();
  });
  $("exportCsv").addEventListener("click",()=>{const rows=[["Муштарӣ","Телефон","Рақами бор","Вазн кг","Ҳаҷм м3","Ҳисоб TJS","Пардохт TJS","Қарз TJS"],...state.shipments.map(s=>[s.client_name||"",s.client_phone||"",s.tracking_no||"",s.weight_kg||0,s.volume_m3||0,total(s),paid(s),debt(s)])];const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download="hoji-naim-cargo-report.csv";a.click();URL.revokeObjectURL(url);});
  $("language").addEventListener("change",e=>{const lang=e.target.value,labels={tg:{dashboard:"Асосӣ",shipments:"Борҳо",payments:"Пардохтҳо",expenses:"Расходҳо",reports:"Ҳисобот"},ru:{dashboard:"Главная",shipments:"Грузы",payments:"Платежи",expenses:"Расходы",reports:"Отчёты"},en:{dashboard:"Dashboard",shipments:"Shipments",payments:"Payments",expenses:"Expenses",reports:"Reports"}};document.querySelectorAll("[data-i18n]").forEach(el=>el.textContent=labels[lang][el.dataset.i18n]);});
  start().catch(err=>{console.error(err);$("connectionStatus").textContent="Хатои оғоз";toast("Системаро оғоз карда натавонистем.");});
})();