# File C program activity — a negative result (spike, 2026-09-01)

**Outcome: File C cannot improve the budget→award crosswalk.** Not as a join
key, not as corroborating evidence, not even as a veto on suspect links. The
program pages' claim that the PE→award gap is structural survives this spike
strengthened: the one untested official path is now tested and ruled out.

This document exists so the path is not re-probed from scratch. The idea looks
good — File C (`Account Breakdown by Award`) nominally carries a
`program_activity_code`/`program_activity_name` per (TAS × award), and if DoD
reported program activity at PE grain it would be the direct join the site says
does not exist. It does not, cannot by construction, and what it does carry is
broken.

---

## The question

The bulk award archives we ingest (File D territory) disclose only the federal
account. The 2026-08-29 red-team flagged File C as "the most credible untested
path" and the founder committed to a probe with a published result either way.
This is that result.

## Method

- Stratified sample of **44 published links** (19 high / 25 medium; 41 distinct
  awards), including all four links previously verified live against the
  USAspending API on 2026-08-28.
- Pulled each award's complete File C rows via
  `POST /api/v2/awards/funding/` — **1,090 rows** — and aggregated per
  (federal account, program activity).
- Compared program-activity codes on `097-0400` rows against the linked PE's
  budget-activity digit (PE chars 3–4; e.g. `0602303E` → BA 02).
- Script, sample, and raw pulls preserved at
  `data/research/filec-spike/{filec_spike.py, filec_sample.json, filec_results.json}`.
- A parallel documentation pass verified the regulatory facts below against
  Treasury GSDM v1.2.1, OMB's authoritative program-activity list, GAO-20-75,
  GAO-22-104702, and DODIG-2022-027.

## Findings

**1. The grain ceiling is structural, not behavioral.** OMB's authoritative
program-activity domain for DoD RDT&E accounts
(`files.usaspending.gov/reference_data/program_activity.csv`, checked at
FY25P12 for 097-0400 and 057-3600) contains only budget-activity lines —
`0001 BASIC RESEARCH` through `0008 SOFTWARE AND DIGITAL TECHNOLOGY PILOT
PROGRAMS` — plus junk codes (`0000 UNKNOWN/OTHER`, `0020 UNDISTRIBUTED`,
`0009`/`0099 N/A`, `0801`/`00RB REIMBURSABLE`). **Program elements are not in
the valid domain.** The A-11 program-and-financing schedules for RDT&E accounts
break out only budget activities, so PE-level File C reporting is impossible by
construction. No amount of data-quality improvement changes this.

**2. Actual quality sits well below even that ceiling.** In the sample:
53% of rows (583/1,090) carry null/`OPTN`/`N/A`/`MISCELLANEOUS`/`UNDISTRIBUTED`
program activity; **81% of absolute obligated flow ($501M of $617M) sits under
junk or absent labels**. Pre-FY2021 rows are structurally exempt — the field
was optional until OMB M-20-21 made it required from FY2021 (`OPTN FIELD IS
OPTIONAL PRIOR TO FY21` appears verbatim as a value) — so most of our
FY2017–2026 corpus has no coverage to begin with. This matches GAO-22-104702
(File C "Unknown/Other" program activity on awards linked to 75+ accounts,
>$166.9B absolute transaction-obligated value, first half FY2021) and
Treasury's own guidance that `0000` is "never appropriate … for awards."

**3. Zero discriminative signal even at budget-activity grain.** Of 22 links
whose 097-0400 rows carry a usable PA code, **18 disagree** with the linked
PE's budget activity. The ground-truth case kills the field: SRI's
`HR001119C0112` (Competency-Aware Machine Learning — certainly DARPA, certainly
BA 6.2 applied research, single-account, DARPA-awarded) is tagged
`0001 BASIC RESEARCH`. Two of the four "agreements" are BA1 PEs agreeing with a
near-constant `0001` tag — coincidence with a constant, not signal. The
documentation pass independently found the same phenomenon on a marquee
program: the KC-46 EMD contract's RDT&E rows are tagged `0001 BASIC RESEARCH`.

**4. It cannot even veto.** A veto rule ("reject a high link when File C's BA
contradicts the PE's BA") would have rejected the certainly-true SRI link.
A field that fails on known-true cases discriminates in neither direction.

**5. The field is being retired anyway.** Per GSDM v1.2 release notes, broker
rules B27.5/B27.6 block `ProgramActivityCode`/`Name` submissions from FY2026
P01/02; the replacement is the **Program Activity Reporting Key (PARK)** — a
15-character OMB-assigned key from OMB's Program Activity Mapping File, which
is login-walled (`go.max.gov/pa`). Any future investment goes to PARK, not
PAC/PAN.

## What would change the verdict

- OMB's PARK mapping file becomes public **and** sub-BA granular for DoD.
- OUSD(C) publishes an account×PE mapping (none found in FMR Vol 6A; the
  DODIG-2022-027 description of the MAX Collect process suggests none exists).
- Explicitly **not** more sampling: finding #1 is a domain-list fact, not a
  sampling artifact.

## Implications

- The program pages' "structurally always will" framing stands. `/coverage/`
  can now say File C was **examined and ruled out** rather than staying silent
  on it — a stronger sentence than the one it replaces.
- Interview line (NYT, budget-to-award linkage): "We tested the one remaining
  official path — the account-level financial file that nominally carries
  program activity. It's budget-activity grain at best by OMB's own domain
  list, 81% of the obligated flow in our sample sits under junk labels, and it
  contradicts ground truth on awards we can independently verify — the
  government's own auditors report the same. We published the negative result."
- Nobody else appears to have published a File C→DoD-program linkage method
  (documentation pass found none), consistent with the above.
