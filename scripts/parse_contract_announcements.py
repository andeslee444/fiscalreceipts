"""Parse fetched DoD contract-announcement HTML into per-award records.

Each daily digest is service-sectioned prose, one paragraph per award action.
Extracted per paragraph:
  article_id, date, service, contractor (lead segment), amounts ($ patterns),
  contract_numbers [{raw, piid (hyphens/spaces stripped), role}], text.
Roles: 'award' (number parenthesized at paragraph end / after activity),
'referenced' (inline "to contract X" — usually the parent/modified vehicle).

Output: data/research/announcements/records.jsonl (one JSON per paragraph
with >=1 contract number) + parse_stats.json.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "announcements"
OUT = ROOT / "data" / "research" / "announcements"

SERVICES = ["ARMY", "NAVY", "AIR FORCE", "SPACE FORCE", "DEFENSE LOGISTICS AGENCY",
            "MISSILE DEFENSE AGENCY", "SPECIAL OPERATIONS", "DEFENSE ADVANCED RESEARCH",
            "U.S.", "WASHINGTON HEADQUARTERS", "DEFENSE", "MARINE CORPS"]
CN = re.compile(r"\b([A-Z][A-Z0-9]{4,5}[- ]?\d{2}[- ]?[A-Z][- ]?[A-Z0-9]{4})\b")
AMOUNT = re.compile(r"\$([\d,]+(?:\.\d+)?)(?:\s*(million|billion))?", re.I)
TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")
DATE_SLUG = re.compile(r"contracts?-for-([a-z]+)-?(\d{1,2})-(\d{4})", re.I)
DATE_TITLE = re.compile(r"Contracts?\s+[Ff]or\s+([A-Z][a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def norm_piid(raw: str) -> str:
    return re.sub(r"[- ]", "", raw)


def parse_article(article_id: str, html: str) -> list[dict]:
    # date: try the title first, then the URL slug recorded in the page
    date = None
    m = DATE_TITLE.search(html) or DATE_SLUG.search(html)
    if m:
        mon = MONTHS.get(m.group(1).lower()[:3])
        if mon:
            date = f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(2)):02d}"

    # paragraphs from the content body
    paras = [WS.sub(" ", TAG.sub(" ", p)).strip()
             for p in re.findall(r"<p[^>]*>(.*?)</p>", html, re.S)]
    records = []
    service = None
    for p in paras:
        if not p:
            continue
        upper = p.rstrip(" *").upper()
        if len(upper) < 60 and any(upper.startswith(s) for s in SERVICES) and "$" not in p:
            service = upper.rstrip(".")
            continue
        nums = []
        for m2 in CN.finditer(p):
            raw = m2.group(1)
            before = p[max(0, m2.start() - 30):m2.start()].lower()
            after = p[m2.end():m2.end() + 3]
            role = "referenced" if "contract " in before[-12:] or "to contract" in before else (
                "award" if ("(" in p[max(0, m2.start() - 2):m2.start()] or after.startswith(")")) else "award")
            nums.append({"raw": raw, "piid": norm_piid(raw), "role": role})
        if not nums:
            continue
        amounts = []
        for m3 in AMOUNT.finditer(p):
            v = float(m3.group(1).replace(",", ""))
            unit = (m3.group(2) or "").lower()
            if unit == "million":
                v *= 1e6
            elif unit == "billion":
                v *= 1e9
            amounts.append(round(v))
        contractor = p.split(",")[0].strip(" *")
        records.append({
            "article_id": article_id, "date": date, "service": service,
            "contractor": contractor[:120], "amounts": amounts[:4],
            "contract_numbers": nums, "text": p[:2400],
        })
    return records


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(RAW.glob("*.html"))
    if "--sample" in sys.argv:
        files = sorted((ROOT / "data/research/announcements").glob("sample_*.html"))
    n_rec = n_art = 0
    with open(OUT / "records.jsonl", "w") as f:
        for fp in files:
            aid = fp.stem.replace("sample_", "")
            try:
                recs = parse_article(aid, fp.read_text(errors="replace"))
            except Exception as e:
                print(f"!! {aid}: {e}")
                continue
            for r in recs:
                f.write(json.dumps(r) + "\n")
            n_rec += len(recs)
            n_art += 1
    stats = {"articles": n_art, "records": n_rec}
    json.dump(stats, open(OUT / "parse_stats.json", "w"))
    print(stats)


if __name__ == "__main__":
    main()
