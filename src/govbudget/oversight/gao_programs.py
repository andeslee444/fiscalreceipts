"""GAO Weapon Systems Annual Assessment (WSAA) -> gao_program_assessments.parquet.

The DEPARTMENT tier already exists (``high_risk.py`` — "DOD: 5 high-risk
areas").  This module adds the PROGRAM tier that ROADMAP #30 asks for: GAO's
annual, per-program assessments of DOD's costliest weapon programs, plus the
program-specific GAO reports the same volume lists as related products.

Source (verified live, August 2026)
-----------------------------------
``https://www.gao.gov/assets/gao-25-107569.pdf`` — one PDF per edition, 233
pages.  Two structures are read out of it:

1. **Appendix I: Program Assessments** — a one- or two-page spread per
   program.  The first page of each spread opens with a machine-readable
   banner, then the program-name heading, then GAO's own description::

       Air Force Program Type: MDAP Common Name: Sentinel
       LGM-35A Sentinel
       The Air Force's Sentinel, formerly the Ground Based Strategic
       Deterrent, is intended to replace the Minuteman III ...
       Source: U.S. Air Force. | GAO-25-107569

   Each service section also prints an index table whose assessment-type
   column carries one token per program; that count is the parser's
   cross-check, and a shortfall is reported rather than swallowed.

2. **Related GAO Products** — a bibliography of program-specific and
   portfolio-level GAO reports, each as
   ``Title. GAO-NN-NNNNNN. Washington, D.C.: Month D, YYYY.``

Politeness: exactly ONE HTTP GET per edition, to a static PDF asset under
``/assets/``.  ``gao.gov/robots.txt`` disallows ``/search`` and
``/reports-testimonies``; neither is used.  The PDF is cached under
``data/raw/gao/`` and reused.

Parquet columns (typed at ingestion — backlog #11):
    kind varchar, product_number varchar, report_title varchar,
    report_url varchar, source_product varchar, source_pdf_url varchar,
    released varchar, service varchar, assessment_type varchar,
    program_name varchar, common_name varchar, report_page integer,
    pdf_page integer, description varchar

``kind`` is ``assessment`` (Appendix I) or ``related_product``.

NOTE: this module ingests GAO's work.  It does NOT decide which budget line
each item belongs to — that crosswalk is human-ratified in
``data-seeds/gao_program_xwalk.csv`` and measured by ``gao_xwalk.py``, because
attributing a GAO finding to the wrong weapons program is a defamation-shaped
error, not a formatting one.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import duckdb
import httpx

# ── Editions ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Edition:
    product_number: str
    report_title: str
    released: str  # ISO yyyy-mm

    @property
    def slug(self) -> str:
        return self.product_number.lower()

    @property
    def pdf_url(self) -> str:
        return f"https://www.gao.gov/assets/{self.slug}.pdf"

    @property
    def report_url(self) -> str:
        return f"https://www.gao.gov/products/{self.slug}"


EDITIONS: tuple[Edition, ...] = (
    Edition(
        product_number="GAO-25-107569",
        report_title=(
            "Weapon Systems Annual Assessment: DOD Leaders Should Ensure That "
            "Newer Programs Are Structured for Speed and Innovation"
        ),
        released="2025-06",
    ),
)

USER_AGENT = (
    "FiscalReceipts/1.0 (+https://fiscalreceipts.com; "
    "contact andes.lee444@gmail.com)"
)

# ── Shared helpers ──────────────────────────────────────────────────────────

_ASSESSMENT_TYPES = (
    "MDAP Increment",
    "MDAP",
    "MTA",
    "Future Major Weapon Acquisition/MTA",
    "Future Major Weapon Acquisition",
)


def _clean(text: str) -> str:
    """Normalize quotes/ligatures and collapse whitespace."""
    text = text.replace("­", "")
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")
    return re.sub(r"\s+", " ", text).strip()


def _key(text: str) -> str:
    """Join key: lowercase alphanumerics only.

    One PDF spells the same thing several ways — "MDAP Incremen t" where the
    kerning broke, "F-22SeE" in an index table against "F-22 SeE" on the
    banner.  Punctuation and spacing carry no meaning across those spellings.
    """
    return re.sub(r"[^a-z0-9]", "", text.lower())


_TYPE_BY_KEY = {_key(t): t for t in _ASSESSMENT_TYPES}

# One anchor per program in a service index table.  The longest type wraps
# across typeset lines with the program NAME between its halves ("Future Major
# Weapon" / name / "Acquisition"), so its first half is the anchor and the
# orphaned "Acquisition/MTA" tail must not count a second time.
_TYPE_ANCHOR_RE = re.compile(
    r"Future Major Weapon|MDAP Increment|MDAP|(?<!Acquisition/)\bMTA\b"
)

# ── Appendix I parsing ──────────────────────────────────────────────────────

_BANNER_RE = re.compile(
    r"^[ \t]*(Air Force|Army|Navy|Space Force|Marine Corps|Joint)\s+"
    r"Program Type:\s*(.+?)\s+Common Name:\s*(.+?)[ \t]*$",
    re.MULTILINE,
)
# The footer's kerning breaks inside words on some pages ("U.S. Govern ment"),
# so every literal here tolerates an interior space.
_PAGENO_RE = re.compile(
    r"Page\s+(\d+)\s+U\.\s?S\.\s+Govern\s*ment\s+Account\s*ability\s+"
    r"Office\s+GAO-\d\d-\d+"
)
_MAX_HEADING_LINES = 3

# The image credit is typeset in the left rail, so on 13 of the 65 spreads it
# lands INSIDE GAO's paragraph — "…prior to making | Source: Raytheon. |
# GAO-25-107569 | a full production decision."  Cutting at it would ship a
# sentence fragment as a verbatim quote, so the credit is excised first and
# the paragraph is cut at a structural marker afterwards.
_CREDIT_RE = re.compile(
    r"Source[s]?\s*(?:\([^)]*\))?\s*:.{0,140}?\|\s*GAO-\d\d-\d+\s*"
)

# Everything that can follow GAO's description paragraph on the spread's first
# page: the performance chart's caption, the software and essentials side
# panels, the leading-practices table, a footnote, an uncredited "Source:".
_DESC_END_RE = re.compile(
    r"Source[s]?\s*(?:\(.*?\))?\s*:"
    r"|Program Performance\b"
    r"|Software Development\b"
    r"|Program Essentials\b"
    r"|Implementation of Leading\b"
    r"|Attainment of Product\b"
    r"|Total quantities\b"
    r"|Estimated\s+(?:\w+\s+){0,5}?Cost and Quantit"
    r"|Current Status\b"
    r"|\ba?GAO-\d\d-\d+"
)

# Nothing that survives the cut may look like a figure caption or a dollar
# amount: a currency token in prose is an uncited figure (site gate 2), and a
# stray caption is proof the cut missed.  Tripping this is a parse defect.
DESC_RESIDUE_RE = re.compile(
    r"[\$€£]"
    r"|\bdollars in (?:millions|billions)\b"
    r"|\bfiscal year \d{4} dollars\b"
)

_MIN_DESCRIPTION_CHARS = 120


@dataclass
class Assessment:
    kind: str
    product_number: str
    report_title: str
    report_url: str
    source_product: str
    source_pdf_url: str
    released: str
    service: str
    assessment_type: str
    program_name: str
    common_name: str
    report_page: int
    pdf_page: int
    description: str


def index_table_program_counts(pages: list[str]) -> int:
    """How many programs the service index tables say Appendix I contains.

    The tables wrap names and types across typeset lines in two different
    interleavings, so the NAMES are not reliably recoverable from them — but
    the assessment-type column is one token per program, and counting those
    is robust.  This number is the parser's expected population.
    """
    total = 0
    for raw in pages:
        if not raw or "Program name Assessment type" not in raw:
            continue
        block = raw.split("Program name Assessment type", 1)[1]
        block = re.split(r"Source[s]?\s*(?:\(.*?\))?\s*:", block)[0]
        total += len(_TYPE_ANCHOR_RE.findall(block))
    return total


def _split_heading(lines: list[str], common_name: str) -> tuple[str, int]:
    """Return (heading, number of lines consumed).

    The heading runs for however many lines it takes for the accumulated text
    to contain the banner's common name — one line for "LGM-35A Sentinel",
    two for "F-15 Eagle Passive Active Warning Survivability System" +
    "(F-15 EPAWSS)".  Reading the name the banner already gave us beats
    guessing where GAO's first sentence starts; an earlier cut guessed, and
    swallowed GAO's opening clause on two programs.
    """
    want = _key(common_name)
    acc = ""
    for n, line in enumerate(lines[:_MAX_HEADING_LINES], start=1):
        acc = f"{acc} {line}".strip()
        if want and want in _key(acc):
            return _clean(acc), n
    return "", 0


def _last_sentence(text: str) -> str:
    """Trim to the last complete sentence.

    The column cut can land mid-clause.  A quote that stops mid-sentence
    reads as GAO trailing off; ending on GAO's own full stop does not change
    what GAO said, and dropping the fragment is the conservative direction.
    """
    text = text.strip()
    at = text.rfind(". ")
    if text.endswith("."):
        return text
    return text[: at + 1].strip() if at > 0 else text


def parse_edition_pages(pages: list[str], edition: Edition) -> list[Assessment]:
    """One Assessment per Appendix I program.  ``pages[i]`` is PDF page i+1."""
    out: list[Assessment] = []
    seen: set[str] = set()
    for idx, raw in enumerate(pages):
        if not raw:
            continue
        banner = _BANNER_RE.search(raw)
        pageno = _PAGENO_RE.search(raw)
        if banner is None or pageno is None:
            continue
        service = banner.group(1).strip()
        atype = _TYPE_BY_KEY.get(_key(banner.group(2)))
        common = _clean(banner.group(3))
        if atype is None or not common:
            continue
        if _key(common) in seen:
            continue  # continuation page of a two-page spread

        body_lines = [
            ln for ln in raw[banner.end():].splitlines() if ln.strip()
        ]
        heading, used = _split_heading(body_lines, common)
        if not heading:
            continue
        tail = _clean(_CREDIT_RE.sub(" ", " ".join(body_lines[used:])))
        stop = _DESC_END_RE.search(tail)
        description = _last_sentence(tail[: stop.start()] if stop else tail)
        # A heading that wraps onto a second line ("T-AO 205 John Lewis Class
        # Fleet Replenishment Oiler" / "(T-AO 205)") is already satisfied by
        # line one, so its parenthetical tail falls into the paragraph.
        description = re.sub(r"^\([^)]*\)\s*", "", description).strip()
        if len(description) < _MIN_DESCRIPTION_CHARS:
            continue

        seen.add(_key(common))
        out.append(
            Assessment(
                kind="assessment",
                product_number=edition.product_number,
                report_title=edition.report_title,
                report_url=edition.report_url,
                source_product=edition.product_number,
                source_pdf_url=edition.pdf_url,
                released=edition.released,
                service=service,
                assessment_type=atype,
                program_name=heading,
                common_name=common,
                report_page=int(pageno.group(1)),
                pdf_page=idx + 1,
                description=description,
            )
        )
    return out


# ── Related GAO Products parsing ────────────────────────────────────────────

_RELATED_RE = re.compile(
    r"(?P<title>[A-Z][^.]*?:[^.]*?)\.\s*"
    r"(?P<product>GAO[-/][A-Z0-9-]+)\.\s*"
    r"Washington, D\.C\.:\s*(?P<date>[A-Z][a-z]+ \d{1,2}, \d{4})"
)
_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        "January February March April May June July August September "
        "October November December".split()
    )
}




_RELATED_BODY_X0 = 210.0
_RELATED_ROW_TOL = 3.0
_RUNNING_HEADER_RE = re.compile(r"R?\s*elated\s+GAO\s+P\s*roducts")


def related_column_text(pdf_path: Path) -> str:
    """Text of the Related GAO Products bibliography, left rail removed.

    The appendix is typeset in two columns: a left rail of category labels
    ("Acquisition Policy and Reform") and a right column of citations.  Line
    extraction folds them together word by word, which corrupts the FIRST
    title under every label — and those titles ship verbatim.  Splitting on
    the words' own x-coordinates keeps the citation column intact instead of
    trying to subtract the labels back out afterwards.
    """
    import pdfplumber

    out: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "Washington, D.C.:" not in text:
                continue
            rows: dict[int, list[tuple[float, str]]] = {}
            for w in page.extract_words():
                if w["x0"] < _RELATED_BODY_X0:
                    continue
                key = int(w["top"] / _RELATED_ROW_TOL)
                rows.setdefault(key, []).append((w["x0"], w["text"]))
            for key in sorted(rows):
                line = " ".join(t for _, t in sorted(rows[key]))
                out.append(_RUNNING_HEADER_RE.sub(" ", line))
    return "\n".join(out)


def parse_related_products(text: str, edition: Edition) -> list[Assessment]:
    """One Assessment(kind="related_product") per bibliography entry."""
    blob = _clean(
        re.sub(
            r"Page \d+ GAO-\d\d-\d+ Weapon Systems Annual Assessment",
            " ",
            text,
        )
    )
    out: list[Assessment] = []
    seen: set[str] = set()
    for m in _RELATED_RE.finditer(blob):
        product = m.group("product").strip()
        if product in seen or product == edition.product_number:
            continue
        title = _clean(m.group("title"))
        if ":" not in title or len(title) < 20:
            continue
        month, day, year = re.match(
            r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", m.group("date")
        ).groups()
        seen.add(product)
        out.append(
            Assessment(
                kind="related_product",
                product_number=product,
                report_title=title,
                report_url=f"https://www.gao.gov/products/{product.lower()}",
                source_product=edition.product_number,
                source_pdf_url=edition.pdf_url,
                released=f"{year}-{_MONTHS[month]:02d}-{int(day):02d}",
                service="",
                assessment_type="",
                program_name=title.split(":", 1)[0].strip(),
                common_name="",
                report_page=0,
                pdf_page=0,
                description="",
            )
        )
    return out


# ── Fetch + build ───────────────────────────────────────────────────────────


def fetch_edition_pdf(
    client: httpx.Client, edition: Edition, *, raw_dir: Path
) -> Path:
    """Download (or reuse) the edition PDF under ``raw_dir``."""
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    dest = raw_dir / f"{edition.slug}.pdf"
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(
            f"gao-programs: reusing cached {dest.name} "
            f"({dest.stat().st_size:,} bytes)"
        )
        return dest
    r = client.get(edition.pdf_url, follow_redirects=True)
    r.raise_for_status()
    dest.write_bytes(r.content)
    sha = hashlib.sha256(r.content).hexdigest()[:16]
    print(
        f"gao-programs: fetched {edition.pdf_url} "
        f"({len(r.content):,} bytes, sha256:{sha})"
    )
    return dest


def extract_pdf_pages(pdf_path: Path) -> list[str]:
    """Per-page text, via pdfplumber.

    pypdf was tried first and rejected: it emits the two-page spreads out of
    reading order (the image credit lands above the heading on 19 of 65) and
    breaks words across its own line breaks — "Production Is sues", "Making
    C ritical".  A verbatim quote reassembled from broken words is not
    verbatim, so the reader that keeps words intact wins.
    """
    import pdfplumber

    with pdfplumber.open(str(pdf_path)) as pdf:
        return [(page.extract_text() or "") for page in pdf.pages]


_COLUMNS = (
    "kind varchar, product_number varchar, report_title varchar,"
    "report_url varchar, source_product varchar, source_pdf_url varchar,"
    "released varchar, service varchar, assessment_type varchar,"
    "program_name varchar, common_name varchar, report_page integer,"
    "pdf_page integer, description varchar"
)
_FIELDS = (
    "kind", "product_number", "report_title", "report_url", "source_product",
    "source_pdf_url", "released", "service", "assessment_type",
    "program_name", "common_name", "report_page", "pdf_page", "description",
)


def build_gao_program_assessments(
    client: httpx.Client, *, raw_dir: Path, out_path: Path
) -> Path:
    """Fetch every edition, parse it, write the parquet."""
    rows: list[Assessment] = []
    for edition in EDITIONS:
        pdf = fetch_edition_pdf(client, edition, raw_dir=raw_dir)
        pages = extract_pdf_pages(pdf)
        parsed = parse_edition_pages(pages, edition)
        expected = index_table_program_counts(pages)
        related = parse_related_products(related_column_text(pdf), edition)
        print(
            f"gao-programs: {edition.product_number} -> {len(parsed)}/"
            f"{expected} Appendix I program assessments, "
            f"{len(related)} related products"
        )
        if not parsed:
            raise RuntimeError(
                f"gao-programs: parsed 0 assessments from {pdf} — the layout "
                "changed; fix the parser rather than shipping nothing"
            )
        if len(parsed) != expected:
            print(
                f"  WARNING: {expected - len(parsed)} Appendix I program(s) "
                "counted in the index tables have no parsed assessment"
            )
        residue = [a for a in parsed if DESC_RESIDUE_RE.search(a.description)]
        if residue:
            raise RuntimeError(
                "gao-programs: description text carries a figure caption or "
                "currency token for "
                + ", ".join(a.common_name for a in residue[:5])
                + " — the paragraph cut missed, and a dollar figure in prose "
                "is an uncited figure"
            )
        rows.extend(parsed)
        rows.extend(related)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(f"create table _ga ({_COLUMNS})")
        con.executemany(
            "insert into _ga values (" + ",".join(["?"] * len(_FIELDS)) + ")",
            [tuple(asdict(r)[f] for f in _FIELDS) for r in rows],
        )
        con.execute(
            f"copy _ga to '{out_path}' (format parquet, compression zstd)"
        )
    finally:
        con.close()
    print(f"gao-programs: wrote {len(rows)} rows -> {out_path}")
    return out_path
