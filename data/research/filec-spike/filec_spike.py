"""File C spike: for each sampled (pe_bli, piid) link, pull the award's
File C rows via /api/v2/awards/funding/ and record every distinct
(federal_account, program_activity_code, program_activity_name) with amounts.

Questions:
  1. Granularity — are DoD program activities budget-activity level or PE level?
  2. Coverage — how many rows have null/unknown program activity?
  3. Agreement — does the 097-0400 program activity match the linked PE's BA digit?
"""
import json
import time
import urllib.request

API = "https://api.usaspending.gov/api/v2"
SCRATCH = "/private/tmp/claude-501/-Users-andeslee-Documents-Cursor-Projects-GovBudget/b06b40b8-77b5-44b0-a6f8-338993e68349/scratchpad"


def post(path, body, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(
                f"{API}{path}", data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "fr-filec-spike"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))


def gid_for(piid):
    for tc in (["A", "B", "C", "D"],
               ["IDV_A", "IDV_B", "IDV_B_A", "IDV_B_B", "IDV_B_C", "IDV_C", "IDV_D", "IDV_E"]):
        r = post("/search/spending_by_award/", {
            "filters": {"award_ids": [piid], "award_type_codes": tc},
            "fields": ["Award ID", "generated_internal_id"], "limit": 10})
        for row in r.get("results", []):
            if row.get("Award ID") == piid:
                return row["generated_internal_id"]
    return None


def funding_rows(gid):
    rows, page = [], 1
    while True:
        r = post("/awards/funding/", {"award_id": gid, "page": page, "limit": 100,
                                      "sort": "reporting_fiscal_date", "order": "desc"})
        batch = r.get("results", [])
        rows.extend(batch)
        if not r.get("page_metadata", {}).get("hasNext") or page > 20:
            break
        page += 1
    return rows


sample = json.load(open(f"{SCRATCH}/filec_sample.json"))
seen_piids = {}
results = []
for i, s in enumerate(sample):
    piid = s["piid"]
    if piid in seen_piids:
        gid, rows = seen_piids[piid]
    else:
        try:
            gid = gid_for(piid)
            rows = funding_rows(gid) if gid else []
        except Exception as e:
            gid, rows = None, []
            print(f"  !! {piid}: {e}")
        seen_piids[piid] = (gid, rows)
        time.sleep(0.4)
    # aggregate distinct program activities per account
    pa = {}
    for r in rows:
        key = (r.get("federal_account"), r.get("program_activity_code"), r.get("program_activity_name"))
        d = pa.setdefault(key, {"obligated": 0.0, "outlay": 0.0, "rows": 0})
        d["rows"] += 1
        if r.get("transaction_obligated_amount"):
            d["obligated"] += r["transaction_obligated_amount"]
        if r.get("gross_outlay_amount"):
            d["outlay"] += r["gross_outlay_amount"]
    results.append({
        **s, "gid": gid, "n_rows": len(rows),
        "program_activities": [
            {"account": k[0], "pa_code": k[1], "pa_name": k[2], **v}
            for k, v in sorted(pa.items(), key=lambda kv: -kv[1]["rows"])],
    })
    print(f"[{i+1}/{len(sample)}] {s['pe']} {piid} ({s['conf']}): {len(rows)} rows, "
          f"{len(pa)} distinct (account,PA)")

json.dump(results, open(f"{SCRATCH}/filec_results.json", "w"), indent=1)

# ---- summary ----
print("\n===== SUMMARY =====")
probed = [r for r in results if r["gid"]]
print(f"awards probed: {len(set(r['piid'] for r in probed))} "
      f"(links: {len(probed)}; no File C rows: {sum(1 for r in probed if r['n_rows']==0)})")

pa_codes = {}
null_rows = 0
total_rows = 0
for r in probed:
    for p in r["program_activities"]:
        total_rows += p["rows"]
        if not p["pa_code"] and not p["pa_name"]:
            null_rows += p["rows"]
        pa_codes.setdefault((p["pa_code"], p["pa_name"]), 0)
        pa_codes[(p["pa_code"], p["pa_name"])] += p["rows"]
print(f"total File C rows: {total_rows}; rows with null PA: {null_rows}")
print("\ndistinct program-activity values seen (by row count):")
for (code, name), n in sorted(pa_codes.items(), key=lambda kv: -kv[1])[:25]:
    print(f"  {str(code):>8} | {str(name):<55} | {n:>5} rows")

# agreement: linked PE's BA digit vs 097-0400 PA code
print("\n=== BA agreement on 097-0400 rows (PE digits 3-4 vs PA code) ===")
agree = disagree = nopa = 0
for r in probed:
    ba = r["pe"][2:4]          # '0602303E' -> '02'
    expected = ba.lstrip("0") or "0"
    pas = [p for p in r["program_activities"] if p["account"] == "097-0400"]
    if not pas:
        continue
    codes = {(p["pa_code"] or "").lstrip("0") for p in pas if p["pa_code"]}
    if not codes:
        nopa += 1
    elif expected in codes:
        agree += 1
    else:
        disagree += 1
        print(f"  MISMATCH {r['pe']} ({r['conf']}) {r['piid']}: expected BA {ba}, "
              f"File C has {sorted((p['pa_code'], p['pa_name']) for p in pas)[:4]}")
print(f"\nagree: {agree}  disagree: {disagree}  no-PA: {nopa}")
