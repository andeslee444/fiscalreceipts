"""Tests for scripts/launch/ tooling.

Automated checks (no real R2 credentials needed):

1. rewrite-config.mjs round-trip: given a host URL, produces valid JSON with
   the correct assetBaseUrl in site/public/config.json.

2. cors_live_test.sh self-skips cleanly (exit 0, prints SKIPPED) when
   R2_HOST and SITE_URL are absent from the environment.

These tests use subprocess so they exercise the actual scripts, not mocks.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
LAUNCH_DIR = REPO_ROOT / "scripts" / "launch"
REWRITE_SCRIPT = LAUNCH_DIR / "rewrite-config.mjs"
CORS_SCRIPT = LAUNCH_DIR / "cors_live_test.sh"


# ---------------------------------------------------------------------------
# rewrite-config.mjs
# ---------------------------------------------------------------------------


def _run_rewrite(url: str, tmp_site: Path) -> subprocess.CompletedProcess:
    """Run rewrite-config.mjs with a temp site/public dir."""
    env = {**os.environ, "REPO_ROOT_OVERRIDE": str(tmp_site)}
    return subprocess.run(
        ["node", str(REWRITE_SCRIPT), url],
        capture_output=True,
        text=True,
        env=env,
    )


def _setup_temp_site(tmp_path: Path) -> tuple[Path, Path]:
    """Create a minimal site/ tree under tmp_path that rewrite-config expects."""
    public_dir = tmp_path / "site" / "public"
    public_dir.mkdir(parents=True)
    # Seed an existing config.json so the "before" path is exercised
    (public_dir / "config.json").write_text(
        json.dumps({"assetBaseUrl": "/assets"}) + "\n"
    )
    out_dir = tmp_path / "site" / "out"
    out_dir.mkdir(parents=True)
    (out_dir / "config.json").write_text(
        json.dumps({"assetBaseUrl": "/assets"}) + "\n"
    )
    return public_dir, out_dir


class TestRewriteConfig:
    """rewrite-config.mjs round-trip tests."""

    def test_valid_https_url_writes_public_config(self, tmp_path, monkeypatch):
        """Given an https URL, site/public/config.json gets assetBaseUrl."""
        public_dir, out_dir = _setup_temp_site(tmp_path)

        # Patch the script to operate in tmp_path by symlinking repo script
        # but overriding its __dirname-derived repo root.
        # We achieve this by creating a shim that sets the working directory.
        # Since the script uses import.meta.url to find repoRoot, we instead
        # copy the script into tmp_path/scripts/launch/ so it resolves correctly.
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        url = "https://pub-abc123.r2.dev"
        result = subprocess.run(
            ["node", str(shim_script), url],
            capture_output=True,
            text=True,
        )

        # Should succeed
        assert result.returncode == 0, (
            f"rewrite-config.mjs failed:\n{result.stderr}"
        )

        # The shim script resolves repoRoot relative to its own location,
        # i.e. tmp_path/ — so we check the file it wrote.
        public_cfg = tmp_path / "site" / "public" / "config.json"
        assert public_cfg.exists(), "site/public/config.json was not written"
        data = json.loads(public_cfg.read_text())
        assert data == {"assetBaseUrl": url}, (
            f"Expected assetBaseUrl={url!r}, got {data}"
        )

    def test_trailing_slash_is_stripped(self, tmp_path):
        """URL with trailing slash is normalised — no trailing slash in output."""
        public_dir, _ = _setup_temp_site(tmp_path)
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        url = "https://pub-abc123.r2.dev/"
        result = subprocess.run(
            ["node", str(shim_script), url],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

        public_cfg = tmp_path / "site" / "public" / "config.json"
        data = json.loads(public_cfg.read_text())
        assert not data["assetBaseUrl"].endswith("/"), (
            "Trailing slash should be stripped"
        )
        assert data["assetBaseUrl"] == "https://pub-abc123.r2.dev"

    def test_http_url_accepted(self, tmp_path):
        """http:// URLs (localhost) are accepted for local dev."""
        public_dir, _ = _setup_temp_site(tmp_path)
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        url = "http://localhost:4000"
        result = subprocess.run(
            ["node", str(shim_script), url],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

        public_cfg = tmp_path / "site" / "public" / "config.json"
        data = json.loads(public_cfg.read_text())
        assert data["assetBaseUrl"] == url

    def test_invalid_url_exits_1(self, tmp_path):
        """A non-URL argument causes exit 1."""
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        result = subprocess.run(
            ["node", str(shim_script), "not-a-url"],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0, "Expected non-zero exit for invalid URL"

    def test_no_url_exits_1(self, tmp_path):
        """No URL argument causes exit 1."""
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        # Ensure ASSET_BASE_URL is not set
        env = {k: v for k, v in os.environ.items() if k != "ASSET_BASE_URL"}
        result = subprocess.run(
            ["node", str(shim_script)],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode != 0, "Expected non-zero exit when no URL given"

    def test_env_var_fallback(self, tmp_path):
        """ASSET_BASE_URL env var is used when no argv is given."""
        public_dir, _ = _setup_temp_site(tmp_path)
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        url = "https://env-fallback.r2.dev"
        env = {**os.environ, "ASSET_BASE_URL": url}
        result = subprocess.run(
            ["node", str(shim_script)],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr

        public_cfg = tmp_path / "site" / "public" / "config.json"
        data = json.loads(public_cfg.read_text())
        assert data["assetBaseUrl"] == url

    def test_output_is_valid_json(self, tmp_path):
        """The written config.json is parseable JSON (not truncated/corrupt)."""
        public_dir, _ = _setup_temp_site(tmp_path)
        shim_launch = tmp_path / "scripts" / "launch"
        shim_launch.mkdir(parents=True)
        shim_script = shim_launch / "rewrite-config.mjs"
        shim_script.write_text(REWRITE_SCRIPT.read_text())

        url = "https://valid-json-test.r2.dev"
        subprocess.run(["node", str(shim_script), url], check=True, capture_output=True)

        public_cfg = tmp_path / "site" / "public" / "config.json"
        raw = public_cfg.read_text()
        # Must parse without raising
        data = json.loads(raw)
        # Must have exactly the assetBaseUrl key
        assert set(data.keys()) == {"assetBaseUrl"}


# ---------------------------------------------------------------------------
# cors_live_test.sh — SKIPPED path
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not shutil.which("bash"),
    reason="bash not available",
)
class TestCorsLiveTestSkipped:
    """cors_live_test.sh must exit 0 and print SKIPPED when env vars absent."""

    def _run_cors_test(self, env: dict | None = None) -> subprocess.CompletedProcess:
        run_env = {k: v for k, v in os.environ.items()
                   if k not in ("R2_HOST", "SITE_URL")}
        if env:
            run_env.update(env)
        return subprocess.run(
            ["bash", str(CORS_SCRIPT)],
            capture_output=True,
            text=True,
            env=run_env,
        )

    def test_exits_0_without_env(self):
        """Without R2_HOST/SITE_URL the script exits 0 (not 1)."""
        result = self._run_cors_test()
        assert result.returncode == 0, (
            f"Expected exit 0 (SKIPPED), got {result.returncode}.\n"
            f"stderr: {result.stderr}\nstdout: {result.stdout}"
        )

    def test_prints_skipped_banner(self):
        """Without env vars the output contains the SKIPPED banner."""
        result = self._run_cors_test()
        assert "SKIPPED" in result.stdout, (
            f"Expected 'SKIPPED' in output.\nstdout: {result.stdout}"
        )

    def test_prints_checklist(self):
        """Without env vars the output contains the manual checklist hint."""
        result = self._run_cors_test()
        assert "OPTIONS" in result.stdout, (
            "Expected manual checklist (OPTIONS) in output"
        )
        assert "Range" in result.stdout or "range" in result.stdout, (
            "Expected 'range' in checklist output"
        )

    def test_r2_host_only_still_skips(self):
        """If only R2_HOST is set (SITE_URL absent) → still SKIPPED."""
        result = self._run_cors_test(env={"R2_HOST": "https://pub-test.r2.dev"})
        assert result.returncode == 0
        assert "SKIPPED" in result.stdout

    def test_site_url_only_still_skips(self):
        """If only SITE_URL is set (R2_HOST absent) → still SKIPPED."""
        result = self._run_cors_test(env={"SITE_URL": "https://govbudget.vercel.app"})
        assert result.returncode == 0
        assert "SKIPPED" in result.stdout
