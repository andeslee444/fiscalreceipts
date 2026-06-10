import shutil
import zipfile
from pathlib import Path

import duckdb


class MissingColumnsError(RuntimeError):
    pass


def _sql_path(path: Path) -> str:
    """Escape a filesystem path for interpolation into a DuckDB SQL string literal."""
    return str(path).replace("'", "''")


def _check_columns(con: duckdb.DuckDBPyConnection, parquet_path: Path, required: set[str]) -> None:
    cols = {
        row[0]
        for row in con.execute(
            f"describe select * from read_parquet('{_sql_path(parquet_path)}')"
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

    Converts into a temporary `fy={year}.incoming` partition and swaps it in
    only after every member passes validation: a rejected load preserves the
    prior live partition and the source zip. A crash mid-conversion leaves the
    `.incoming` directory behind; the next run clears it, and dbt's
    `cast(fy as integer)` fails loudly if one is ever read.
    """
    out_dir = parquet_dir / dataset / f"fy={fiscal_year}"
    tmp_dir = parquet_dir / dataset / f"fy={fiscal_year}.incoming"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)
    extract_dir = raw_dir / f"extract_{zip_path.stem}"
    extract_dir.mkdir(parents=True, exist_ok=True)

    part_names: list[str] = []
    con = duckdb.connect()
    try:
        with zipfile.ZipFile(zip_path) as zf:
            members = [m for m in zf.namelist() if m.lower().endswith(".csv")]
            for i, member in enumerate(members):
                csv_path = Path(zf.extract(member, extract_dir))
                out_path = tmp_dir / f"part_{i:03d}.parquet"
                con.execute(
                    f"""
                    copy (select * from read_csv('{_sql_path(csv_path)}', header=true, all_varchar=true))
                    to '{_sql_path(out_path)}' (format parquet, compression zstd)
                    """
                )
                csv_path.unlink()
                _check_columns(con, out_path, required_columns)
                part_names.append(out_path.name)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    finally:
        con.close()
        shutil.rmtree(extract_dir, ignore_errors=True)

    if out_dir.exists():
        shutil.rmtree(out_dir)
    tmp_dir.rename(out_dir)
    zip_path.unlink()
    return [out_dir / name for name in part_names]
