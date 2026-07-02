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


def test_load_env_file(tmp_path, monkeypatch):
    from govbudget.config import _load_env_file

    env = tmp_path / ".env"
    env.write_text(
        "# comment line\n"
        "\n"
        "ANTHROPIC_API_KEY=sk-ant-test-123\n"
        'QUOTED_VALUE="hello world"\n'
        "ALREADY_SET=from-file\n"
        "not a valid line\n"
    )
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("QUOTED_VALUE", raising=False)
    monkeypatch.setenv("ALREADY_SET", "from-environment")

    _load_env_file(env)

    import os

    assert os.environ["ANTHROPIC_API_KEY"] == "sk-ant-test-123"
    assert os.environ["QUOTED_VALUE"] == "hello world"
    # real environment always wins — never overridden by the file
    assert os.environ["ALREADY_SET"] == "from-environment"


def test_load_env_file_missing_is_noop(tmp_path):
    from govbudget.config import _load_env_file

    _load_env_file(tmp_path / "does-not-exist.env")  # must not raise
