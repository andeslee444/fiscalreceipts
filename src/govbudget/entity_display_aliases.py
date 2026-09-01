"""Curated PUBLISHED LABELS for warehouse company families (ROADMAP #10, option A).

THE DEFECT. A family's on-screen name is `dim_entities.display_name`, which is
`max(coalesce(parent_name, recipient_name)) filter (rn = 1)` — the registered
`recipient_parent_name` of the member holding the most money. That string is
chosen by an argmax over obligations, and the argmax has no notion of "current"
and no notion of "close". Measured over the 200 published families, **15 of
them ($255.2B, 9.7% of published family dollars) carry a label whose winning
registration beat its runner-up by less than 15%**.

The flagship: `ROCKWELL COLLINS AUSTRALIA` holds 15 members and is 97.3%
`RAYTHEON COMPANY` ($18.93B of $19.47B), all sharing parent UEI
`EGAVSJTA2D81`. It won its name by 3.1% — and RTX reverted that registration
in FY2026, so the site published a label the registrant had already corrected.

WHAT THIS IS NOT. It is not entity resolution. The GROUPING is correct: those
15 members really are one family, keyed on one parent UEI. Only the displayed
string is wrong. Nor is it a SAM.gov ingestion problem — `recipient_parent_name`
IS the SAM registration name, so fetching it from SAM returns the same string.
See docs/superpowers/reviews/10-entity-resolution-spike.md for the sizing, the
four rejected alternatives, and why "name a family by its dominant member" is a
regression rather than a fix (it renames GENERAL DYNAMICS → ELECTRIC BOAT
CORPORATION).

WHAT THIS IS. A hand-curated `family_key → display_name` table. Because slugs
are `family_key.lower().replace(" ", "-")` and entity fact ids are
`fact_id_derived("entity", family_key, …)`, a relabel moves NO url, NO fact id,
NO citation `query_body` and NO dollar. It changes strings a reader reads and
nothing else.

Contract:
  * Source of truth: ``data-seeds/entity_display_aliases.csv`` with columns
    ``family_key, display_name, evidence, source_url, source_form, source_date,
    measured_on, note``.
  * ``family_key`` is the warehouse key VERBATIM — never a name, never
    normalized here. An alias for a key the warehouse does not have is a typo,
    and the exporter refuses it rather than dropping it quietly.
  * At most ONE alias per ``family_key``. Two rows for one key is a seed that
    cannot say what it publishes, so it is a load-time error.
  * ``display_name`` is a CURATED DISPLAY STRING, rendered verbatim. It must
    carry a lower-case letter: the site's casing rule
    (``site/src/lib/company-name.mjs``) passes mixed-case names through
    untouched, and a SHOUTED alias would mean the curator meant the registry
    string — for which there is no row to write.
  * The REGISTRY string is never discarded. `display_name` in the payloads
    keeps meaning "the name USAspending registered", the alias rides beside it
    as `label`, and `/company/` renders the registry string visibly. A reader
    searching USAspending still needs that exact string.

Loud failures only (same rule as entity_families.py): a malformed row, an
unknown evidence kind, a source on a row that claims no source, or a duplicate
key raises. A quietly-dropped alias restores the very label this table exists
to correct.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

# The seed's exact column set.
REQUIRED_COLUMNS = (
    "family_key",
    "display_name",
    "evidence",
    "source_url",
    "source_form",
    "source_date",
    "measured_on",
    "note",
)

#: What GROUNDS this row. Deliberately NOT entity_families.py's EVIDENCE_KINDS:
#: that field types whether a DOCUMENT names the parties to a corporate event,
#: and none of these rows is about an event. Writing a finding into a field
#: that types something else is how the last seed edit broke the exporter.
#:
#:   sourced  — an external document states this name for this business. The
#:              source_* trio is required and renders as an external reference.
#:   measured — the alias is grounded in the AWARD LAKE itself: the family's own
#:              member composition and its registration history, both reproduced
#:              with their numbers in `note`. No external document is claimed,
#:              so the source_* trio must be EMPTY.
#:   pin      — NO relabel. The argmax winner IS the right label; the row
#:              records that a human reviewed the near-tie and pins the result,
#:              so a data shift cannot silently swap it for the runner-up. The
#:              alias must equal what the site's casing rule already renders —
#:              gate 24 leg (l) checks that, in the language where that rule
#:              lives.
EVIDENCE_KINDS = ("sourced", "measured", "pin")

#: Kinds whose evidence is internal — the lake, or a review of it. These rows
#: must NOT carry an external source, because pointing at a document would
#: claim provenance the row does not have.
_UNSOURCED_KINDS = ("measured", "pin")

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LOWERCASE = re.compile(r"[a-z]")

#: A reason short enough to be a shrug is not a reason. Every relabel is an
#: editorial assertion about who a company is; the seed makes the curator write
#: it down, with the numbers, where a reviewer can check it.
MIN_NOTE_CHARS = 120


class DisplayAliasError(ValueError):
    """Raised on any malformed or self-contradicting alias row."""


@dataclass(frozen=True)
class DisplayAlias:
    """One curated published label, exactly as authored in the seed."""

    #: Warehouse dim_entities.family_key, verbatim.
    family_key: str
    #: The label the site publishes for this family.
    display_name: str
    #: EVIDENCE_KINDS — what grounds this row.
    evidence: str
    #: External document, for `sourced` rows only ("" otherwise).
    source_url: str
    source_form: str
    source_date: str
    #: The date the numbers quoted in `note` were measured against the lake.
    measured_on: str
    note: str

    @property
    def relabels(self) -> bool:
        """True when this row asserts a NEW name (as opposed to pinning one)."""
        return self.evidence != "pin"


def load_display_aliases(csv_path: Path) -> list[DisplayAlias]:
    """Parse + validate the alias seed. Raises DisplayAliasError on any defect."""
    if not csv_path.exists():
        raise DisplayAliasError(
            f"curated display-alias seed missing: {csv_path} — every near-tie "
            f"family would silently go back to its argmax label"
        )
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = tuple(reader.fieldnames or ())
        if header != REQUIRED_COLUMNS:
            raise DisplayAliasError(
                f"{csv_path.name}: columns {header} != required {REQUIRED_COLUMNS}"
            )
        aliases: list[DisplayAlias] = []
        seen: dict[str, int] = {}
        for i, row in enumerate(reader, start=2):  # line 1 is the header
            def need(col: str) -> str:
                value = (row.get(col) or "").strip()
                if not value:
                    raise DisplayAliasError(f"{csv_path.name}:{i}: empty {col}")
                return value

            def forbid(col: str, why: str) -> str:
                value = (row.get(col) or "").strip()
                if value:
                    raise DisplayAliasError(
                        f"{csv_path.name}:{i}: {col}={value!r} on an "
                        f"{row.get('evidence', '').strip()!r} row — {why}"
                    )
                return ""

            def need_date(col: str) -> str:
                value = need(col)
                if not _ISO_DATE.match(value):
                    raise DisplayAliasError(
                        f"{csv_path.name}:{i}: {col} {value!r} is not YYYY-MM-DD"
                    )
                try:
                    date.fromisoformat(value)
                except ValueError as exc:
                    raise DisplayAliasError(
                        f"{csv_path.name}:{i}: {col} {value!r}: {exc}"
                    ) from exc
                return value

            evidence = need("evidence")
            if evidence not in EVIDENCE_KINDS:
                raise DisplayAliasError(
                    f"{csv_path.name}:{i}: evidence {evidence!r} not in "
                    f"{EVIDENCE_KINDS} — a row must declare whether a document "
                    f"states this name, whether the lake does, or whether it "
                    f"asserts no new name at all"
                )

            family_key = need("family_key")
            if family_key != family_key.strip() or not family_key:
                raise DisplayAliasError(f"{csv_path.name}:{i}: bad family_key")
            if family_key in seen:
                raise DisplayAliasError(
                    f"{csv_path.name}:{i}: family_key {family_key!r} already "
                    f"aliased on line {seen[family_key]} — a family cannot have "
                    f"two published labels"
                )
            seen[family_key] = i

            display_name = need("display_name")
            if not _LOWERCASE.search(display_name):
                raise DisplayAliasError(
                    f"{csv_path.name}:{i}: display_name {display_name!r} carries no "
                    f"lower-case letter — an alias is a curated display string "
                    f"rendered verbatim, not another shouted registry string; if "
                    f"the registry string is what you want, there is no row to write"
                )

            if evidence in _UNSOURCED_KINDS:
                why = (
                    "this row's evidence is the award lake, not a document; a "
                    "source_url here would claim provenance it does not have"
                )
                source_url = forbid("source_url", why)
                source_form = forbid("source_form", why)
                source_date = forbid("source_date", why)
            else:
                source_url = need("source_url")
                if not source_url.startswith("https://"):
                    raise DisplayAliasError(
                        f"{csv_path.name}:{i}: source_url must be https (got "
                        f"{source_url!r}) — these render as external references, "
                        f"not warehouse citations"
                    )
                source_form = need("source_form")
                source_date = need_date("source_date")

            measured_on = need_date("measured_on")
            if source_date and measured_on < source_date:
                raise DisplayAliasError(
                    f"{csv_path.name}:{i}: measured_on {measured_on!r} precedes "
                    f"source_date {source_date!r} — a row cannot have been "
                    f"checked before its source existed"
                )

            note = need("note")
            if len(note) < MIN_NOTE_CHARS:
                raise DisplayAliasError(
                    f"{csv_path.name}:{i}: note is {len(note)} characters, under "
                    f"{MIN_NOTE_CHARS} — a relabel is an editorial assertion about "
                    f"who a company is, and the margin it overrides has to be "
                    f"written down with it"
                )

            aliases.append(
                DisplayAlias(
                    family_key=family_key,
                    display_name=display_name,
                    evidence=evidence,
                    source_url=source_url,
                    source_form=source_form,
                    source_date=source_date,
                    measured_on=measured_on,
                    note=note,
                )
            )
    if not aliases:
        raise DisplayAliasError(f"{csv_path.name}: no rows")
    return aliases


def alias_map(aliases: list[DisplayAlias]) -> dict[str, str]:
    """``{family_key: published label}`` — the one lookup the exporter needs."""
    return {a.family_key: a.display_name for a in aliases}


def assert_keys_known(
    aliases: list[DisplayAlias], known_family_keys: set[str]
) -> None:
    """Every aliased key must exist in the warehouse.

    An alias for a key that is not there is a typo, and a typo that is silently
    dropped is indistinguishable from a fix that shipped. Raises rather than
    filters — the same rule entity_families.py applies to its own endpoints,
    for the same reason.
    """
    missing = sorted(a.family_key for a in aliases if a.family_key not in known_family_keys)
    if missing:
        raise DisplayAliasError(
            f"entity_display_aliases.csv: {len(missing)} family_key(s) are not in "
            f"dim_entities: {missing} — an alias for a key the warehouse does not "
            f"have relabels nothing, and would ship looking like it had"
        )
