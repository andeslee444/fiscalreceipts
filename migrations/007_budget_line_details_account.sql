-- Phase 5G: carry the P-40 appropriation (account) into procurement detail
-- rows so Gate B can scope its P-1 control-row lookup by account.
--
-- Navy FY2026 surfaced a real collision the defense-wide corpus never hit:
-- the bare P-1 line number is unique only WITHIN an appropriation account, not
-- across an org. e.g. Navy line 2210 = "Joint Advance Tactical Missile" in
-- account 1507N AND "Submarine Acoustic Warfare System" in account 1810N.
-- Gate B summed both budget_lines rows (sharing pe_bli) and compared the sum
-- against a single XML detail item -> false FAIL. The XML LineItem carries the
-- AppropriationNumber (p40_parser.appropriation_number), which equals
-- budget_lines.account byte-for-byte (verified live: XML 1810N == account
-- 1810N), so (pe_bli, account) disambiguates without re-keying pe_bli.
--
-- Nullable: only procurement (P-40) rows populate it. R-1/RDT&E and legacy
-- era-namespaced rows leave it NULL, and Gate B falls back to the prior
-- cross-account behavior when account IS NULL (no R-1 line-number collision
-- has ever been observed — the R-1 key is the globally-unique PE).
alter table budget_line_details
  add column if not exists account text;
