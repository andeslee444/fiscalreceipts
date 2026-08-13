from govbudget.export_site import apply_title_override, load_title_overrides


def test_override_applies_to_the_listed_pe():
    ov = load_title_overrides()
    assert apply_title_override("0603183D8Z", "Joint Hypersonic Technology Development &Transition", ov) == \
        "Joint Hypersonic Technology Development & Transition"


def test_override_does_not_touch_an_unlisted_pe():
    ov = load_title_overrides()
    assert apply_title_override("0601101E", "Defense Research Sciences", ov) == "Defense Research Sciences"


def test_override_refuses_when_the_source_title_has_changed():
    """If the workbook is corrected upstream, the override must stop applying
    rather than silently rewrite a title it no longer matches."""
    ov = load_title_overrides()
    fixed = "Joint Hypersonic Technology Development & Transition"
    assert apply_title_override("0603183D8Z", fixed, ov) == fixed
