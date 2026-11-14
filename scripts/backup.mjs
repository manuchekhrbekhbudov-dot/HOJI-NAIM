// Nightly backup: reads every table through the Supabase REST API with the service-role key
// (kept only in GitHub Secrets, never in the website) and writes backup.json.
// The workflow encrypts the file with BACKUP_PASSWORD before it is stored.
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tables = ["profiles", "shipments", "payments", "expenses", "batches", "fx_rates", "customer_sheets", "app_settings", "audit_log"];
const out = { exported_at: new Date().toISOString(), source: url, tables: {} };
for (const t of tables) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (r.status === 404) { console.log(`skip ${t} (not installed)`); break; }
    if (!r.ok) { const body = await r.text(); if (/schema cache|does not exist/i.test(body)) { console.log(`skip ${t} (not installed)`); break; } throw new Error(`${t}: HTTP ${r.status} ${body.slice(0, 200)}`); }
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  out.tables[t] = rows;
  console.log(`${t}: ${rows.length}`);
}
const fs = await import("node:fs");
fs.writeFileSync("backup.json", JSON.stringify(out));
