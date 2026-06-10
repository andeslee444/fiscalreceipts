from govbudget.entities import family_key, normalize_name


def test_normalize_strips_legal_noise():
    assert normalize_name("THE BOEING COMPANY") == "BOEING"
    assert normalize_name("BOEING COMPANY, THE (INC)") == "BOEING"
    assert normalize_name("Huntington Ingalls Industries, Inc") == "HUNTINGTON INGALLS INDUSTRIES"
    assert normalize_name("LOCKHEED MARTIN CORPORATION") == "LOCKHEED MARTIN"
    assert normalize_name("ACME RESEARCH, L.L.C.") == "ACME RESEARCH"


def test_family_key_prefers_parent_then_normalized_name():
    assert family_key(parent_uei="P1", parent_name="THE BOEING COMPANY",
                      recipient_uei="U1", recipient_name="BOEING DEFENSE") == ("uei", "P1")
    assert family_key(parent_uei=None, parent_name=None,
                      recipient_uei="U2", recipient_name="SOLO LLC") == ("name", "SOLO")
    assert family_key(parent_uei=None, parent_name="ORPHAN PARENT INC",
                      recipient_uei="U3", recipient_name="X") == ("name", "ORPHAN PARENT")


def test_distinct_parents_same_normalized_name_share_family():
    # Two parent UEIs whose names normalize identically belong to one family
    # at the NAME level — the dbt layer merges via normalized parent name.
    assert normalize_name("THE BOEING COMPANY") == normalize_name("BOEING COMPANY, THE (INC)")
