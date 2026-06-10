from govbudget import config


def test_paths_and_constants():
    assert config.DATA_DIR.name == "data"
    assert config.PARQUET_DIR == config.DATA_DIR / "parquet"
    assert config.DOD_TOPTIER_CODE == "097"
    assert config.FY_START == 2017
    assert "contracts" in config.REQUIRED_COLUMNS
