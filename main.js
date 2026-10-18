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
  function showAuth(show){$("authPanel").classList.toggle("hidden",!show);$("appContent").classList.toggle("hidden",show);document.querySelector(".topbar")?.classList.toggle("hidden",show);$("configNotice")?.classList.toggle("hidden",show||!$("configNotice").dataset.visible);document.body.classList.toggle("auth-mode",show);$("logoutBtn").classList.toggle("hidden",!state.user);}
  function showView(name){document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));document.querySelectorAll(".nav").forEach(v=>v.classList.toggle("active",v.dataset.view===name));const t={dashboard:"Ҳисоботи умумӣ",shipments:"Борҳо",payments:"Пардохтҳо",expenses:"Хароҷот",reports:"Ҳисобот",admin:"Админ-панел"};$("pageTitle").textContent=t[name]||t.dashboard;}
  async function fetchAllRows(table,orderColumn,pageSize=1000){
    const all=[];
    for(let from=0;;from+=pageSize){
      const result=await state.db.from(table).select("*").order(orderColumn,{ascending:false}).range(from,from+pageSize-1);
      if(result.error)throw result.error;
      const page=result.data||[];
      all.push(...page);
      if(page.length<pageSize)break;
    }
    return all;
  }
  async function loadData(){
    $("connectionStatus").textContent="Маълумот бор шуда истодааст…";
    try{
      const [shipments,payments,expenses,profileResult]=await Promise.all([
        fetchAllRows("shipments","created_at"),
        fetchAllRows("payments","payment_date"),
        fetchAllRows("expenses","expense_date"),
        state.db.from("profiles").select("role").eq("id",state.user.id).maybeSingle()
      ]);
      state.shipments=shipments;
      state.payments=payments;
      state.expenses=expenses;
      state.profile=profileResult.data||null;
      if(profileResult.error)console.warn("Profile could not be read",profileResult.error);
    }catch(err){
      console.error(err);
      $("connectionStatus").textContent="Хатои база";
      toast("Хатои хондани маълумот: "+(err.message||"хатои номаълум"));
      return;
    }
    $("connectionStatus").textContent="Пайваст шуд"+(state.profile?.role?" · "+state.profile.role:"");
    const isAdmin=["owner","admin"].includes(state.profile?.role);
    $("adminNav").classList.toggle("hidden",!isAdmin);
    render();
  }
  function customerCodeOf(s){return String(s.client_code||s.clientCode||s.notes?.match(/Коди муштарӣ:\s*([^;]+)/i)?.[1]||"").trim();}
  function renderCustomerSummary(){
    const search=String($("customerSummarySearch")?.value||"").trim().toLocaleLowerCase();
    const grouped=new Map();
    state.shipments.forEach(s=>{
      const code=customerCodeOf(s),name=String(s.client_name||"").trim(),phone=String(s.client_phone||"").trim();
      const key=code?"code:"+code.toLocaleLowerCase():phone?"phone:"+phone.toLocaleLowerCase():"name:"+(name||"Муштарӣ").toLocaleLowerCase();
      if(!grouped.has(key))grouped.set(key,{code,name:name||"—",phone,cube:0,kg:0,billed:0,paid:0,debt:0,count:0});
      const item=grouped.get(key);
      if(!item.code&&code)item.code=code;if((!item.name||item.name==="—")&&name)item.name=name;if(!item.phone&&phone)item.phone=phone;
      item.cube+=Number(s.volume_m3||0);item.kg+=Number(s.weight_kg||0);item.billed+=total(s);item.paid+=paid(s);item.debt+=debt(s);item.count+=1;
    });
    const all=[...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name));
    const rows=all.filter(x=>[x.code,x.name,x.phone].some(v=>String(v||"").toLocaleLowerCase().includes(search)));
    $("customerSummaryRows").innerHTML=rows.map(x=>`<tr><td>${safe(x.code||"—")}</td><td>${safe(x.name)}</td><td>${safe(x.phone||"—")}</td><td>${fmt(x.cube)}</td><td>${fmt(x.kg)}</td><td>${fmt(x.billed)}</td><td>${fmt(x.paid)}</td><td>${fmt(x.debt)}</td><td>${fmt(x.cube>0?x.kg/x.cube:0)}</td><td>${x.count}</td></tr>`).join("");
    $("customerSummaryEmpty").classList.toggle("hidden",rows.length>0);
    $("customerSummaryCube").textContent=fmt(rows.reduce((n,x)=>n+x.cube,0));$("customerSummaryKg").textContent=fmt(rows.reduce((n,x)=>n+x.kg,0));$("customerSummaryBilled").textContent=fmt(rows.reduce((n,x)=>n+x.billed,0));$("customerSummaryPaid").textContent=fmt(rows.reduce((n,x)=>n+x.paid,0));$("customerSummaryDebt").textContent=fmt(rows.reduce((n,x)=>n+x.debt,0));
  }
  function render(){
    const revenue=state.payments.reduce((n,p)=>n+Number(p.amount_tjs||0),0);
    const costs=state.expenses.reduce((n,e)=>n+Number(e.amount_tjs||0),0);
    const debts=state.shipments.reduce((n,s)=>n+debt(s),0);
    $("statPaid").textContent=fmt(revenue);$("statExpenses").textContent=fmt(costs);$("statProfit").textContent=fmt(revenue-costs);$("statDebt").textContent=fmt(debts);$("statCargoCount").textContent="Борҳо: "+state.shipments.length;
    $("adminShipments").textContent=state.shipments.length;
    $("adminPayments").textContent=state.payments.length;
    $("adminExpenses").textContent=state.expenses.length;
    $("adminDebt").textContent=fmt(debts);
    $("adminRoleBadge").textContent=String(state.profile?.role||"").toUpperCase();
    $("reportShipments").textContent=state.shipments.length;$("reportPaid").textContent=fmt(revenue);$("reportDebt").textContent=fmt(debts);$("reportExpenses").textContent=fmt(costs);
    renderCustomerSummary();
    const payButton=s=>debt(s)>0.005?`<button class="button secondary pay-shipment" data-shipment-id="${safe(s.id)}">Пардохт</button>`:`<span class="pill paid">Пардохт шуд</span>`;
    const row=s=>`<tr><td>${safe(s.client_name||"—")}</td><td>${safe(s.tracking_no||"—")}</td><td>${fmt(s.weight_kg)} кг / ${fmt(s.volume_m3)} м³</td><td>${fmt(total(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td><td>${payButton(s)}${["owner","admin"].includes(state.profile?.role)?` <button class="button danger delete-shipment" data-shipment-id="${safe(s.id)}">Удалить</button>`:""}</td></tr>`;
    $("recentRows").innerHTML=state.shipments.slice(0,8).map(row).join("");$("recentEmpty").classList.toggle("hidden",state.shipments.length>0);
    const search=$("shipmentSearch").value.trim().toLocaleLowerCase(),filter=$("shipmentFilter").value;
    const filtered=state.shipments.filter(s=>(!search||[s.client_code,s.clientCode,s.notes?.match(/Коди муштарӣ:\s*([^;]+)/i)?.[1],s.client_name,s.client_phone,s.tracking_no].some(v=>String(v||"").toLocaleLowerCase().includes(search)))&&(!filter||status(s)===filter));
    $("shipmentRows").innerHTML=filtered.map(s=>`<tr><td>${safe(s.client_code||s.clientCode||s.notes?.match(/Коди муштарӣ:\s*([^;]+)/i)?.[1]||"—")}</td><td>${safe(s.client_phone||"—")}</td><td>${safe(s.tracking_no||"—")}</td><td>${fmt(s.weight_kg)}</td><td>${fmt(s.volume_m3)}</td><td>${fmt(total(s))}</td><td>${fmt(paid(s))}</td><td>${fmt(debt(s))}</td><td><span class="pill ${status(s)}">${statusText(status(s))}</span></td><td>${payButton(s)}${["owner","admin"].includes(state.profile?.role)?` <button class="button danger delete-shipment" data-shipment-id="${safe(s.id)}">Удалить</button>`:""}</td></tr>`).join("");
    $("shipmentEmpty").classList.toggle("hidden",filtered.length>0);
    $("paymentRows").innerHTML=state.payments.map(p=>`<tr><td>${safe(p.payment_date||"—")}</td><td>${safe(state.shipments.find(s=>s.id===p.shipment_id)?.tracking_no||p.shipment_id||"—")}</td><td>${fmt(p.amount_tjs)}</td><td>${safe(p.currency||"TJS")}</td><td>${safe(p.method||"—")}</td><td>${safe(p.notes||"—")}</td></tr>`).join("");$("paymentEmpty").classList.toggle("hidden",state.payments.length>0);
    const canEditExpense=["owner","admin","accountant"].includes(state.profile?.role);
    const canDeleteExpense=["owner","admin"].includes(state.profile?.role);
    $("expenseRows").innerHTML=state.expenses.map(e=>`<tr><td>${safe(e.expense_date||"—")}</td><td>${safe(e.category||"—")}</td><td>${fmt(e.amount_tjs)}</td><td>${safe(e.description||e.notes||"—")}</td>${canEditExpense?`<td>${canEditExpense?`<button class="button secondary edit-expense" data-expense-id="${safe(e.id)}">Таҳрир</button>`:""} ${canDeleteExpense?`<button class="button danger delete-expense" data-expense-id="${safe(e.id)}">Удалить</button>`:""}</td>`:""}</tr>`).join("");
    const expenseTotal=state.expenses.reduce((sum,item)=>sum+Number(item.amount_tjs||0),0);if($("expenseSheetTotal"))$("expenseSheetTotal").textContent=fmt(expenseTotal);
    const expenseActionHead=$("expenseActionHead");
    if(expenseActionHead) expenseActionHead.classList.toggle("hidden",!canEditExpense);
    $("expenseEmpty").classList.toggle("hidden",state.expenses.length>0);
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
    $("authHeading").textContent=authMode==="signin"?"Хуш омадед, сармуҳосиб!":"Сохтани ҳисоб";
    $("authDescription").textContent=authMode==="signin"?"Барои идома Email ва пароли худро ворид кунед.":"Email ва пароли нав ворид кунед. Барои тасдиқи Email паёмро дар почта санҷед.";
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

  async function loadAdminStaff(){
    if(!["owner","admin"].includes(state.profile?.role)){toast("Ин қисм танҳо барои админ аст.");return;}
    const body=$("adminStaffRows");
    body.innerHTML='<tr><td colspan="5">Бор шуда истодааст…</td></tr>';
    const {data,error}=await state.db.from("profiles").select("id,full_name,phone,role").order("created_at",{ascending:true});
    if(error){body.innerHTML='<tr><td colspan="5">Хато: '+safe(error.message)+'</td></tr>';return;}
    if(!data?.length){body.innerHTML='<tr><td colspan="5">Аккаунт ёфт нашуд.</td></tr>';return;}
    body.innerHTML=data.map(p=>{
      const role=String(p.role||"customer");
      const roles=["customer","operator","accountant","admin",...(state.profile.role==="owner"?["owner"]:[])];
      const labels={customer:"Муштарӣ",operator:"Оператор",accountant:"Муҳосиб",admin:"Админ",owner:"Соҳиб"};
      const options=roles.map(r=>'<option value="'+r+'" '+(r===role?"selected":"")+'>'+labels[r]+'</option>').join("");
      const locked=p.id===state.user.id||(role==="owner"&&state.profile.role!=="owner");
      return '<tr><td>'+safe(p.full_name||"—")+(p.id===state.user.id?' <span class="pill paid">Шумо</span>':"")+'</td><td>'+safe(p.phone||"—")+'</td><td><span class="pill '+(["admin","owner"].includes(role)?"paid":"partial")+'">'+safe(role)+'</span></td><td><select class="staff-role-select" data-staff-id="'+safe(p.id)+'" '+(locked?"disabled":"")+'>'+options+'</select></td><td><div class="admin-row-actions"><button class="button secondary save-staff-role" data-staff-id="'+safe(p.id)+'" '+(locked?"disabled":"")+'>Захира</button><button class="button danger delete-staff-profile" data-staff-id="'+safe(p.id)+'" '+(locked?"disabled":"")+'>Удалить</button></div></td></tr>';
    }).join("");
  }
  $("refreshStaffBtn").addEventListener("click",loadAdminStaff);
  $("adminStaffRows").addEventListener("click",async e=>{
    const deleteBtn=e.target.closest(".delete-staff-profile");
    if(deleteBtn){
      const id=deleteBtn.dataset.staffId;
      if(!confirm("Профили корманд нест карда шавад? Ин аккаунти воридшавиро нест намекунад, танҳо профили системаашро мегирад."))return;
      deleteBtn.disabled=true;
      const {error}=await state.db.rpc("admin_delete_profile",{target_user_id:id});
      deleteBtn.disabled=false;
      if(error){toast("Профил нест нашуд. SQL-и admin_delete_profile-ро иҷро кунед.");console.error(error);return;}
      toast("Профили корманд нест шуд.");await loadAdminStaff();return;
    }
    const btn=e.target.closest(".save-staff-role");if(!btn)return;
    const id=btn.dataset.staffId,select=$("adminStaffRows").querySelector('.staff-role-select[data-staff-id="'+id+'"]');
    if(!select)return;
    btn.disabled=true;btn.textContent="…";
    const {error}=await state.db.rpc("admin_set_profile_role",{target_user_id:id,new_role:select.value});
    btn.disabled=false;btn.textContent="Захира";
    if(error){toast("Нақш иваз нашуд. SQL-и амниятиро насб кунед.");console.error(error);return;}
    toast("Нақши корманд нав шуд.");await loadAdminStaff();
  });

  document.addEventListener("click",async e=>{
    const btn=e.target.closest(".delete-shipment");
    if(!btn)return;
    if(!["owner","admin"].includes(state.profile?.role)){toast("Ҳазф танҳо барои админ аст.");return;}
    if(!confirm("Ин бор ҳазф шавад? Агар пардохти вобаста дошта бошад, система иҷозат намедиҳад."))return;
    btn.disabled=true;btn.textContent="…";
    const {error}=await state.db.rpc("admin_delete_shipment",{target_shipment_id:btn.dataset.shipmentId});
    if(error){btn.disabled=false;btn.textContent="Удалить";toast("Хатои ҳазф: "+(error.message||"сабаби номаълум"));console.error("Shipment delete error:",error);return;}
    toast("Бор ҳазф шуд.");await loadData();
  });
  $("logoutBtn").addEventListener("click",async()=>{if(state.db)await state.db.auth.signOut();});
  document.querySelectorAll(".nav").forEach(b=>{b.addEventListener("click",e=>{e.preventDefault();showView(b.dataset.view);});b.addEventListener("touchend",()=>showView(b.dataset.view),{passive:true});});
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
  $("shipmentSearch").addEventListener("input",render);$("shipmentFilter").addEventListener("change",render);$("customerSummarySearch").addEventListener("input",renderCustomerSummary);
  const dialog=$("shipmentDialog");
  function populateExistingCustomers(){
    const select=$("existingCustomerSelect");
    if(!select)return;
    const unique=new Map();
    state.shipments.forEach(s=>{
      const name=String(s.client_name||"").trim(),phone=String(s.client_phone||"").trim();
      if(!name)return;
      const key=(name.toLocaleLowerCase()+"|"+phone.replace(/\\s/g,""));
      if(!unique.has(key))unique.set(key,{name,phone});
    });
    select.innerHTML='<option value="">+ Муштарии нав</option>'+Array.from(unique.entries()).map(([key,c])=>'<option value="'+safe(JSON.stringify(c))+'">'+safe(c.name)+(c.phone?' · '+safe(c.phone):'')+'</option>').join("");
  }
  const openDialog=()=>{
    if(!state.user){toast("Аввал ворид шавед.");return;}
    if(!["owner","admin","accountant","operator"].includes(state.profile?.role)){toast("Барои сабти бор иҷозати корманд лозим аст.");return;}
    shipmentForm.reset();
    const dateField=shipmentForm.elements.shipment_date;
    if(dateField)dateField.value=new Date().toISOString().slice(0,10);
    populateExistingCustomers();
    const trackingField=shipmentForm.elements.tracking_number;
    if(trackingField) trackingField.value="";
    updateShipmentEstimate();
    $("formMessage").textContent="";
    dialog.showModal();
  };
  $("existingCustomerSelect").addEventListener("change",()=>{
    const raw=$("existingCustomerSelect").value;
    if(!raw)return;
    try{
      const customer=JSON.parse(raw);
      shipmentForm.elements.customer_name.value=customer.name||"";
      shipmentForm.elements.customer_phone.value=customer.phone||"";
    }catch(err){console.warn("Customer selection could not be parsed",err);}
  });
  $("addShipmentBtn").addEventListener("click",openDialog);$("addShipmentTop").addEventListener("click",openDialog);$("closeDialog").addEventListener("click",()=>dialog.close());
  const shipmentForm=$("shipmentForm");
  const moneyRates={USD:9.2361,TJS:1,CNY:1.3803};
  function generateTrackingNumber(){
    const d=new Date();
    const date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("");
    return "HNC-"+date+"-"+Math.random().toString(36).slice(2,7).toUpperCase();
  }
  function chooseBillingType(weight,volume){
    // Агар танҳо вазн ворид шавад — КГ; агар танҳо ҳаҷм ворид шавад — КУБ.
    // Агар ҳар ду ворид шаванд, зичӣ муайян мекунад: аз 200 кг/м³ боло — КГ.
    if(weight>0 && volume<=0) return "kg";
    if(volume>0 && weight<=0) return "cube";
    if(weight>0 && volume>0) return weight/volume>=200 ? "kg" : "cube";
    return "kg";
  }
  function updateShipmentEstimate(){
    const currency=shipmentForm.elements.currency.value;
    const weight=Number(shipmentForm.elements.weight_kg.value||0);
    const volume=Number(shipmentForm.elements.volume_m3.value||0);
    const type=chooseBillingType(weight,volume);
    const rate=Number(shipmentForm.elements.exchange_rate.value||0);
    const usdPrice=type==="kg"?1:200;
    const price=currency==="USD"?usdPrice:currency==="TJS"?usdPrice*moneyRates.USD:usdPrice*moneyRates.USD/moneyRates.CNY;
    const qty=type==="kg"?weight:volume;
    const original=qty*price;
    const tjs=original*rate;
    shipmentForm.elements.billing_type.value=type;
    shipmentForm.elements.unit_price.value=price.toFixed(2);
    const decision=$("billingDecision");
    if(decision) decision.textContent=type==="kg" ? (volume>0 ? "Ин бор бо КГ ҳисоб мешавад (зичӣ ≥ 200 кг/м³)" : "Вазн ворид шуд — барнома ҳисобро аз рӯи КГ мекунад.") : (weight>0 ? "Ин бор бо КУБ ҳисоб мешавад (зичӣ < 200 кг/м³)" : "Ҳаҷм ворид шуд — барнома ҳисобро аз рӯи КУБ мекунад.");
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
  const openExpenseForm = () => {
    if(!state.user){toast("Аввал ворид шавед.");return;}
    if(!["owner","admin","accountant"].includes(state.profile?.role)){toast("Барои сабти хароҷот иҷозати муҳосиб лозим аст.");return;}
    delete expenseForm.dataset.editId;
    expenseForm.reset();expenseForm.elements.expense_date.value=new Date().toISOString().slice(0,10);expenseForm.elements.currency.value="TJS";expenseForm.elements.fx_rate.value="1";$("expenseMessage").textContent="";expenseDialog.showModal();
  };
  $("quickExpenseBtn").addEventListener("click",openExpenseForm);
  $("addExpenseBtn").addEventListener("click",()=>{
    openExpenseForm();
  });
  $("closeExpenseDialog").addEventListener("click",()=>expenseDialog.close());
  // Админ/соҳиб метавонад хароҷотро таҳрир ё нест кунад.
  $("expenseRows").addEventListener("click",async e=>{
    const editButton=e.target.closest(".edit-expense");
    const button=e.target.closest(".delete-expense");
    if(!editButton&&!button)return;
    if(editButton&&!["owner","admin","accountant"].includes(state.profile?.role)){toast("Таҳрири хароҷот танҳо барои муҳосиб ё админ иҷозат аст.");return;}
    if(button&&!["owner","admin"].includes(state.profile?.role)){toast("Ҳазфи хароҷот танҳо барои админ иҷозат аст.");return;}
    const expenseId=(editButton||button).dataset.expenseId;
    const expense=state.expenses.find(item=>String(item.id)===expenseId);
    if(!expense){toast("Хароҷот ёфт нашуд. Рӯйхатро нав кунед.");return;}
    if(editButton){
      expenseForm.dataset.editId=String(expense.id);
      expenseForm.elements.category.value=expense.category||"";
      expenseForm.elements.amount.value=expense.amount_original??expense.amount??"";
      expenseForm.elements.currency.value=expense.currency||"TJS";
      expenseForm.elements.fx_rate.value=String(expense.fx_rate??expense.exchange_rate??1);
      expenseForm.elements.expense_date.value=expense.expense_date||new Date().toISOString().slice(0,10);
      expenseForm.elements.description.value=expense.description||expense.notes||"";
      $("expenseMessage").textContent="Ҳолати таҳрир: маълумотро ислоҳ карда, сабт кунед.";
      expenseDialog.showModal();
      return;
    }
    if(!window.confirm(`Хароҷоти «${expense.category||"бе категория"}» ба маблағи ${fmt(expense.amount_tjs)} сомонӣ нест карда шавад? Ин амал баргардонида намешавад.`))return;
    button.disabled=true;
    const result=await state.db.from("expenses").delete().eq("id",expense.id);
    if(result.error){
      console.error("Expense deletion failed",result.error);
      toast("Нест карда нашуд: "+result.error.message);
      button.disabled=false;
      return;
    }
    toast("Хароҷот нест карда шуд.");
    await loadData();
  });
  expenseForm.elements.currency.addEventListener("change",()=>{expenseForm.elements.fx_rate.value=String(expenseRates[expenseForm.elements.currency.value]||1);});
  const expenseSheetForm=$("expenseSheetForm");
  if(expenseSheetForm){
    expenseSheetForm.elements.expense_date.value=new Date().toISOString().slice(0,10);
    expenseSheetForm.elements.currency.addEventListener("change",()=>{
      const cur=expenseSheetForm.elements.currency.value;
      const rates={TJS:1,USD:9.2361,CNY:1.3803};
      expenseSheetForm.elements.fx_rate.value=String(rates[cur]||1);
    });
    expenseSheetForm.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!state.db||!state.user){$("expenseSheetMessage").textContent="Аввал ба система ворид шавед.";return;}
      if(!["owner","admin","accountant"].includes(state.profile?.role)){$("expenseSheetMessage").textContent="Барои сабти хароҷот иҷозати муҳосиб лозим аст.";return;}
      const f=new FormData(expenseSheetForm);
      const category=String(f.get("category")||"").trim(),amount=Number(f.get("amount")),currency=String(f.get("currency")||"TJS"),rate=Number(f.get("fx_rate")),expenseDate=String(f.get("expense_date")||""),description=String(f.get("description")||"").trim();
      if(!category||amount<=0||rate<=0||!expenseDate){$("expenseSheetMessage").textContent="Ҳамаи маълумоти заруриро дуруст пур кунед.";return;}
      const payload={category,currency,amount_original:amount,fx_rate:rate,amount_tjs:Number((amount*rate).toFixed(2)),expense_date:expenseDate,description,created_by:state.user.id};
      const saveButton=expenseSheetForm.querySelector('button[type="submit"]');saveButton.disabled=true;$("expenseSheetMessage").textContent="Сабт шуда истодааст…";
      const result=await state.db.from("expenses").insert(payload);
      saveButton.disabled=false;
      if(result.error){$("expenseSheetMessage").textContent="Хато: "+result.error.message;return;}
      expenseSheetForm.reset();expenseSheetForm.elements.expense_date.value=new Date().toISOString().slice(0,10);expenseSheetForm.elements.currency.value="TJS";expenseSheetForm.elements.fx_rate.value="1";
      $("expenseSheetMessage").textContent="Хароҷот сабт шуд. Ҳисобот худкор нав шуд.";await loadData();
    });
  }
  expenseForm.addEventListener("submit",async e=>{
    e.preventDefault();if(!state.db||!state.user)return;
    if(!["owner","admin","accountant"].includes(state.profile?.role)){ $("expenseMessage").textContent="Барои сабти хароҷот иҷозати муҳосиб лозим аст.";return;}
    const f=new FormData(expenseForm),category=String(f.get("category")).trim(),amount=Number(f.get("amount")),currency=String(f.get("currency")),rate=Number(f.get("fx_rate")),expenseDate=String(f.get("expense_date")),description=String(f.get("description")||"").trim();
    if(!category||amount<=0||rate<=0){$("expenseMessage").textContent="Категория, маблағ ва қурбро дуруст ворид кунед.";return;}
    $("expenseMessage").textContent="Сабт шуда истодааст…";
    const editId=expenseForm.dataset.editId;
    const payload={category,currency,amount_original:amount,fx_rate:rate,amount_tjs:Number((amount*rate).toFixed(2)),expense_date:expenseDate,description};
    const result=editId?await state.db.from("expenses").update(payload).eq("id",editId):await state.db.from("expenses").insert({...payload,created_by:state.user.id});
    if(result.error){$("expenseMessage").textContent=result.error.message;return;}
    delete expenseForm.dataset.editId;
    expenseDialog.close();toast(editId?"Хароҷот нав карда шуд.":"Хароҷот сабт шуд.");await loadData();
  });
  $("shipmentForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!state.db||!state.user)return;
    const f=new FormData(e.currentTarget),name=String(f.get("customer_name")).trim(),phone=String(f.get("customer_phone")).trim(),currency=String(f.get("currency")),rate=Number(f.get("exchange_rate")),weight=Number(f.get("weight_kg")||0),volume=Number(f.get("volume_m3")||0),arrivalDate=String(f.get("shipment_date")||""),type=chooseBillingType(weight,volume);
    if(weight<=0){$("formMessage").textContent="Вазни борро аз сифр зиёд ворид кунед.";return;}
    if(volume<=0){$("formMessage").textContent="Барои муайян кардани зичӣ ҳаҷми бор (м³)-ро низ ворид кунед. Танҳо вазн кофӣ нест.";return;}
    if(!type){$("formMessage").textContent="Вазн ва ҳаҷмро санҷед.";return;}
    if(!arrivalDate){$("formMessage").textContent="Санаи воридшавии борро интихоб кунед.";return;}
    if(!Number.isFinite(rate)||rate<=0){$("formMessage").textContent="Қурби асъор бояд дуруст бошад.";return;}
    const price=currency==="USD"?(type==="kg"?1:200):currency==="TJS"?(type==="kg"?moneyRates.USD:200*moneyRates.USD):(type==="kg"?moneyRates.USD/moneyRates.CNY:200*moneyRates.USD/moneyRates.CNY);
    const qty=type==="kg"?weight:volume,totalTjs=Number((qty*price*rate).toFixed(2));
    $("formMessage").textContent="Сабт шуда истодааст…";
    let result=null;
    for(let attempt=0;attempt<5;attempt++){
      const trackingNo=String(f.get("tracking_number")||"").trim();
      if(!trackingNo){$("formMessage").textContent="Рақами борро дастӣ ворид кунед.";return;}
      result=await state.db.from("shipments").insert({client_name:name,client_phone:phone,tracking_no:trackingNo,shipment_date:arrivalDate,billing_type:type,weight_kg:weight,volume_m3:volume,currency,unit_price:price,fx_rate:rate,total_original:Number((qty*price).toFixed(2)),total_tjs:totalTjs,notes:String(f.get("notes")||"").trim(),created_by:state.user.id});
      if(!result.error)break;
      if(result.error.code!=="23505" || !String(result.error.message||"").includes("tracking_no"))break;
    }
    if(result?.error){$("formMessage").textContent=result.error.message;return;}
    $("shipmentForm").reset();dialog.close();toast("Бор сабт шуд.");await loadData();
  });

  // Spreadsheet-style cargo workbook embedded in Reports.
  const cargoSheetKey="hoji-naim-cargo-sheet-v1";
  const cargoSheetRows=$("cargoSheetRows");
  const sheetNum=(v)=>Number(v)||0;
  const sheetMoney=(v)=>sheetNum(v).toFixed(2);
  const readCargoSheet=()=>{try{return JSON.parse(localStorage.getItem(cargoSheetKey)||"[]")}catch{return []}};
  let cargoSheetData=readCargoSheet();
  const cargoSheetMetaKey="hoji-naim-cargo-sheet-meta-v1";
  const cargoSheetMeta=(()=>{try{return JSON.parse(localStorage.getItem(cargoSheetMetaKey)||"{}")}catch{return {}}})();
  $("cargoSheetCode").value=cargoSheetMeta.code||"";
  $("cargoSheetPhone").value=cargoSheetMeta.phone||"";
  // The previous page stored 1 as a placeholder; replace that placeholder with the default CNY→TJS rate.
  if(!cargoSheetMeta.cnyRate||cargoSheetMeta.cnyRate===1)cargoSheetMeta.cnyRate=1.3803;
  $("cargoSheetCnyRate").value=cargoSheetMeta.cnyRate;
  ["cargoSheetCode","cargoSheetPhone","cargoSheetCnyRate"].forEach(id=>$(id).addEventListener("change",()=>{cargoSheetMeta.code=$("cargoSheetCode").value;cargoSheetMeta.phone=$("cargoSheetPhone").value;cargoSheetMeta.cnyRate=sheetNum($("cargoSheetCnyRate").value);localStorage.setItem(cargoSheetMetaKey,JSON.stringify(cargoSheetMeta));renderCargoSheet();}));
  const saveCargoSheet=()=>{try{localStorage.setItem(cargoSheetKey,JSON.stringify(cargoSheetData));$("cargoSheetStatus").textContent="Сабт шуд • "+new Date().toLocaleTimeString()}catch{$("cargoSheetStatus").textContent="Хато ҳангоми нигоҳдорӣ дар браузер."}};
  // Keep row calculations, totals, sync and export consistent with the workbook formulas.
  const cargoCalc=(r)=>{
    const places=sheetNum(r.places);
    const cube=sheetNum(r.height)*sheetNum(r.width)*sheetNum(r.length)*places;
    const kg=sheetNum(r.kgPerPlace)*places;
    const density=cube>0?kg/cube:0;
    const cubeAmount=cube*sheetNum(r.cubePrice??200);
    const kgAmount=kg*sheetNum(r.kgPrice??1);
    // Excel Q column chooses the larger charge: IF(cubeAmount > kgAmount, cubeAmount, kgAmount).
    const billingType=cubeAmount>kgAmount?"cube":"kg";
    const price=Math.max(cubeAmount,kgAmount);
    const paidAmount=sheetNum(r.paid);
    return {places,cube,kg,density,cubeAmount,kgAmount,billingType,price,paid:paidAmount,debt:Math.max(0,price-paidAmount)};
  };
  const renderCargoSheet=()=>{
    if(!cargoSheetRows)return;
    cargoSheetRows.innerHTML="";
    cargoSheetData.forEach((r,i)=>{
      const calc=cargoCalc(r);
      const tr=document.createElement("tr");
      const fields=[["date","date"],["customerCode","text"],["customerPhone","tel"],["shop","text"],["city","text"],["item","text"],["height","number"],["width","number"],["length","number"],["places","number"],["kgPerPlace","number"]];
      tr.innerHTML="<td class='sheet-row-no'>"+(i+1)+"</td>"+fields.map(([key,type])=>"<td><input data-key='"+key+"' type='"+type+"' "+(type==="number"?"min='0' step='any'":"")+" value='"+String(r[key]??"").replace(/&/g,"&amp;").replace(/'/g,"&#39;").replace(/</g,"&lt;")+"' aria-label='"+key+"'></td>").join("")+
      "<td class='sheet-calc'>"+sheetMoney(calc.cube)+"</td><td class='sheet-calc'>"+sheetMoney(calc.kg)+"</td><td><input data-key='cubePrice' type='number' min='0' step='any' value='"+(r.cubePrice??200)+"' aria-label='Нархи куб'></td><td class='sheet-calc'>"+sheetMoney(calc.cubeAmount)+"</td><td><input data-key='kgPrice' type='number' min='0' step='any' value='"+(r.kgPrice??1)+"' aria-label='Нархи кг'></td><td class='sheet-calc'>"+sheetMoney(calc.kgAmount)+"</td><td class='sheet-calc sheet-price'>"+sheetMoney(calc.price)+"</td><td><input data-key='paid' type='number' min='0' step='any' value='"+(r.paid??0)+"' aria-label='Пардохт доллар'></td><td class='sheet-calc'>"+(calc.cube>0?sheetMoney(calc.density):"—")+"</td><td><button type='button' class='sheet-delete' data-delete='"+i+"' title='Нест кардан'>×</button></td>";
      tr.querySelectorAll("input").forEach(input=>{
        input.addEventListener("input",()=>{cargoSheetData[i][input.dataset.key]=input.value;saveCargoSheet();});
        input.addEventListener("change",()=>{cargoSheetData[i][input.dataset.key]=input.value;saveCargoSheet();renderCargoSheet();});
      });
      tr.querySelector("[data-delete]").addEventListener("click",()=>{cargoSheetData.splice(i,1);saveCargoSheet();renderCargoSheet()});
      cargoSheetRows.appendChild(tr);
    });
    const totals=cargoSheetData.reduce((a,r)=>{
      const x=cargoCalc(r);
      a.places+=x.places;a.cube+=x.cube;a.kg+=x.kg;a.cubeAmount+=x.cubeAmount;a.kgAmount+=x.kgAmount;a.price+=x.price;a.paid+=x.paid;a.debt+=x.debt;
      return a;
    },{places:0,cube:0,kg:0,cubeAmount:0,kgAmount:0,price:0,paid:0,debt:0});
    $("sheetPlacesTotal").textContent=totals.places;
    $("sheetCubeTotal").textContent=sheetMoney(totals.cube);
    $("sheetKgTotal").textContent=sheetMoney(totals.kg);
    $("sheetCubeChargeTotal").textContent=sheetMoney(totals.cubeAmount);
    $("sheetKgChargeTotal").textContent=sheetMoney(totals.kgAmount);
    $("sheetPriceTotal").textContent=sheetMoney(totals.price);
    $("sheetPaidTotal").textContent=sheetMoney(totals.paid);
    $("sheetDebtTotal").textContent=sheetMoney(totals.debt);
    const cnyToTjs=sheetNum($("cargoSheetCnyRate").value);
    $("sheetYuanTotal").textContent=sheetMoney(cnyToTjs>0?totals.price*9.2361/cnyToTjs:0);
    $("sheetSomoniTotal").textContent=sheetMoney(totals.price*9.2361);
  };
  $("addCargoSheetRow").addEventListener("click",()=>{cargoSheetData.push({date:new Date().toISOString().slice(0,10),cubePrice:200,kgPrice:1});saveCargoSheet();renderCargoSheet();const last=cargoSheetRows.lastElementChild;last?.querySelector("input[data-key='shop']")?.focus()});
  $("clearCargoSheet").addEventListener("click",()=>{if(confirm("Ҳамаи сатрҳои дафтари Excel тоза шаванд?")){cargoSheetData=[];saveCargoSheet();renderCargoSheet()}});
  const sheetRateToTjs=9.2361;
  const stableUuid=()=>crypto.randomUUID();
  $("syncCargoSheet").addEventListener("click",async()=>{
    if(!state.db||!state.user){toast("Аввал ба система ворид шавед.");return;}
    if(!["owner","admin","accountant","operator"].includes(state.profile?.role)){toast("Барои синхронсозӣ иҷозати корманд лозим аст.");return;}
    const rows=cargoSheetData.filter(r=>r.customerCode||r.shop||r.item||sheetNum(r.places)||sheetNum(r.kgPerPlace));
    if(!rows.length){toast("Аввал дар дафтар ҳадди ақал як борро пур кунед.");return;}
    const btn=$("syncCargoSheet");btn.disabled=true;btn.textContent="Сабт шуда истодааст…";
    try{
      for(const r of rows){
        const calc=cargoCalc(r);
        const {cube,kg,density,billingType,price:original}=calc;
        const unitPrice=billingType==="kg"?sheetNum(r.kgPrice??1):sheetNum(r.cubePrice??200);
        const code=String(r.customerCode||cargoSheetMeta.code||"").trim();
        if(!r.syncTrackingNo){const date=String(r.date||new Date().toISOString().slice(0,10)).replace(/-/g,"");const safeCode=(code||"CLIENT").replace(/[^a-zA-Z0-9]/g,"").slice(0,12)||"CLIENT";r.syncTrackingNo="SHEET-"+date+"-"+safeCode+"-"+stableUuid().slice(0,8).toUpperCase();}
        const customerPhone=String(r.customerPhone||cargoSheetMeta.phone||"").trim();
        const notes=["Дафтари Excel",code?"Коди муштарӣ: "+code:"",customerPhone?"Телефон: "+customerPhone:"",r.city?"Шаҳр: "+r.city:"",r.item?"Мол: "+r.item:"","Андоза: "+[r.height||0,r.width||0,r.length||0].join(" × ")+" м","Мағоза: "+(r.shop||"—")].filter(Boolean).join("; ");
        saveCargoSheet();
        const payload={client_name:String(code||r.shop||"Муштарӣ"),client_phone:customerPhone,tracking_no:r.syncTrackingNo,shipment_date:r.date||new Date().toISOString().slice(0,10),billing_type:billingType,weight_kg:kg,volume_m3:cube,currency:"USD",unit_price:unitPrice,fx_rate:sheetRateToTjs,total_original:Number(original.toFixed(2)),total_tjs:Number((original*sheetRateToTjs).toFixed(2)),notes,created_by:state.user.id};
        const {data:ship,error}=await state.db.from("shipments").upsert(payload,{onConflict:"tracking_no"}).select("id").single();if(error)throw error;
        if(sheetNum(r.paid)>0){
          if(!r.syncPaymentId)r.syncPaymentId=stableUuid();
          const payment={id:r.syncPaymentId,shipment_id:ship.id,currency:"USD",amount_original:sheetNum(r.paid),fx_rate:sheetRateToTjs,amount_tjs:Number((sheetNum(r.paid)*sheetRateToTjs).toFixed(2)),payment_date:r.date||new Date().toISOString().slice(0,10),notes:"Пардохти аз дафтари Excel · "+(code||r.syncTrackingNo),created_by:state.user.id};
          const {error:payError}=await state.db.from("payments").upsert(payment,{onConflict:"id"});if(payError)throw payError;
        }else if(r.syncPaymentId){
          const {error:delError}=await state.db.from("payments").delete().eq("id",r.syncPaymentId);if(delError)throw delError;delete r.syncPaymentId;
        }
      }
      saveCargoSheet();await loadData();$("cargoSheetStatus").textContent="Дафтар бо система синхрон шуд · "+new Date().toLocaleTimeString();toast("Борҳои дафтар ба саҳифаҳои сайт гузаштанд.");
    }catch(err){console.error("Cargo sheet sync error:",err);$("cargoSheetStatus").textContent="Хатои синхронсозӣ: "+(err.message||"хатои база");toast("Синхронсозӣ ноком шуд: "+(err.message||"ҷадвал ё иҷозати база санҷида шавад."));}
    finally{btn.disabled=false;btn.textContent="↻ Сабт дар система";}
  });
  $("exportCargoSheet").addEventListener("click",()=>{
    const headers=["№","Сана","Коди клиент","Телефони клиент","Мағоза","Шаҳр","Номи мол","Баландӣ","Паҳноӣ","Дарозӣ","Ҷой","Кг барои ҷой","Ҳамагӣ м3","Ҳамагӣ кг","Нархи куб","Сумма за куб USD","Нархи кг","Сумма за кг USD","Нархи ниҳоӣ USD","Пардохт USD","Қарз USD","Зичӣ кг/м3"];
    const rows=cargoSheetData.map((r,i)=>{const x=cargoCalc(r);return [i+1,r.date,r.customerCode,r.customerPhone||cargoSheetMeta.phone||"",r.shop,r.city,r.item,r.height,r.width,r.length,x.places,r.kgPerPlace,x.cube,x.kg,r.cubePrice??200,x.cubeAmount,r.kgPrice??1,x.kgAmount,x.price,x.paid,x.debt,x.cube?x.density:""]});
    const csv="\uFEFF"+[headers,...rows].map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="HOJI-NAIM-Excel-"+new Date().toISOString().slice(0,10)+".csv";a.click();URL.revokeObjectURL(url);
  });
  renderCargoSheet();

  $("exportCsv").addEventListener("click",()=>{const rows=[["Муштарӣ","Телефон","Рақами бор","Вазн кг","Ҳаҷм м3","Ҳисоб TJS","Пардохт TJS","Қарз TJS"],...state.shipments.map(s=>[s.client_name||"",s.client_phone||"",s.tracking_no||"",s.weight_kg||0,s.volume_m3||0,total(s),paid(s),debt(s)])];const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download="hoji-naim-cargo-report.csv";a.click();URL.revokeObjectURL(url);});
  $("language").addEventListener("change",e=>{const lang=e.target.value,labels={tg:{dashboard:"Асосӣ",shipments:"Борҳо",payments:"Пардохтҳо",expenses:"Расходҳо",reports:"Ҳисобот"},ru:{dashboard:"Главная",shipments:"Грузы",payments:"Платежи",expenses:"Расходы",reports:"Отчёты"},en:{dashboard:"Dashboard",shipments:"Shipments",payments:"Payments",expenses:"Expenses",reports:"Reports"}};document.querySelectorAll("[data-i18n]").forEach(el=>el.textContent=labels[lang][el.dataset.i18n]);});
  start().catch(err=>{console.error(err);$("connectionStatus").textContent="Хатои оғоз";toast("Системаро оғоз карда натавонистем.");});
})();