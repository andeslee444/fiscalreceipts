from govbudget import config


def test_paths_and_constants():
    assert config.DATA_DIR.name == "data"
    assert config.PARQUET_DIR == config.DATA_DIR / "parquet"
    assert config.DOD_TOPTIER_CODE == "097"
    assert config.FY_START == 2017
    assert "contracts" in config.REQUIRED_COLUMNS
    assert config.DATA_DIR.is_absolute()


def test_site_constants():
    from govbudget import config

    assert config.SITE_DIR == config.DATA_DIR / "site"
    assert config.PDF_BASE_URL  # non-empty; env-overridable


def test_research_dir_defined_and_absolute():
    from govbudget import config
    from pathlib import Path

    assert hasattr(config, "RESEARCH_DIR"), "RESEARCH_DIR must be defined in config"
    assert Path(config.RESEARCH_DIR).is_absolute(), "RESEARCH_DIR must be an absolute path"
    # Must end with data/research (ROOT-relative, not DATA_DIR-relative)
    rdir = str(config.RESEARCH_DIR)
    assert rdir.endswith("data/research") or rdir.endswith("data\\research"), \
        f"RESEARCH_DIR should be ROOT/data/research, got: {rdir}"
