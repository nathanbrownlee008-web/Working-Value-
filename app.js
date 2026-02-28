// 🔴 IMPORTANT:
// Replace these with YOUR Supabase project values
const supabaseUrl = "PASTE_YOUR_SUPABASE_URL";
const supabaseKey = "PASTE_YOUR_SUPABASE_ANON_KEY";

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

async function loadValueBets() {
  const { data, error } = await supabase
    .from("value_bets_feed")
    .select("*");

  if (error) {
    console.error("Load Value Bets Error:", error);
    return;
  }

  const container = document.getElementById("value-bets");
  container.innerHTML = "";

  data.forEach(bet => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <h3>${bet.match}</h3>
      <p>${bet.market}</p>
      <p>Odds: ${bet.odds}</p>
      <button onclick="addToTracker('${bet.match}', '${bet.market}', ${bet.odds})">
        Add
      </button>
    `;

    container.appendChild(div);
  });
}

async function addToTracker(match, market, odds) {
  const { data, error } = await supabase
    .from("bet_tracker")
    .insert([
      {
        match: match,
        market: market,
        odds: odds,
        stake: 10,
        result: "pending"
      }
    ])
    .select();

  if (error) {
    alert("Insert failed: " + error.message);
    console.error("Insert Error:", error);
    return;
  }

  alert("Added successfully!");
  loadTracker();
}

async function loadTracker() {
  const { data, error } = await supabase
    .from("bet_tracker")
    .select("*")
    .order("id", { ascending: false });

  if (error) {
    console.error("Load Tracker Error:", error);
    return;
  }

  const container = document.getElementById("tracker");
  container.innerHTML = "";

  data.forEach(bet => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <h3>${bet.match}</h3>
      <p>${bet.market}</p>
      <p>Odds: ${bet.odds}</p>
      <p>Stake: ${bet.stake}</p>
      <p>Result: ${bet.result}</p>
    `;

    container.appendChild(div);
  });
}

loadValueBets();
loadTracker();
