"""Curated corporate rename/acquisition events (PM Sprint 2, spec §P1-3).

`/companies/` listed **RAYTHEON COMPANY $43.7B (#4)** and **RTX CORP $24.6B (#6)**
as two families. They are one company — Raytheon renamed to RTX in 2023 — and
the split understated the combined position by roughly half and misordered the
top ten. Entity resolution cannot see this: the warehouse's `family_key` is a
name-inference over award recipients, and a rename produces two names.

This module carries the fix that name inference cannot: a HAND-CURATED table of
well-documented corporate events, each with an OFFICIAL source (SEC filing or
company press release). It is deliberately NOT a warehouse citation tier —
these rows cite documents outside the lake, they are rendered as explicit
external references, and the site says so plainly. Nothing here is inferred.

Contract:
  * Source of truth: ``data-seeds/entity_family_events.csv`` with columns
    ``family, from_name, to_name, event, effective_date, source_url, note``.
  * Endpoints resolve to warehouse ``family_key`` values through the SAME
    normalizer that MINTED those keys (``govbudget.entities.normalize_name``)
    and only on EXACT normalized equality — no fuzzy matching, ever. An
    endpoint that does not resolve is recorded as unresolved and rendered as
    such; it is never guessed at.
  * A ``family_key`` may belong to AT MOST ONE curated family. Two families
    claiming the same key is the double-count hazard in its seed form, so it
    is a load-time error, not a runtime surprise.
  * Members are DISJOINT by warehouse construction — ``entity_xwalk`` assigns
    each ``recipient_uei`` exactly one ``family_key`` — so the combined total
    is the plain sum of member totals with no risk of double counting. The
    exporter re-asserts that disjointness against the lake at build time.

Loud failures only: a malformed row, an unknown event kind, a non-https source,
or a cross-family key collision raises. A quietly-dropped curated event would
silently restore the very defect this table exists to close.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from govbudget.entities import normalize_name

# The seed's exact column set (locked in the Sprint 2 plan).
REQUIRED_COLUMNS = (
    "family",
    "from_name",
    "to_name",
    "event",
    "effective_date",
    "source_url",
    "note",
)

EVENT_KINDS = ("rename", "acquisition")

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


class FamilyEventsError(ValueError):
    """Raised on any malformed or self-contradicting curated row."""


def slugify(label: str) -> str:
    """URL slug for a family label ("L3Harris Technologies" → l3harris-technologies")."""
    return _SLUG_STRIP.sub("-", label.strip().lower()).strip("-")


@dataclass(frozen=True)
class FamilyEvent:
    """One curated corporate event, exactly as authored in the seed."""

    family: str
    from_name: str
    to_name: str
    event: str
    effective_date: str
    source_url: str
    note: str


def load_family_events(csv_path: Path) -> list[FamilyEvent]:
    """Parse + validate the curated seed. Raises FamilyEventsError on any defect."""
    if not csv_path.exists():
        raise FamilyEventsError(
            f"curated entity-family seed missing: {csv_path} — /companies/ would "
            f"silently go back to splitting renamed companies"
        )
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = tuple(reader.fieldnames or ())
        if header != REQUIRED_COLUMNS:
            raise FamilyEventsError(
                f"{csv_path.name}: columns {header} != required {REQUIRED_COLUMNS}"
            )
        events: list[FamilyEvent] = []
        for i, row in enumerate(reader, start=2):  # line 1 is the header
            def need(col: str) -> str:
                value = (row.get(col) or "").strip()
                if not value:
                    raise FamilyEventsError(f"{csv_path.name}:{i}: empty {col}")
                return value

            event = need("event")
            if event not in EVENT_KINDS:
                raise FamilyEventsError(
                    f"{csv_path.name}:{i}: event {event!r} not in {EVENT_KINDS}"
                )
            effective_date = need("effective_date")
            if not _ISO_DATE.match(effective_date):
                raise FamilyEventsError(
                    f"{csv_path.name}:{i}: effective_date {effective_date!r} is not YYYY-MM-DD"
                )
            try:
                date.fromisoformat(effective_date)
            except ValueError as exc:
                raise FamilyEventsError(
                    f"{csv_path.name}:{i}: effective_date {effective_date!r}: {exc}"
                ) from exc
            source_url = need("source_url")
            if not source_url.startswith("https://"):
                raise FamilyEventsError(
                    f"{csv_path.name}:{i}: source_url must be https (got {source_url!r}) "
                    f"— these render as external references, not warehouse citations"
                )
            from_name = need("from_name")
            to_name = need("to_name")
            if normalize_name(from_name) == normalize_name(to_name):
                raise FamilyEventsError(
                    f"{csv_path.name}:{i}: from_name and to_name normalize identically "
                    f"({normalize_name(from_name)!r}) — that records no event"
                )
            events.append(
                FamilyEvent(
                    family=need("family"),
                    from_name=from_name,
                    to_name=to_name,
                    event=event,
                    effective_date=effective_date,
                    source_url=source_url,
                    note=need("note"),
                )
            )
    if not events:
        raise FamilyEventsError(f"{csv_path.name}: no rows")
    return events


@dataclass(frozen=True)
class ResolvedEndpoint:
    """One side of an event, and the warehouse family it resolved to (or not)."""

    name: str
    family_key: str | None

    @property
    def resolved(self) -> bool:
        return self.family_key is not None


@dataclass
class ResolvedEvent:
    event: FamilyEvent
    from_endpoint: ResolvedEndpoint
    to_endpoint: ResolvedEndpoint


@dataclass
class ResolvedFamily:
    """A curated family: its label, its warehouse members, and its events."""

    label: str
    slug: str
    #: warehouse family_keys, deduped; order is decided by the caller (by size).
    member_keys: list[str] = field(default_factory=list)
    events: list[ResolvedEvent] = field(default_factory=list)


def resolve_families(
    events: list[FamilyEvent],
    known_family_keys: set[str],
) -> list[ResolvedFamily]:
    """Group curated events into families and resolve their endpoints.

    ``known_family_keys`` is the warehouse's ``dim_entities.family_key`` set.
    Resolution is exact normalized equality — the same normalizer that minted
    those keys. Endpoints that do not resolve are kept (and reported), never
    guessed at.

    Raises FamilyEventsError when two curated families claim the same
    ``family_key`` — the seed-level form of a double count.
    """
    by_label: dict[str, ResolvedFamily] = {}
    order: list[str] = []
    for ev in events:
        if ev.family not in by_label:
            by_label[ev.family] = ResolvedFamily(
                label=ev.family, slug=slugify(ev.family)
            )
            order.append(ev.family)
        fam = by_label[ev.family]

        def endpoint(name: str) -> ResolvedEndpoint:
            key = normalize_name(name)
            return ResolvedEndpoint(
                name=name, family_key=key if key in known_family_keys else None
            )

        resolved = ResolvedEvent(ev, endpoint(ev.from_name), endpoint(ev.to_name))
        fam.events.append(resolved)
        for ep in (resolved.from_endpoint, resolved.to_endpoint):
            if ep.family_key and ep.family_key not in fam.member_keys:
                fam.member_keys.append(ep.family_key)

    # The family LABEL itself is a member when it names a warehouse family
    # (e.g. "Northrop Grumman" → NORTHROP GRUMMAN): the anchor row must be
    # inside its own family, or the merge would leave the parent behind.
    for label in order:
        fam = by_label[label]
        anchor = normalize_name(label)
        if anchor in known_family_keys and anchor not in fam.member_keys:
            fam.member_keys.insert(0, anchor)

    # A family_key may belong to at most one curated family.
    owner: dict[str, str] = {}
    for label in order:
        for key in by_label[label].member_keys:
            if key in owner and owner[key] != label:
                raise FamilyEventsError(
                    f"family_key {key!r} is claimed by both {owner[key]!r} and "
                    f"{label!r} — a key in two families would double-count its "
                    f"obligations on /companies/"
                )
            owner[key] = label

    # Drop families with fewer than one resolved member: an all-unresolved
    # family merges nothing. Its EVENTS still ship (the table is the asset) —
    # the caller keeps the full event list separately.
    return [by_label[label] for label in order]
