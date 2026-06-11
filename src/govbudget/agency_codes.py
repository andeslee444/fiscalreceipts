"""Canonical agency keys across dataset dialects.

paymentaccuracy.gov slugs (hhs, dow, treasury...), GAO high-risk map
abbreviations (DOD, HHS...), and treasury agency codes (097, 021...) all
name agencies differently. canonical_agency() maps any dialect to one
uppercase key so joins never silently drop rows ('dow' is
paymentaccuracy's Department of War slug == DOD == 097).
"""
CANONICAL = {
    # slug -> canonical
    "dow": "DOD", "dod": "DOD", "hhs": "HHS", "ssa": "SSA", "va": "VA",
    "ed": "ED", "opm": "OPM", "usda": "USDA", "treasury": "TREASURY",
    "dot": "DOT", "sba": "SBA", "hud": "HUD", "dol": "DOL", "dhs": "DHS",
    "fcc": "FCC", "cncs": "CNCS",
    # treasury agency codes -> canonical
    "097": "DOD", "021": "DOD", "017": "DOD", "057": "DOD",
    # GAO abbreviations are already canonical-ish
    "interior": "INTERIOR", "doe": "DOE", "nasa": "NASA", "usps": "USPS",
    "commerce": "COMMERCE", "epa": "EPA", "state": "STATE", "irs": "TREASURY",
}


def canonical_agency(code: str | None) -> str | None:
    if not code:
        return None
    c = code.strip()
    if not c:
        return None
    return CANONICAL.get(c.lower(), c.upper())
