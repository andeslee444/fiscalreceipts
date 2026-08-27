# ROADMAP #55 — what actually needs a human

Companion to `roadmap-55-flagship-alias-worksheet.csv`. Every one of the 215 rows now
carries a `pick`. **This document lists only the 13 terms where a person must choose.**
The other 59 were researchable, and the reasoning for each is on its own row in
`curator_notes` rather than repeated here.

## The framing correction

#55 was filed as needing "domain judgment". Mostly it does not. *Sentinel* is the
worked example, and the corpus settles it without any outside knowledge: `0125WK5057`
**Sentinel Mods** sits in *Other Procurement, Army*, **budget activity 02 —
"Communications and Electronics Equipment."** An ICBM is not communications and
electronics equipment. That line is the AN/MPQ-64 Sentinel air-defence **radar**, a
different system that happens to share a name. The LGM-35A Sentinel is the renamed
Ground Based Strategic Deterrent, `0605238F` *Ground Based Strategic Deterrent EMD*
(FY2026 $4,147.6M) — whose title contains no "Sentinel", which is exactly why substring
matching lands on the radar.

That is a fact, not a preference. So are 58 others.

| Outcome | Terms | Meaning |
|---|---:|---|
| Resolved to a worksheet candidate (`y`) | 23 | One row ticked; reason on the row |
| Resolved to a PE **not** on the worksheet (`n` + `OFF-WORKSHEET PE:`) | 20 | Correct PE found by program knowledge; cannot be a `y` because the row does not exist |
| Term should not become an alias at all (`n` + `DROP`) | 16 | No defensible target in the corpus, or the alias string is unsafe |
| **Genuinely ambiguous** | **13** | **Below** |

## The rule applied to the 59

A title match is not an alias. `y` requires that the candidate carry the program's
identity **and** that every sibling be subordinate: a *Mods* / *Modification* /
*Support Equipment* / *Post Production Support* / *Product Improvement* / *Reman* /
*Test* / *Modernization* line, a named increment or variant (*Increment II*, *Block IIIA*,
*MC-130J*), or a line with no current request when an identically-titled one has one.
Where two lines are both unqualified and both funded, that is not a rule failure —
it is the fork below.

Identity decides, not magnitude. *Triton* resolves to `0305220N` *MQ-4C Triton*
($14.4M) and not `0305421N` *MQ-4C Triton Modernization* ($361.9M), because a
modernization PE is an activity of the program, not the program. Flagged here in case
you want the money rule instead; it would flip Triton and nothing else.

---

## 1. One decision covers nine of the thirteen

Nine terms fork the same way: **one program, funded on a procurement line and an RDT&E
program element, neither subordinate to the other.** They are not nine judgments.

`src/govbudget/influence/mentions.py::_load_aliases` builds `{pe_bli: [alias, …]}` —
so **an alias may map to more than one PE.** Both halves can be seeded. A filing naming
the program then emits one mention row per seeded PE, each on its own program page.

| Term | Procurement line | RDT&E program element | Third |
|---|---|---|---|
| **AMRAAM** | `MAMRA0` AMRAAM (AF) **$665.1M** | `0207163F` AMRAAM (AF) $51.2M | `0207163N` AMRAAM (Navy) $26.3M |
| **Javelin** | `0648CC0007` Javelin (AAWS-M) System Summary **$329.2M** | `0604611A` JAVELIN $9.8M | — |
| **KC-46** | `KC046A` KC-46A MDAP **$2,819.0M** | `0401221F` KC-46A Tanker Squadrons $145.4M | — |
| **B-52** | `B05200` B-52 $223.9M | `0101113F` B-52 Squadrons **$931.2M** | — |
| **C-17** | `C01700` C-17A $77.2M | `0401130F` C-17 Aircraft (IF) $80.9M | — |
| **F-15EX** | `F015EX` F-15EX **$3,014.4M** | `0207146F` F-15EX $80.4M | — |
| **GMLRS** | `6005C64400` Guided MLRS Rocket (GMLRS) **$1,168.2M** | `0205778A` Guided Multiple-Launch Rocket System (GMLRS) $33.3M | — |
| **LTAMDS** | `7265C12000` Lower Tier Air and Missile Defense (AMD) Sen **$1,255.5M** | `0604114A` Lower Tier Air Missile Defense (LTAMD) Sensor $210.4M | — |
| **Small Diameter Bomb** | `SDB000` Small Diameter Bomb **$41.5M** | `0207327F` Small Diameter Bomb (SDB) (AF) $24.8M | `0604329N` Small Diameter Bomb (SDB) (Navy) $23.8M |

All figures are FY2026 requests. None of these terms resolves to anything today — there
is no seeded alias for any of them.

Two notes on the table. **F-15EX** is the sharpest case: both lines carry the *identical*
title "F-15EX", so no title-based tiebreak exists at all. **LTAMDS** and the two
`Small Diameter Bomb` RDT&E lines never appear as candidates in the worksheet, because
no title spells "LTAMDS" and `SDB002` (Small Diameter Bomb **II**) is a different
weapon — it is the target of the separate *StormBreaker* resolution, not of the
unqualified term.

> **Recommended: seed both (all three, where there are three).** They are one program.
> Seeding only the larger line silently hides the other half of the money from anyone
> reading the smaller page. If you prefer one canonical landing page per term, take the
> **bolded** line in each row.
>
> ☐ Seed every line listed  ☐ One page per term (bolded)  ☐ Other: ______

---

## 2. Four one-offs

### MQ-9 — which component owns the name

Currently resolves to `1108MQ9`. Four candidates; two are disposed of on the rule
(`PRDTB2` *MQ-9 Mods* is a modification line; `1105219BB` *MQ-9 UAV* has no FY2026
trajectory). Two remain, $1.8M apart:

| PE | Title | Org | FY2026 |
|---|---|---|---:|
| `0205219F` | MQ-9 UAV | Air Force (RDT&E) | $26.7M |
| `1108MQ9` | MQ-9 Unmanned Aerial Vehicle | SOCOM (Procurement) | $24.9M ← **seeded today** |

The Air Force is the lead component for the MQ-9; SOCOM buys its own. That argues for
`0205219F`. Against it: the seed already points at SOCOM. Worth knowing before you
decide — **the current MQ-9 seed is inert.** Its 58 mention rows are `multi_token`, not
`alias`; the alias string matches nothing in the LDA corpus. Changing it costs nothing.

> **Recommended: `0205219F`** (Air Force, lead component), or seed both.
> ☐ 0205219F  ☐ 1108MQ9 (no change)  ☐ Both

### C-130J — the seed points at the special-operations variants

Currently resolves to `2012C130J`, and unlike MQ-9 **this seed is live: 17 alias mention
rows.** Re-seeding moves them.

| PE | Title | Org | FY2026 | |
|---|---|---|---:|---|
| `0401132F` | C-130J Program | AF (RDT&E) | $31.4M | unqualified, current request |
| `C130J0` | C-130J | AF (Aircraft Proc) | *none* | unqualified, but FY2024 actual $1,153.5M and no FY2025/FY2026 |
| `2012C130J` | **AC/MC-130J** | SOCOM (Proc) | $236.3M | **seeded today** — gunship and special-ops variants, not baseline C-130J |
| `C1300J` | C-130J Mods | AF | $214.2M | excluded: modification line |
| `C130JM` | MC-130J | AF | *none* | excluded: variant, no current request |

An unqualified "C-130J" in a lobbying filing is Lockheed's baseline airlifter. `2012C130J`
is the AC-130J gunship and MC-130J Commando II.

> **Recommended: `0401132F`** — the only unqualified C-130J line with a current request.
> This moves 17 mention rows from a $236.3M SOCOM page to a $31.4M Air Force page, which
> is why it is here rather than decided.
> ☐ 0401132F  ☐ 2012C130J (no change)  ☐ Both

### Patriot — no base line exists

| PE | Title | Org | FY2026 |
|---|---|---|---:|
| `0962C50700` | Patriot Mods | Army (Missile Proc) | $757.8M |
| `0607865A` | Patriot Product Improvement | Army (RDT&E) | $198.8M |

Both candidates are derivative by the rule — *Mods* and *Product Improvement*. The corpus
holds **no base Patriot system line**, and the largest Patriot-family line in the whole
warehouse is titled neither: `8260C53101` *MSE Missile* (Missile Procurement, Army,
FY2026 **$1,311.9M**), the PAC-3 Missile Segment Enhancement interceptor.

This is the one term where the rule genuinely runs out: every option is either a
derivative line or a line that does not say "Patriot".

> **Recommended: `0962C50700`**, the largest line that names Patriot — or drop the term.
> ☐ 0962C50700  ☐ 0607865A  ☐ Both  ☐ Drop

### PAC-3 — the acronym is the only evidence

No title in the corpus contains "PAC-3". The likely target is `8260C53101` *MSE Missile*
($1,311.9M): MSE is the PAC-3 Missile Segment Enhancement, and the line sits in Missile
Procurement, Army, budget activity 02 "Other missiles" at a magnitude consistent with the
PAC-3 MSE buy.

I have marked this ambiguous rather than resolved because the identification rests
entirely on expanding a three-letter acronym in a four-character title. Every other
off-worksheet resolution in this set rests on a documented one-to-one name (GBSD→Sentinel,
Wedgetail→E-7A, StormBreaker→SDB II). This one does not.

> **Recommended: `8260C53101`** if you can confirm MSE Missile is the PAC-3 MSE line;
> otherwise drop.
> ☐ 8260C53101  ☐ Drop  ☐ Other: ______

---

## 3. Four resolved terms you should still see

Not decisions — corrections landing without one. Listed because they change live behaviour.

- **JASSM → `0207325F`** *Joint Air-to-Surface Standoff Missile (JASSM)* (AF RDT&E,
  FY2026 $232.3M). The alias points today at `0603000D8Z` *Joint Munitions Advanced
  Technology* (OSD) — a defence-wide munitions science-and-technology line that is not
  JASSM — and carries **10 live alias mention rows** there. Companion procurement line
  `JASSM0` *Joint Air-Surface Standoff Missile* (Missile Procurement, AF, FY2026 $818.1M)
  spells the name out and so never entered the worksheet's candidate set; add it as a
  second row if you take "seed both" in §1.
- **Aegis → `0603892C`** *AEGIS BMD* (FY2026 $994.4M). The seed points at `MD09`,
  identically titled *Aegis BMD* but a procurement line with **no FY2025 or FY2026
  trajectory** (FY2024 actual $601.5M). `MD09` produces zero alias rows; the change is free.
- **CV-22 → `0401318F`** *CV-22* (AF RDT&E). The seed points at `1000CV2200` *CV-22
  **Modification***. Three of the four CV-22 candidates are Mods / Modification / Post
  Production Support; exactly one is the program. Zero alias rows today.
- **F-35 → `ATA000`** — **no change.** Of the five families flagged as "routing a 4–6-PE
  family to a single page", this one is already right: `ATA000` is the only unqualified
  F-35 line, and the five siblings are three service splits of *F-35 C2D2*, *F-35
  Modifications*, and *F-35 Squadrons*. 60 live alias rows stay where they are.

## 4. Resolved to a PE that is not on the worksheet

These carry `pick = n` — there is no row to tick — with `OFF-WORKSHEET PE: <pe_bli>` at
the front of `curator_notes` so Task 2 can grep them. Listed for the record; no decision
asked.

| Term | → PE | Title | Why |
|---|---|---|---|
| Sentinel, GBSD | `0605238F` | Ground Based Strategic Deterrent EMD | LGM-35A Sentinel is the renamed GBSD |
| JSF | `ATA000` | F-35 | pre-2006 name; existing seed, keep |
| GBI | `MD08` | Ground Based Midcourse | existing seed, keep — but MD08 has **no trajectory row at all** |
| Osprey | `0604262N` | V-22 | fielded name of the V-22 |
| Wedgetail | `0604007F` | E-7 | fielded name of the E-7A |
| Poseidon, P-8 | `0605500N` | Multi-mission Maritime Aircraft (MMA) | P-8A is the MMA; `0605504N` is "Increment III" |
| Global Hawk | `0305220F` | RQ-4 UAV | Global Hawk is the RQ-4; no FY2026 request, which is the program's real state |
| E-2D | `0604234N` | Advanced Hawkeye | E-2D *is* the Advanced Hawkeye |
| MQ-25 | `0605414N` | Unmanned Carrier Aviation (UCA) | MQ-25 Stingray is the UCA program (92 multi_token rows already) |
| StormBreaker | `SDB002` | SMALL DIAMETER BOMB II | StormBreaker is the GBU-53/B |
| SM-6 | `0604366N` | Standard Missile Improvements | SM-6 is a Standard Missile; sole SM line in corpus |
| SPY-6 | `0604522N` | Air and Missile Defense Radar (AMDR) System | AN/SPY-6 is the AMDR's type designation |
| JSOW | `0604727N` | Joint Standoff Weapon Systems | literal expansion |
| JDAM | `353620` | Joint Direct Attack Munition | literal expansion |
| IBCS | `9280BZ5075` | IAMD Battle Command System | literal expansion |
| AARGM | `0205601N` | Anti-Radiation Missile Improvement | AARGM is the Advanced Anti-Radiation Guided Missile |
| AH-64 | `0607145A` | Apache Future Development | both AH-64 candidates are MODS/Reman; same target as Apache |
| Chinook | `6775A05101` | CH-47 Helicopter | candidates are the SOCOM MH-47 and a product-improvement line |

## 5. Terms that should not become aliases (16)

`ESSM` · `RAM` · `Stinger` · `TOW` · `Excalibur` · `NASAMS` · `Coyote` · `Paveway` ·
`Griffin` · `Maverick` · `F135` · `F119` · `Super Hornet` · `SLAM-ER` · `Harpoon` ·
`Trident`

Four reasons, all on the rows:

1. **No line exists in the corpus.** NASAMS, Paveway, Griffin, Maverick, F135, F119,
   SLAM-ER, Trident — and, contrary to how they look, **ESSM and RAM**. RAM's 89
   candidates are every substring hit inside the word "**program**"; ESSM's 8 are hits
   inside "**assessment**". Neither the Rolling Airframe Missile nor the Evolved Sea
   Sparrow Missile has any line in the warehouse. RAM was the poster child for "genuinely
   ambiguous"; it is not ambiguous, it is empty.
2. **Only a derivative line exists.** Stinger (`Stinger Mods`, budget activity 03
   "Modification of Missiles"), Harpoon (`Harpoon Support Equipment`, $209K).
3. **Only a rollup exists.** Excalibur (`ARTILLERY PROJECTILE, 155MM, All Types`),
   Coyote (`COUNTER-SMALL UNMANNED AERIAL SYSTEM`, a multi-vendor rollup). Aliasing a
   rollup attributes the whole rollup to one product.
4. **The alias string itself is unsafe.** **TOW** — `2104C59300` *TOW 2 System Summary*
   is the right line, but the matcher uses a case-insensitive word-boundary regex, so
   `TOW` fires on the ordinary English word "tow". That is the #52 false-naming defect
   arriving through the front door. **Super Hornet** — the only F/A-18E/F line is
   `pe_bli 0145`, which `dim_programs` shares with *General Purpose Bombs*; an alias
   there attributes Super Hornet filings to a bomb line.

## 6. Three defects in the worksheet's own data

Found while curating; stated plainly rather than worked around.

1. **`resolves_today` is wrong for `GBI` and `JSF`.** Both read *"nothing — no curated
   alias and no title to match"* while `seeded_alias_today` on the same row correctly
   reads `MD08` and `ATA000`. `regen_roadmap_55_worksheet.py` hardcodes that string in
   its zero-candidate branch instead of using `seeded_pe`. Two of the thirteen seeded
   aliases are therefore described as unseeded.
2. **`seed_conflict` never fires for a seeded term with zero title candidates** — same
   branch, `seed_conflict=""` is hardcoded. GBI and JSF are consequently exempt from the
   seed audit the column exists to perform.
3. **The candidate set misses same-program PEs whose titles spell the acronym out.**
   `JASSM` has one candidate; `JASSM0` *Joint Air-Surface Standoff Missile* (FY2026
   $818.1M, 3 multi_token rows) is the same program and never appears. Likewise LTAMDS,
   PAC-3 and the whole §4 table. The substring rule reproduces ROADMAP #55's twelve
   recorded counts exactly — it is faithfully recovered — but faithful recovery of an
   incomplete method still yields an incomplete candidate set, and the `sole_match`
   tier overstates its own confidence as a result.

One more thing worth recording, not a defect: **`pe_bli` is not unique in
`dim_programs`.** Eleven codes carry more than one row, ten of them with genuinely
different titles — `0145` is both *F/A-18E/F (Fighter) Hornet* and *General Purpose
Bombs*, `2210` is both *Submarine Acoustic Warfare System* and *Joint Advance Tactical
Missile (JATM)* (the eleventh, `2292`, is one program in two accounts). Any alias landing
on one of those routes a filing to a page that is two programs. It disqualified two picks
here (F/A-18's second candidate, and Super Hornet outright).
