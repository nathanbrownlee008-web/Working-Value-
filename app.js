
const SUPABASE_URL="https://krmmmutcejnzdfupexpv.supabase.co";
const SUPABASE_KEY="sb_publishable_3NHjMMVw1lai9UNAA-0QZA_sKM21LgD";
const client=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);


// ===== Paywall (Free 10) + Subscriber Role =====
const FREE_BETS_LIMIT = 10;

let currentUser = null;
let currentProfile = null;
let isSubscriber = false;

function nowISO(){ return new Date().toISOString(); }

function computeSubscriber(profile){
  if(!profile) return false;
  if(profile.is_subscriber === true) return true;

  const now = new Date();

  if(profile.trial_ends_at){
    const t = new Date(profile.trial_ends_at);
    if(!Number.isNaN(t.getTime()) && now < t) return true;
  }

  if(profile.subscription_ends_at){
    const s = new Date(profile.subscription_ends_at);
    if(!Number.isNaN(s.getTime()) && now < s) return true;
  }

  return false;
}

async function loadProfile(){
  const { data: sess } = await client.auth.getSession();
  currentUser = sess?.session?.user || null;
  if(!currentUser){
    currentProfile = null;
    isSubscriber = false;
    return;
  }
  // Fetch profile row
  const { data, error } = await client
    .from("profiles")
    .select("id,email,is_subscriber,trial_ends_at,subscription_ends_at,intro_price_used,offer_chosen,created_at")
    .eq("id", currentUser.id)
    .maybeSingle();

  if(error){
    console.warn("profiles read error:", error.message);
    currentProfile = null;
    isSubscriber = false;
    return;
  }
  currentProfile = data || null;
  isSubscriber = computeSubscriber(currentProfile);
}

function setPaywallBanner(html){
  const el = document.getElementById("paywallBanner");
  if(!el) return;
  if(!html){
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "flex";
  el.innerHTML = html;
}

function openAuthModal(){
  const m = document.getElementById("authModal");
  if(!m) return;
  m.style.display = "flex";
  m.setAttribute("aria-hidden","false");
}
function closeAuthModal(){
  const m = document.getElementById("authModal");
  if(!m) return;
  m.style.display = "none";
  m.setAttribute("aria-hidden","true");
}

async function refreshGateUI(){
  await loadProfile();

  // Tabs lock: Tracker + History locked unless subscriber
  const tTracker = document.getElementById("tabTracker");
  const tHistory = document.getElementById("tabHistory");
  const lockText = "🔒 Subscribers only";
  if(tTracker){
    tTracker.dataset.locked = (!isSubscriber).toString();
    tTracker.title = (!isSubscriber) ? lockText : "";
  }
  if(tHistory){
    tHistory.dataset.locked = (!isSubscriber).toString();
    tHistory.title = (!isSubscriber) ? lockText : "";
  }

  // Banner (Value Bets)
  if(isSubscriber){
    let extra = "";
    if(currentProfile?.trial_ends_at && currentProfile?.is_subscriber !== true){
      extra = ` <span style="opacity:.85;">(Trial ends ${new Date(currentProfile.trial_ends_at).toLocaleDateString()})</span>`;
    }
    setPaywallBanner(`
      <div class="pw-left">✅ Full access unlocked${extra}</div>
      <div class="pw-actions">
        <button class="pw-btn" id="pwLogout" style="${currentUser ? "" : "display:none;"}">Log out</button>
      </div>
    `);
    const b = document.getElementById("pwLogout");
    if(b) b.onclick = async ()=>{ await client.auth.signOut(); await refreshGateUI(); };
    return;
  }

  // Not subscriber (guest or logged-in non-subscriber)
  const loggedIn = !!currentUser;
  const trialActive = currentProfile?.trial_ends_at && new Date(currentProfile.trial_ends_at) > new Date();
  const subActive = currentProfile?.subscription_ends_at && new Date(currentProfile.subscription_ends_at) > new Date();
  const offerChosen = (currentProfile?.offer_chosen || "").toLowerCase(); // 'trial' or 'intro'
  const introUsed = currentProfile?.intro_price_used === true || offerChosen === "intro";
  const trialUsed = offerChosen === "trial";

  const msg = loggedIn
    ? `Free preview: first <strong>${FREE_BETS_LIMIT}</strong> bets only. Subscribe to unlock the rest.`
    : `Free preview: first <strong>${FREE_BETS_LIMIT}</strong> bets only. Log in for more + subscriber access.`;

  // Trial: available to everyone (one-time), 5 days. Intro: first 50 only (one-time).
  const showTrialBtn = loggedIn && !trialActive && !subActive && !introUsed && !trialUsed;
  const showIntroBtn = loggedIn && !trialActive && !subActive && !introUsed && !trialUsed;

  const actions = `
    <button class="pw-btn primary" id="pwLogin">${loggedIn ? "Switch account" : "Log in / Sign up"}</button>
    <button class="pw-btn warn" id="pwTrial" style="${showTrialBtn ? "" : "display:none;"}">Claim 5‑day free trial</button>
    <button class="pw-btn warn" id="pwIntro" style="${showIntroBtn ? "" : "display:none;"}">Get 1st month £5 (first 50)</button>
  `;

  setPaywallBanner(`
    <div class="pw-left">${msg}</div>
    <div class="pw-actions">${actions}</div>
  `);

  const l = document.getElementById("pwLogin");
  if(l) l.onclick = ()=>openAuthModal();

  const t = document.getElementById("pwTrial");
  if(t) t.onclick = async ()=>{
    t.disabled = true;
    try{
      const { error } = await client.rpc("claim_trial");
      if(error) throw error;
      await refreshGateUI();
      try{ await loadBets(); }catch(e){}
    }catch(e){
      alert(e?.message || "Could not claim trial.");
    }finally{
      t.disabled = false;
    }
  };

  const intro = document.getElementById("pwIntro");
  if(intro) intro.onclick = async ()=>{
    intro.disabled = true;
    try{
      const { error } = await client.rpc("claim_intro_offer");
      if(error) throw error;
      await refreshGateUI();
      try{ await loadBets(); }catch(e){}
    }catch(e){
      alert(e?.message || "Could not claim intro offer.");
    }finally{
      intro.disabled = false;
    }
  };
}

// Intercept tab clicks for locked tabs
function wireTabLocks(){
  const tTracker = document.getElementById("tabTracker");
  const tHistory = document.getElementById("tabHistory");
  const handler = (e)=>{
    if(isSubscriber) return;
    e.preventDefault();
    e.stopPropagation();
    openAuthModal();
  };
  if(tTracker){
    tTracker.addEventListener("click", (e)=>{
      if(tTracker.dataset.locked === "true") handler(e);
    }, true);
  }
  if(tHistory){
    tHistory.addEventListener("click", (e)=>{
      if(tHistory.dataset.locked === "true") handler(e);
    }, true);
  }
}

// Auth modal wiring
(function initAuthModal(){
  const m = document.getElementById("authModal");
  if(m){
    m.addEventListener("click", (e)=>{
      const tgt = e.target;
      if(tgt && tgt.getAttribute && tgt.getAttribute("data-close") === "1") closeAuthModal();
    });
  }
  const x = document.getElementById("authClose");
  if(x) x.addEventListener("click", closeAuthModal);
})();


// ===== End Paywall (Free 10) + Subscriber Role =====


const bankrollElem=document.getElementById("bankroll");
const profitElem=document.getElementById("profit");
const roiElem=document.getElementById("roi");
const winrateElem=document.getElementById("winrate");
const winsElem=document.getElementById("wins");
const lossesElem=document.getElementById("losses");
const avgOddsElem=document.getElementById("avgOdds");
const profitCard=document.getElementById("profitCard");

// Track which feed items have been added to the tracker (prevents duplicate clicks + changes button UI)
const addedKeys = new Set();

function makeBetKey(row){
  // Prefer stable IDs if present
  if(row && row.id != null) return `id:${row.id}`;
  const m = row?.match ?? '';
  const mk = row?.market ?? '';
  const o = row?.odds ?? '';
  const d = row?.bet_date ?? row?.match_date ?? row?.created_at ?? '';
  return `k:${m}|${mk}|${o}|${d}`;
}

// Top navigation tabs
const tabHistoryEl = document.getElementById("tabHistory");
const historySectionEl = document.getElementById("historySection");
const historyDaySelectEl = document.getElementById("historyDaySelect");
const historyListEl = document.getElementById("historyList");

if(historyListEl){
  historyListEl.addEventListener("click",(e)=>{
    const btn = e.target.closest(".history-toggle");
    if(!btn) return;
    const dayKey = btn.dataset.day;
    if(!dayKey) return;
    // Daily History accordion: default collapsed, store open state per day.
    window.__historyOpen = window.__historyOpen || {};
    window.__historyOpen[dayKey] = !window.__historyOpen[dayKey];
    renderHistory();
  });
}
const historySummaryEl = document.getElementById("historySummary");
const historyRefreshEl = document.getElementById("historyRefresh");

let currentTopTab = "bets"; // 'bets' | 'tracker' | 'history'
let trackerRowsCache = [];

tabBets.onclick=()=>switchTab("bets");
tabTracker.onclick=()=>switchTab("tracker");
if(tabHistoryEl) tabHistoryEl.onclick=()=>switchTab("history");

function switchTab(tab){
  currentTopTab = tab;
  initChartTabs();

  betsSection.style.display=(tab==="bets")?"block":"none";
  trackerSection.style.display=(tab==="tracker")?"block":"none";
  if(historySectionEl) historySectionEl.style.display=(tab==="history")?"block":"none";

  tabBets.classList.toggle("active",tab==="bets");
  tabTracker.classList.toggle("active",tab==="tracker");
  if(tabHistoryEl) tabHistoryEl.classList.toggle("active",tab==="history");

  if(tab!=="bets"){
    loadTracker().then(()=>{
      if(tab==="history") renderHistory();
    });
  }
}



async function loadBets(){
  // Rebuild "Added" state from tracker every time we render the feed.
  // This ensures that if a bet is deleted from the tracker, the feed button returns to "Add".
  addedKeys.clear();
  // Preload tracker rows so already-added bets render as "Added"
  try{
    const { data: tdata, error: terr } = await client
      .from("bet_tracker")
      .select("match,market,odds")
      .limit(1000);
    if(!terr && Array.isArray(tdata)){
      tdata.forEach(r => addedKeys.add(makeBetKey(r)));
    }
  }catch(e){
    // Ignore preload failures
  }

  // Fetch bets with a real paywall:
  // - Not logged in: only returns the first 10 bets for today via RPC (database-enforced).
  // - Logged in + subscriber: can read the full feed via RLS.
  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData?.session || null;

  let data = null;
  if(!session){
    const today = new Date().toISOString().slice(0,10);
    const res = await client.rpc("get_public_value_bets", { p_date: today });
    data = res.data;
  } else {
    const res = await client.from("value_bets_feed")
      .select("*")
      .order("value_pct",{ascending:false,nullsFirst:false})
      .order("created_at",{ascending:false});
    data = res.data;
  }

  betsGrid.innerHTML="";
  if(!data || !data.length){ betsGrid.innerHTML = `<div class="card">No bets available.</div>`; return; }

  (data || []).forEach(row=>{
  const key = makeBetKey(row);
  const isAdded = addedKeys.has(key);
betsGrid.innerHTML+=`
<div class="card bet-card ${row.high_value ? 'bet-card--hv' : ''}">
  <h3 class="bet-title">${row.match}</h3>
  <div class="bet-meta">
    <span class="bet-market">${row.market}</span>
    <span class="bet-date">${row.bet_date || (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '')}</span>
  </div>
  <div class="bet-stats">
    <span class="stat-chip"><span class="stat-chip__k">Value</span><span class="stat-chip__v">${(row.value_pct ?? row.value_percent ?? row.value_percentage ?? row.value) != null ? Number(row.value_pct ?? row.value_percent ?? row.value_percentage ?? row.value).toFixed(1)+'%' : '—'}</span></span>
  </div>
  <div class="bet-footer">
    <span class="odds-badge">Odds <strong>${row.odds}</strong></span>
    <button class="bet-btn ${isAdded ? 'added' : ''}" ${isAdded ? 'disabled' : ''} onclick='addToTracker(this, ${JSON.stringify(row)})'>${isAdded ? 'Added' : 'Add'}</button>
  </div>
</div>`;
});

  if(!session){
    const pay = document.createElement("div");
    pay.className = "card paywall-card";
    pay.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:18px;margin-bottom:4px;">Unlock the full list</div>
          <div style="opacity:.85;">You’re viewing the first <b>${Math.min(10,(data||[]).length)}</b> bets for today. Log in to see all bets.</div>
        </div>
        <button class="pill-btn" id="openLoginFromPaywall">Log in / Sign up</button>
      </div>
    `;
    betsGrid.appendChild(pay);
    const btn = pay.querySelector("#openLoginFromPaywall");
    btn?.addEventListener("click", ()=>{
      openAuthModal();
    });
  }
}


async function addToTracker(btn, row){
  const key = makeBetKey(row);
  if(addedKeys.has(key)) return;

  // Optimistic UI
  if(btn){
    btn.disabled = true;
    btn.textContent = 'Adding…';
  }

  const payload = {
    match: row.match,
    market: row.market,
    odds: row.odds,
    stake: 10,
    result: "pending"
  };

  const { data, error } = await client
    .from("bet_tracker")
    .insert([payload])
    .select();

  if(error){
    console.error("Insert failed:", error);
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Add';
    }
    return;
  }

  addedKeys.add(key);
  if(btn){
    btn.textContent = 'Added';
    btn.classList.add('added', 'flash');
    // remove the flash class after animation
    setTimeout(()=>btn.classList.remove('flash'), 700);
    btn.disabled = true;
  }
  loadTracker();
}


// ===== Insights (dropdown) =====
const insightStore = {
  bestMarket: { label: "Best Market", value: "—" },
  worstMarket: { label: "Worst Market", value: "—" },
  bestMonth:  { label: "Best Month",  value: "—" },
  worstMonth: { label: "Worst Month", value: "—" },
};

function setInsight(key, value){
  if(!insightStore[key]) return;
  insightStore[key].value = value;
  const hidden = document.getElementById(key);
  if(hidden) hidden.textContent = value;
}

function updateInsightUI(){
  const sel = document.getElementById("insightSelect");
  const labelEl = document.getElementById("insightLabel");
  const valueEl = document.getElementById("insightValue");
  if(!sel || !labelEl || !valueEl) return;
  const key = sel.value || "bestMarket";
  labelEl.textContent = insightStore[key]?.label || "Insights";
  valueEl.textContent = insightStore[key]?.value || "—";
}

document.addEventListener("change", (e)=>{
  if(e.target && e.target.id === "insightSelect"){
    updateInsightUI();
  }
});


// ===== Tracker Filters (Bet Results) =====
let trackerAllRows = [];

function _rowGameDateISO(row){
  const raw = row.match_date_date || row.match_date || row.bet_date || row.created_at;
  if(!raw) return "";
  const d = new Date(raw);
  if(isNaN(d.getTime())) return "";
  return d.toISOString().slice(0,10); // YYYY-MM-DD
}

function _applyTrackerFilters(rows){
  const dateEl = document.getElementById("filterDate");
  const marketEl = document.getElementById("filterMarket");
  const dateVal = dateEl ? (dateEl.value || "") : "";
  const marketVal = marketEl ? (marketEl.value || "").trim().toLowerCase() : "";

  return (rows || []).filter(r=>{
    // date filter
    if(dateVal){
      const iso = _rowGameDateISO(r);
      if(iso !== dateVal) return false;
    }
    // market filter (matches market OR match text)
    if(marketVal){
      const m = (r.market || "").toLowerCase();
      const match = (r.match || "").toLowerCase();
      if(!m.includes(marketVal) && !match.includes(marketVal)) return false;
    }
    return true;
  });
}

function _buildTrackerTableHTML(rows){
  let html = `<table>
    <tr>
      <th>Date</th>
      <th>Match</th>
      <th>Stake</th>
      <th>Result</th>
      <th class="profit-col">Profit</th>
    </tr>`;
  (rows || []).forEach(row=>{
    const stakeVal = row.stake ?? 0;
    const res = row.result || "pending";
    let profit = 0;
    if(res === "won") profit = (row.profit != null ? row.profit : row.stake * (row.odds - 1));
    if(res === "lost") profit = (row.profit != null ? row.profit : -row.stake);
    if(res === "pending") profit = 0;

    const profitClass = profit >= 0 ? "profit-win" : "profit-loss";
    const profitText = (profit >= 0 ? `£${profit.toFixed(2)}` : `£${profit.toFixed(2)}`);

    const dateLabel = fmtLabel(row.match_date_date || row.match_date || row.bet_date || row.created_at);

    html += `<tr>
      <td class="date-col">${dateLabel}</td>
      <td>${row.match || ""}</td>
      <td><input class="stake-input" type="number" value="${stakeVal}" data-id="${row.id}" data-field="stake"></td>
      <td>
        <select class="result-select result-${res}" data-id="${row.id}" data-field="result">
          <option value="pending" ${res==="pending"?"selected":""}>pending</option>
          <option value="won" ${res==="won"?"selected":""}>won</option>
          <option value="lost" ${res==="lost"?"selected":""}>lost</option>
        </select>
      </td>
      <td class="profit-col ${profitClass}">${profitText}</td>
    </tr>`;
  });
  html += `</table>`;
  return html;
}

function _renderFilteredTrackerTable(){
  const tableEl = document.getElementById("trackerTable");
  const countEl = document.getElementById("betCount");
  if(!tableEl) return;

  const filtered = _applyTrackerFilters(trackerAllRows);
  tableEl.innerHTML = _buildTrackerTableHTML(filtered);
  if(countEl) countEl.textContent = filtered.length;

  // re-bind inline input/select listeners for edited rows
  bindTrackerTableInputs();
}

let _filtersWired = false;
function wireTrackerFilters(){
  if(_filtersWired) return;
  _filtersWired = true;

  const dateEl = document.getElementById("filterDate");
  const marketEl = document.getElementById("filterMarket");
  const todayBtn = document.getElementById("todayToggle");
  const clearBtn = document.getElementById("clearFilters");

  if(dateEl) dateEl.addEventListener("change", _renderFilteredTrackerTable);
  if(marketEl) marketEl.addEventListener("input", _renderFilteredTrackerTable);

  if(todayBtn){
    todayBtn.addEventListener("click", ()=>{
      if(dateEl){
        const today = new Date();
        dateEl.value = today.toISOString().slice(0,10);
      }
      _renderFilteredTrackerTable();
    });
  }

  if(clearBtn){
    clearBtn.addEventListener("click", ()=>{
      if(dateEl) dateEl.value = "";
      if(marketEl) marketEl.value = "";
      _renderFilteredTrackerTable();
    });
  }
}

let dailyChart;
let monthlyChart;
let marketChart;

function fmtDayLabel(d){
  if(!d) return "";
  const dt = new Date(d);
  if(Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function escapeHtml(str){
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------
// Daily History (derived from bet_tracker)
// ---------------------------

function dayKeyFromRow(r){
  if(r && r.match_date){
    const s = String(r.match_date).slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  const raw = r?.bet_date || r?.created_at;
  if(!raw) return "";
  const d = new Date(raw);
  if(Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0,10);
}

function formatDayLabelLong(dayKey){
  const d = new Date(dayKey + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function renderHistory(){
  const iconFor = (res)=>{
    if(res==='won') return '✅';
    if(res==='lost') return '❌';
    return '⏳';
  };

  if(!historySummaryEl || !historyListEl) return;

  const rows = Array.isArray(trackerRowsCache) ? trackerRowsCache : [];
  const groups = {};
  for(const b of rows){
    const dayKey = (b.created_at || "").slice(0,10);
    if(!dayKey) continue;
    (groups[dayKey] ||= []).push(b);
  }

  const dayKeys = Object.keys(groups).sort((a,b)=> b.localeCompare(a));
  historySummaryEl.innerHTML = "";

  window.__historyOpen = window.__historyOpen || {};

  const fmtDay = (dayKey)=>{
    const d = new Date(dayKey + "T00:00:00");
    if(Number.isNaN(d.getTime())) return dayKey;
    // "01 Mar 2026"
    return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
  };

  const renderBet = (b)=>{
    const result = (b.result || "pending").toLowerCase();
    const cls = (result==="won"||result==="lost") ? result : "pending";
    const match = (b.match || "").toString().trim() || "—";
    const market = (b.market || "").toString().trim() || "—";
    const odds = (b.odds ?? "").toString().trim() || "—";

    return `
      <tr class="history-row ${cls}">
        <td class="hcell-match">${escapeHtml(match)}</td>
        <td class="hcell-market">${escapeHtml(market)}</td>
        <td class="hcell-odds">${escapeHtml(odds)}</td>
        <td class="hcell-result" aria-label="${cls}">${iconFor(cls)}</td>
      </tr>
    `;
  };

  let html = "";
  for(const dayKey of dayKeys){
    if(window.__historyOpen[dayKey] === undefined) window.__historyOpen[dayKey] = false;

    const bets = groups[dayKey].slice().sort((a,b)=> (a.id||0)-(b.id||0));
    const won = bets.filter(b => (b.result||"pending").toLowerCase()==="won").length;
    const lost = bets.filter(b => (b.result||"pending").toLowerCase()==="lost").length;
    const pending = bets.length - won - lost;

    const settled = won + lost;
    const ratio = `${won}/${settled || 0}`;

    const collapsed = !window.__historyOpen[dayKey];

    html += `
      <div class="history-day ${collapsed ? "collapsed" : ""}" id="history-day-${dayKey}">
        <button class="monthly-toggle daily-toggle history-toggle" data-day="${dayKey}">
          <div class="daily-toggle-left">📅 <span>${fmtDay(dayKey)}</span></div>
          <div class="daily-toggle-right">
            <span class="history-day-ratio">${ratio}</span>
            <span class="daily-chevron">${collapsed ? "▼" : "▲"}</span>
          </div>
        </button>

        <div class="history-day-chips day-stats">
          <div class="history-chip won">✅ <span>Won</span> <strong>${won}</strong></div>
          <div class="history-chip lost">❌ <span>Lost</span> <strong>${lost}</strong></div>
          <div class="history-chip pending">⏳ <span>Pending</span> <strong>${pending}</strong></div>
        </div>

        <div class="history-day-bets">
          <div class="history-table-wrap">
            <table class="history-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Market</th>
                  <th class="th-odds">Odds</th>
                  <th class="th-res"></th>
                </tr>
              </thead>
              <tbody>
                ${bets.map(renderBet).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  if(!dayKeys.length){
    html = `<div class="empty">No history yet.</div>`;
  }

  historyListEl.innerHTML = html;
}

function isEndOfDay(index, labels){
  if(!labels || !labels.length) return false;
  if(index === labels.length - 1) return true;
  return labels[index] !== labels[index + 1];
}

function renderDailyChart(history, labels){
if(dailyChart) dailyChart.destroy();
const ctx=document.getElementById("chart").getContext("2d");
dailyChart=new Chart(ctx,{
type:"line",
data:{
labels:(labels && labels.length===history.length) ? labels : history.map((_,i)=>i+1),
datasets:[{
data:history,
tension:0.25,
fill:true,
backgroundColor:"rgba(34,197,94,0.08)",
borderColor:"#22c55e",
borderWidth:2,
	// Show dots ONLY on the last point of each day
	pointRadius:(c)=> isEndOfDay(c.dataIndex, labels) ? 5 : 0,
	pointHoverRadius:(c)=> isEndOfDay(c.dataIndex, labels) ? 7 : 0,
	pointBackgroundColor:"#22c55e",
	pointBorderWidth:0
}]
},
	options:{
	  responsive:true,
	  maintainAspectRatio:false,
	  interaction:{ mode:"nearest", intersect:true },
	  scales:{
	    y:{ ticks:{ callback:(v)=> `£${v}` } },
	    x:{
	      ticks:{
	        callback:function(value, index){
	          const label = this.getLabelForValue(value);
	          if(index === 0) return label;
	          return label !== labels[index - 1] ? label : "";
	        }
	      }
	    }
	  },
	  plugins:{
	    legend:{display:false},
	    tooltip:{
	      enabled:true,
	      callbacks:{
	        label:(ctx)=> `£${Number(ctx.parsed.y).toFixed(2)}`
	      }
	    }
	  }
	}
});
}

async function loadTracker(){
const {data}=await client.from("bet_tracker").select("*").order("created_at",{ascending:true});
const rows = data || [];
trackerRowsCache = rows;
trackerAllRows = rows;
wireTrackerFilters();

let start=parseFloat(document.getElementById("startingBankroll").value);
let bankroll=start,profit=0,wins=0,losses=0,totalStake=0,totalOdds=0,history=[];

	let html="<table><tr><th class='date-col'>Date</th><th>Match</th><th>Stake</th><th>Result</th><th class='profit-col'>Profit</th></tr>";

rows.forEach(row=>{
let p=0;
if(row.result==="won"){p=row.stake*(row.odds-1);wins++;}
if(row.result==="lost"){p=-row.stake;losses++;}
profit+=p;totalStake+=row.stake;totalOdds+=row.odds;
bankroll=start+profit;history.push(bankroll);

const gameDate = row.match_date_date || row.bet_date || row.created_at;
html+=`<tr>
<td class="date-col">${fmtDayLabel(gameDate)}</td><td>${row.match}</td>
<td><input type="number" value="${row.stake}" onchange="updateStake('${row.id}',this.value)"></td>
<td>
<select 
class="result-select result-${row.result}" 
onchange="updateResult('${row.id}',this.value)">
<option value="pending" ${row.result==="pending"?"selected":""}>pending</option>
<option value="won" ${row.result==="won"?"selected":""}>won</option>
<option value="lost" ${row.result==="lost"?"selected":""}>lost</option>
<option value="delete">🗑 delete</option>
</select>
</td>
<td class="profit-col">
<span class="${p>0?'profit-win':p<0?'profit-loss':''}">£${p.toFixed(2)}</span>
</td>
</tr>`;
});

html+="</table>";
trackerTable.innerHTML=html;

bankrollElem.innerText=bankroll.toFixed(2);
profitElem.innerText=profit.toFixed(2);
roiElem.innerText=totalStake?((profit/totalStake)*100).toFixed(1):0;
winrateElem.innerText=(wins+losses)?((wins/(wins+losses))*100).toFixed(1):0;
const wonLostElem = document.getElementById("wonLost");
if(wonLostElem){
  wonLostElem.innerText = `${wins}-${losses}`;
}

const totalBets = rows.length;
const totalElem = document.getElementById("totalBets");
if(totalElem) totalElem.innerText = totalBets;
const totalStakedCard = document.getElementById("totalStakedCard");
if(totalStakedCard){
  totalStakedCard.innerText = totalStake.toFixed(2);
}


avgOddsElem.innerText=rows.length?(totalOdds/rows.length).toFixed(2):0;

profitCard.classList.remove("glow-green","glow-red");
if(profit>0) profitCard.classList.add("glow-green");
if(profit<0) profitCard.classList.add("glow-red");


// Daily labels based on the *game* date when available
const dailyLabels = rows.map(r => fmtDayLabel(r.match_date_date || r.bet_date || r.created_at));
renderDailyChart(history, dailyLabels);

// ---- Monthly & Market analytics (tabs + mini summary) ----
const countElem = document.getElementById("betCount");
if(countElem) countElem.textContent = String(rows.length);

// Monthly profit aggregation (ROI version)
const monthMap = {};
const monthStakeMap = {};

rows.forEach(r=>{
  const d = new Date(r.created_at);
  const key = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  monthMap[key] = (monthMap[key]||0) + rowProfit(r);
  monthStakeMap[key] = (monthStakeMap[key]||0) + r.stake;
});

const monthKeys = Object.keys(monthMap).sort();

const monthLabels = monthKeys.map(k=>{
  const [y,m]=k.split("-");
  return new Date(parseInt(y), parseInt(m)-1, 1)
    .toLocaleDateString('en-GB',{month:'short', year:'2-digit'});
});

const monthlyProfit = monthKeys.map(k=> monthMap[k]);
const monthlyROI = monthKeys.map(k=>{
  const stake = monthStakeMap[k] || 0;
  return stake ? (monthMap[k] / stake) * 100 : 0;
});

renderMonthlyChart(monthlyProfit, monthlyROI, monthLabels);

  let breakdownHTML = "<table><tr><th>Month</th><th>Profit</th><th>ROI</th></tr>";
  monthKeys.forEach((k,i)=>{
    const p = monthlyProfit[i];
    const r = monthlyROI[i];
    breakdownHTML += `<tr>
      <td>${monthLabels[i]}</td>
      <td class="${p>0?'profit-win':p<0?'profit-loss':''}">£${p.toFixed(2)}</td>
      <td>${r.toFixed(1)}%</td>
    </tr>`;
  });
  breakdownHTML += "</table>";
  const tableEl = document.getElementById("monthlyTable");
  if(tableEl) tableEl.innerHTML = breakdownHTML;

// Market profit aggregation
const marketMap = {};
const marketWL = {}; // {market:{wins,losses,pending,bets}}
data.forEach(r=>{
  const mk = (r.market && String(r.market).trim()) ? String(r.market).trim() : "Unknown";
  marketMap[mk] = (marketMap[mk]||0) + rowProfit(r);

  if(!marketWL[mk]) marketWL[mk] = {wins:0,losses:0,pending:0,bets:0};
  marketWL[mk].bets += 1;
  const res = (r.result || "pending").toLowerCase();
  if(res === "won") marketWL[mk].wins += 1;
  else if(res === "lost") marketWL[mk].losses += 1;
  else marketWL[mk].pending += 1;
});

// Build win% series (resolved only); show top 8 by bet count
let entries = Object.entries(marketWL);
entries.sort((a,b)=>(b[1].bets)-(a[1].bets));
entries = entries.slice(0,8);

const labels = entries.map(e=>e[0]);
const totals = entries.map(e=>({ bets:e[1].bets, wins:e[1].wins, losses:e[1].losses }));
const winPct = entries.map(e=>{
  const resolved = e[1].wins + e[1].losses;
  return resolved ? (e[1].wins / resolved) * 100 : 0;
});
renderMarketChart(labels, winPct, totals);

// Mini summary
if(entries.length){
  const bestM = [...Object.entries(marketMap)].sort((a,b)=>b[1]-a[1])[0];
  const worstM = [...Object.entries(marketMap)].sort((a,b)=>a[1]-b[1])[0];
  setMiniValue("bestMarket", bestM[0]+":", (bestM[1] >= 0 ? "+£" : "-£") + Math.abs(bestM[1]).toFixed(2));
  setMiniValue("worstMarket", worstM[0]+":", (worstM[1] >= 0 ? "+£" : "-£") + Math.abs(worstM[1]).toFixed(2));
}
if(monthKeys.length){
  const monthEntries = monthKeys.map(k=>[k, monthMap[k]]);
  const bestMo = [...monthEntries].sort((a,b)=>b[1]-a[1])[0];
  const worstMo = [...monthEntries].sort((a,b)=>a[1]-b[1])[0];
  const fmtMonth = (k)=>{
    const [y,m]=k.split("-");
    return new Date(parseInt(y), parseInt(m)-1, 1).toLocaleDateString('en-GB',{month:'short', year:'2-digit'});
  };
  setMiniValue("bestMonth", fmtMonth(bestMo[0])+":", (bestMo[1] >= 0 ? "+£" : "-£") + Math.abs(bestMo[1]).toFixed(2));
  setMiniValue("worstMonth", fmtMonth(worstMo[0])+":", (worstMo[1] >= 0 ? "+£" : "-£") + Math.abs(worstMo[1]).toFixed(2));
}

}


async function updateStake(id,val){
await client.from("bet_tracker").update({stake:parseFloat(val)}).eq("id",id);
loadTracker();
}

async function updateResult(id,val){
if(val==="delete"){
if(!confirm("Delete this bet?")){loadTracker();return;}
await client.from("bet_tracker").delete().eq("id",id);
// Refresh the Value Bets feed so the button switches back from "Added" to "Add".
loadBets();
}else{
await client.from("bet_tracker").update({result:val}).eq("id",id);
}
loadTracker();
}

function exportCSV(){
client.from("bet_tracker").select("*").then(({data})=>{
let csv="match,market,odds,stake,result\n";
data.forEach(r=>{
csv+=`${r.match},${r.market},${r.odds},${r.stake},${r.result}\n`;
});
const blob=new Blob([csv],{type:"text/csv"});
const url=URL.createObjectURL(blob);
const a=document.createElement("a");
a.href=url;
a.download="bet_tracker.csv";
a.click();
});
}

loadBets();
loadTracker();


// Toggle with animation + memory
function toggleTracker(){
  const wrapper = document.getElementById("trackerWrapper");
  const arrow = document.getElementById("trackerArrow");

  if(wrapper.classList.contains("collapsed")){
    wrapper.classList.remove("collapsed");
    wrapper.classList.add("expanded");
    arrow.innerText="▲";
    localStorage.setItem("tracker_open","true");
  }else{
    wrapper.classList.remove("expanded");
    wrapper.classList.add("collapsed");
    arrow.innerText="▼";
    localStorage.setItem("tracker_open","false");
  }
}

// Restore state on load
document.addEventListener("DOMContentLoaded",function(){
  const wrapper=document.getElementById("trackerWrapper");
  const arrow=document.getElementById("trackerArrow");
  const open=localStorage.getItem("tracker_open");
  if(open==="true"){
    wrapper.classList.remove("collapsed");
    wrapper.classList.add("expanded");
    arrow.innerText="▲";
  }
});

// Extend loadTracker to update bet count
const originalLoadTracker = loadTracker;
loadTracker = async function(){
  await originalLoadTracker();
  const rows=document.querySelectorAll("#trackerTable table tr").length-1;
  const count=document.getElementById("betCount");
  if(count && rows>=0){count.innerText=rows;}
};




function renderMonthlyChart(profits, roi, labels){
  const el = document.getElementById("monthlyChart");
  if(!el) return;
  if(monthlyChart) monthlyChart.destroy();

  const maxROI = Math.max(...roi, 5);
  const minROI = Math.min(...roi, -5);
  const pad = 5;

  const ctx = el.getContext("2d");

  monthlyChart = new Chart(ctx,{
    type:"bar",
    data:{
      labels:labels,
      datasets:[{
        data:roi,
        borderRadius:10,
        barThickness:24,
        backgroundColor:profits.map(v=>{
          if(v>0) return "rgba(34,197,94,0.9)";
          if(v<0) return "rgba(239,68,68,0.9)";
          return "rgba(100,116,139,0.4)";
        })
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        y:{
          min: Math.floor(minROI - pad),
          max: Math.ceil(maxROI + pad),
          ticks:{callback:(v)=>v+"%"},
          grid:{color:"rgba(255,255,255,0.05)"}
        }
      }
    },
    plugins:[{
      afterDatasetsDraw(chart){
        const {ctx} = chart;
        chart.getDatasetMeta(0).data.forEach((bar,i)=>{
          const val = profits[i];
          if(val === 0) return;
          ctx.fillStyle="#fff";
          ctx.font="bold 13px system-ui";
          ctx.textAlign="center";
          ctx.fillText("£"+val.toFixed(2), bar.x, roi[i]>=0 ? bar.y-8 : bar.y+18);
        });
      }
    }]
  });
}


function renderMarketChart(labels, winPct, totals){
  const el = document.getElementById("marketChart");
  if(!el) return;
  if(marketChart) marketChart.destroy();

  const ctx = el.getContext("2d");
  marketChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: winPct,
        borderWidth: 0,
        borderRadius: 10,
        barThickness: 18,
        backgroundColor: winPct.map(v=>{
          if(v >= 55) return "rgba(34,197,94,0.85)";   // green
          if(v >= 40) return "rgba(245,158,11,0.85)";  // amber
          return "rgba(239,68,68,0.85)";               // red
        }),
        borderColor: winPct.map(v=>{
          if(v >= 55) return "#22c55e";
          if(v >= 40) return "#f59e0b";
          return "#ef4444";
        })
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx)=>{
              const i = ctx.dataIndex;
              const pct = Number(ctx.raw || 0).toFixed(0) + "%";
              const t = (totals && totals[i]) ? totals[i] : { bets: 0, wins: 0, losses: 0 };
              return `Win rate: ${pct} • Bets: ${t.bets} (W:${t.wins} L:${t.losses})`;
            }
          }
        }
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: { display: false },
          grid: { display: false, drawBorder: false }
        },
        y: {
          ticks: { color: "rgba(229,231,235,0.85)", font: { weight: 800 } },
          grid: { display: false, drawBorder: false }
        }
      },
      animation: { duration: 250 }
    },
    plugins: [{
      id: "pctLabels",
      afterDatasetsDraw(chart){
        const {ctx} = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillStyle = "rgba(229,231,235,0.95)";
        meta.data.forEach((bar, i)=>{
          const val = winPct[i] ?? 0;
          const text = Math.round(val) + "%";
          const x = bar.x - 10; // inside bar near end
          const y = bar.y + 4;
          ctx.textAlign = "right";
          ctx.fillText(text, x, y);
        });
        ctx.restore();
      }
    }]
  });
}

function setMiniValue(id, prefix, value){
  // legacy helper kept, now feeds Insights dropdown
  const txt = (prefix ? (prefix + " ") : "") + (value || "—");
  setInsight(id, txt);
  updateInsightUI();
}




function initChartTabs(){
  const btns = document.querySelectorAll(".tab-btn");
  if(!btns.length) return;

  btns.forEach(b=>{
    b.addEventListener("click", ()=>{
      btns.forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      const tab = b.getAttribute("data-tab");
      document.querySelectorAll(".chart-pane").forEach(p=>p.classList.remove("active"));
      const pane = document.getElementById("pane-"+tab);
      if(pane) pane.classList.add("active");
    });
  });
}


function rowProfit(row){
  if(row.result === "won") return row.stake * (row.odds - 1);
  if(row.result === "lost") return -row.stake;
  return 0;
}


function toggleInsights(){
  const content = document.getElementById("insightsContent");
  const arrow = document.getElementById("insightsArrow");

  if(content.classList.contains("insights-collapsed")){
    content.classList.remove("insights-collapsed");
    content.classList.add("insights-expanded");
    arrow.innerText="▲";
  }else{
    content.classList.remove("insights-expanded");
    content.classList.add("insights-collapsed");
    arrow.innerText="▼";
  }
}


// Auto-close Insights when switching chart tabs
document.addEventListener("click", function(e){
  if(e.target.classList.contains("tab-btn")){
    const content = document.getElementById("insightsContent");
    const arrow = document.getElementById("insightsArrow");
    if(content && !content.classList.contains("insights-collapsed")){
      content.classList.remove("insights-expanded");
      content.classList.add("insights-collapsed");
      arrow.innerText="▼";
    }
  }
});

function toggleMonthly(){
  const wrapper=document.getElementById("monthlyWrapper");
  const arrow=document.getElementById("monthlyArrow");
  if(wrapper.classList.contains("collapsed")){
    wrapper.classList.remove("collapsed");
    wrapper.classList.add("expanded");
    arrow.innerText="▲";
  }else{
    wrapper.classList.remove("expanded");
    wrapper.classList.add("collapsed");
    arrow.innerText="▼";
  }
}
const startingInput = document.getElementById("startingBankroll");

if(startingInput){
  // Load saved value
  const saved = localStorage.getItem("starting_bankroll");
  if(saved){
    startingInput.value = saved;
  }

  // Save on change
  startingInput.addEventListener("input", function(){
    localStorage.setItem("starting_bankroll", this.value);
  });
}



// ===== Auth Modal Handlers =====
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const btnLogin = document.getElementById("btnLogin");
const btnSignup = document.getElementById("btnSignup");
const btnMagic = document.getElementById("btnMagic");
const btnLogout = document.getElementById("btnLogout");
const authMsg = document.getElementById("authMsg");

function setAuthMsg(msg){
  if(authMsg) authMsg.textContent = msg || "";
}

async function ensureProfileRow(user){
  if(!user) return;
  // create profile row if missing (safe upsert)
  await client.from("profiles").upsert({
    id: user.id,
    email: user.email || null
  }, { onConflict: "id" });
}

async function doLogin(){
  const email = (authEmail?.value || "").trim();
  const password = (authPassword?.value || "").trim();
  if(!email || !password){ setAuthMsg("Enter email and password."); return; }
  if(btnLogin) btnLogin.disabled = true;
  setAuthMsg("Logging in…");
  try{
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if(error) throw error;
    await ensureProfileRow(data?.user);
    setAuthMsg("");
    closeAuthModal();
    await refreshGateUI();
    try{ await loadBets(); }catch(e){}
    if(isSubscriber){
      try{ await loadTracker(); }catch(e){}
      try{ await loadHistory(); }catch(e){}
    }
  }catch(e){
    setAuthMsg(e?.message || "Login failed.");
  }finally{
    if(btnLogin) btnLogin.disabled = false;
  }
}

async function doSignup(){
  const email = (authEmail?.value || "").trim();
  const password = (authPassword?.value || "").trim();
  if(!email || !password){ setAuthMsg("Enter email and password."); return; }
  if(btnSignup) btnSignup.disabled = true;
  setAuthMsg("Creating account…");
  try{
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin }
    });
    if(error) throw error;
    await ensureProfileRow(data?.user);
    // With email confirm ON, session is usually null:
    setAuthMsg("Check your email to confirm your account, then log in.");
  }catch(e){
    setAuthMsg(e?.message || "Sign up failed.");
  }finally{
    if(btnSignup) btnSignup.disabled = false;
  }
}

async function doMagic(){
  const email = (authEmail?.value || "").trim();
  if(!email){ setAuthMsg("Enter your email first."); return; }
  if(btnMagic) btnMagic.disabled = true;
  setAuthMsg("Sending magic link…");
  try{
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if(error) throw error;
    setAuthMsg("Check your email for the login link.");
  }catch(e){
    setAuthMsg(e?.message || "Could not send magic link.");
  }finally{
    if(btnMagic) btnMagic.disabled = false;
  }
}

async function doLogout(){
  setAuthMsg("Logging out…");
  try{ await client.auth.signOut(); }catch(e){}
  setAuthMsg("");
  await refreshGateUI();
}

if(btnLogin) btnLogin.addEventListener("click", doLogin);
if(btnSignup) btnSignup.addEventListener("click", doSignup);
if(btnMagic) btnMagic.addEventListener("click", doMagic);
if(btnLogout) btnLogout.addEventListener("click", doLogout);

client.auth.onAuthStateChange(async ()=>{
  await refreshGateUI();
});

// init
window.addEventListener("load", async ()=>{
  await refreshGateUI();
  wireTabLocks();
});
// ===== End Auth Modal Handlers =====

// PWA / offline support
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  });
}
