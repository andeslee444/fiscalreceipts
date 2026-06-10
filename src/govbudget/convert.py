import shutil
import zipfile
from pathlib import Path

import duckdb


class MissingColumnsError(RuntimeError):
    pass


def _check_columns(con: duckdb.DuckDBPyConnection, parquet_path: Path, required: set[str]) -> None:
    cols = {
        row[0]
        for row in con.execute(
            f"describe select * from read_parquet('{parquet_path}')"
        ).fetchall()
    }
    missing = required - cols
    if missing:
        raise MissingColumnsError(
            f"{parquet_path.name} missing required columns: {sorted(missing)}"
        )


def convert_zip_to_parquet(
    zip_path: Path,
    *,
    dataset: str,
    fiscal_year: int,
    parquet_dir: Path,
    raw_dir: Path,
    required_columns: set[str],
) -> list[Path]:
    """Extract CSV members one at a time, convert to zstd Parquet, delete raws.

    Replaces the whole fy partition (archive Full files supersede prior months).
    """
    out_dir = parquet_dir / dataset / f"fy={fiscal_year}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    extract_dir = raw_dir / f"extract_{zip_path.stem}"
    extract_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    con = duckdb.connect()
    try:
        with zipfile.ZipFile(zip_path) as zf:
            members = [m for m in zf.namelist() if m.lower().endswith(".csv")]
            for i, member in enumerate(members):
                csv_path = Path(zf.extract(member, extract_dir))
                out_path = out_dir / f"part_{i:03d}.parquet"
                con.execute(
                    f"""
                    copy (select * from read_csv('{csv_path}', header=true, all_varchar=true))
                    to '{out_path}' (format parquet, compression zstd)
                    """
                )
                csv_path.unlink()
                _check_columns(con, out_path, required_columns)
                written.append(out_path)
    finally:
        con.close()
        shutil.rmtree(extract_dir, ignore_errors=True)
    zip_path.unlink()
    return written
