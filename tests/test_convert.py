import zipfile

import duckdb
import pytest

from govbudget.convert import MissingColumnsError, convert_zip_to_parquet

CONTRACT_HEADER = (
    "contract_transaction_unique_key,action_date,federal_action_obligation,"
    "recipient_uei,recipient_name,recipient_parent_uei,recipient_parent_name,"
    "awarding_agency_name,awarding_sub_agency_name,naics_code,"
    "product_or_service_code,primary_place_of_performance_state_code"
)
CONTRACT_ROWS = [
    'K1,2017-01-15,1000.50,UEI1,ACME CORP,PUEI1,ACME PARENT,Department of Defense,Dept of the Army,336411,1510,CA',
    'K2,2017-03-02,-50.25,UEI2,BETA LLC,,,Department of Defense,Dept of the Navy,541330,R425,VA',
    'K3,2017-04-01,12.00,UEI3,"GAMMA, INC.",,,Department of Defense,Dept of the Air Force,334511,AC13,TX',
]


def make_zip(tmp_path, name, header, rows, members=2):
    zip_path = tmp_path / name
    with zipfile.ZipFile(zip_path, "w") as zf:
        for i in range(members):
            zf.writestr(f"part_{i}.csv", header + "\n" + "\n".join(rows) + "\n")
    return zip_path


def test_convert_writes_partitioned_parquet_and_cleans_up(tmp_path):
    zip_path = make_zip(tmp_path, "FY2017_097_Contracts_Full_20260607.zip", CONTRACT_HEADER, CONTRACT_ROWS)
    parquet_dir = tmp_path / "parquet"
    raw_dir = tmp_path / "raw"
    written = convert_zip_to_parquet(
        zip_path, dataset="contracts", fiscal_year=2017,
        parquet_dir=parquet_dir, raw_dir=raw_dir,
        required_columns={"contract_transaction_unique_key", "action_date"},
    )
    assert len(written) == 2
    out = duckdb.sql(
        f"select count(*) n, count(distinct fy) fys from read_parquet('{parquet_dir}/contracts/*/*.parquet', hive_partitioning=true)"
    ).fetchone()
    assert out == (6, 1)  # 2 members x 3 rows, one fy partition
    assert not zip_path.exists()
    assert not any(raw_dir.rglob("*.csv"))


def test_convert_replaces_existing_partition(tmp_path):
    parquet_dir = tmp_path / "parquet"
    stale = parquet_dir / "contracts" / "fy=2017" / "stale.parquet"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"junk")
    zip_path = make_zip(tmp_path, "a.zip", CONTRACT_HEADER, CONTRACT_ROWS, members=1)
    convert_zip_to_parquet(
        zip_path, dataset="contracts", fiscal_year=2017,
        parquet_dir=parquet_dir, raw_dir=tmp_path / "raw",
        required_columns=set(),
    )
    assert not stale.exists()


def test_convert_rejects_missing_required_columns(tmp_path):
    zip_path = make_zip(tmp_path, "bad.zip", "colA,colB", ["1,2"], members=1)
    with pytest.raises(MissingColumnsError):
        convert_zip_to_parquet(
            zip_path, dataset="contracts", fiscal_year=2017,
            parquet_dir=tmp_path / "parquet", raw_dir=tmp_path / "raw",
            required_columns={"contract_transaction_unique_key"},
        )


def test_convert_partial_failure_leaves_live_partition_intact(tmp_path):
    parquet_dir = tmp_path / "parquet"
    live = parquet_dir / "contracts" / "fy=2017"
    live.mkdir(parents=True)
    (live / "existing.parquet").write_bytes(b"old")
    zip_path = tmp_path / "mixed.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("part_0.csv", CONTRACT_HEADER + "\n" + CONTRACT_ROWS[0] + "\n")
        zf.writestr("part_1.csv", "colA,colB\n1,2\n")
    with pytest.raises(MissingColumnsError):
        convert_zip_to_parquet(
            zip_path, dataset="contracts", fiscal_year=2017,
            parquet_dir=parquet_dir, raw_dir=tmp_path / "raw",
            required_columns={"contract_transaction_unique_key"},
        )
    assert (live / "existing.parquet").exists()
    assert not (parquet_dir / "contracts" / "fy=2017.incoming").exists()
    assert zip_path.exists()
