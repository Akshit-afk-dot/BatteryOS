import pytest

from app.services import csv_ingest as ci
from conftest import CLEAN_CSV, ISSUES_CSV, NO_TIME_CSV, sample

BATTERY = {"nominal_voltage_v": 51.2, "rated_capacity_ah": 30, "chemistry": "LFP", "pack_configuration": "16S1P"}


def codes(a):
    return {i["code"] for i in a.issues}


def test_clean_file_is_mapped_from_headers():
    a = ci.analyze(sample(CLEAN_CSV), battery=BATTERY)
    m = {x["field"]: x for x in a.mapping}
    assert m["time_elapsed"]["column"] == "Test Time(s)" and m["time_elapsed"]["unit"] == "s"
    assert m["voltage"]["unit"] == "V" and m["voltage"]["unit_source"] == "header"
    assert m["current"]["unit"] == "A" and m["temperature"]["unit"] == "°C"
    assert m["step"]["column"] == "Step"
    assert a.can_import
    # Only the sign convention needs confirming in an otherwise clean file.
    assert codes(a) == {"CURRENT_SIGN_UNCONFIRMED"}
    a2 = ci.analyze(sample(CLEAN_CSV), {"current_sign": "discharge_negative"}, battery=BATTERY)
    assert a2.warnings == []


def test_clean_file_summary_is_deterministic_and_documented():
    a = ci.analyze(sample(CLEAN_CSV), {"current_sign": "discharge_negative"}, battery=BATTERY)
    s = {m["key"]: m for m in ci.summarize(a)["metrics"]}
    assert s["voltage_max_v"]["value"] == pytest.approx(56.88)
    assert s["current_max_discharge_a"]["value"] == pytest.approx(15.0)
    # 15 A for the recorded discharge duration; equals the file's own capacity counter.
    assert s["ah_discharged"]["value"] == pytest.approx(s["capacity_counter_max_ah"]["value"], abs=0.06)
    assert "not a rated-capacity measurement" in s["ah_discharged"]["method"]
    assert all(m["method"] for m in s.values())


def test_messy_bms_export_flags_every_problem():
    a = ci.analyze(sample(ISSUES_CSV), battery=BATTERY)
    assert a.table.delimiter == ";" and a.table.decimal == "," and a.table.header_row == 4
    found = codes(a)
    for expected in (
        "PREAMBLE_SKIPPED",
        "AMBIGUOUS_DATE_ORDER",
        "TIME_NOT_MONOTONIC",
        "TIME_GAPS",
        "UNIT_ASSUMED",
        "NON_NUMERIC_VALUES",
        "HIGH_TEMPERATURE_READINGS",
        "MISSING_VALUES",
        "CURRENT_SIGN_UNCONFIRMED",
    ):
        assert expected in found, expected
    assert a.can_import  # warnings, not errors
    m = {x["column"]: x for x in a.mapping}
    assert m["Total Voltage (mV)"]["unit"] == "mV"
    assert sum(1 for x in a.mapping if x["field"] == "cell_voltage") == 16
    # mV converted to V
    assert 40 < a.series["voltage_v"][0] < 60
    assert 3.0 < a.series["cell_voltage_1_v"][0] < 3.5


def test_issue_rows_point_to_original_line_numbers():
    a = ci.analyze(sample(ISSUES_CSV), battery=BATTERY)
    non_numeric = next(i for i in a.issues if i["code"] == "NON_NUMERIC_VALUES")
    lines = sample(ISSUES_CSV).decode().splitlines()
    assert "ERR" in lines[non_numeric["rows"][0] - 1]


def test_confirming_units_and_dates_clears_those_warnings():
    a = ci.analyze(sample(ISSUES_CSV), battery=BATTERY)
    mapping = [{**m, "unit_source": "user"} for m in a.mapping]
    b = ci.analyze(sample(ISSUES_CSV), {"dayfirst": True, "current_sign": "discharge_negative"}, mapping, BATTERY)
    assert not {"UNIT_ASSUMED", "AMBIGUOUS_DATE_ORDER", "CURRENT_SIGN_UNCONFIRMED"} & codes(b)


def test_summary_without_time_column_is_an_error():
    a = ci.analyze(sample(NO_TIME_CSV))
    assert not a.can_import
    assert "MISSING_TIME_COLUMN" in {e["code"] for e in a.errors}


def test_binary_and_empty_files_rejected():
    with pytest.raises(ci.CsvError):
        ci.analyze(b"\x89PNG\r\n\x1a\n\x00\x00\x00binary")
    with pytest.raises(ci.CsvError):
        ci.analyze(b"   \n\n")


def test_header_only_file():
    a = ci.analyze(b"time,voltage\n")
    assert "NO_DATA_ROWS" in codes(a) and not a.can_import


def test_hms_durations_and_millivolt_assumption():
    data = b"Elapsed,Volt\n00:00:00,52100\n00:00:10,52080\n00:00:20,52060\n00:01:00,52000\n"
    a = ci.analyze(data, battery=BATTERY)
    m = {x["field"]: x for x in a.mapping}
    assert m["time_elapsed"]["unit"] == "hh:mm:ss"
    assert m["voltage"]["unit"] == "mV" and m["voltage"]["unit_source"] == "assumed"
    assert list(a.t_s) == [0, 10, 20, 60]
    assert a.series["voltage_v"][0] == pytest.approx(52.1)
    assert "UNIT_ASSUMED" in codes(a)


def test_out_of_range_and_wrong_battery_detected():
    data = b"t(s),Voltage(V),SOC(%)\n0,12.1,50\n1,12.0,150\n2,11.9,49\n"
    a = ci.analyze(data, battery=BATTERY)
    assert "OUT_OF_RANGE" in codes(a)
    assert "VOLTAGE_INCONSISTENT_WITH_RECORD" in codes(a)


def test_discharge_positive_convention_is_flipped():
    data = b"t(s),Current(A)\n0,10\n10,10\n20,10\n"
    a = ci.analyze(data, {"current_sign": "discharge_positive"})
    assert list(a.series["current_a"]) == [-10, -10, -10]
    s = {m["key"]: m["value"] for m in ci.summarize(a)["metrics"]}
    assert s["ah_discharged"] == pytest.approx(20 * 10 / 3600, rel=1e-3)


def test_epoch_timestamps_and_iso_dates():
    a = ci.analyze(b"timestamp,voltage (V)\n1767225600,50\n1767225660,49.9\n")
    assert {x["field"]: x["unit"] for x in a.mapping}["timestamp"] == "epoch_s"
    assert list(a.t_s) == [0, 60]
    b = ci.analyze(b"Date Time,voltage (V)\n2026-01-05 10:00:00,50\n2026-01-05 10:00:30,49.9\n")
    assert list(b.t_s) == [0, 30]
    assert "AMBIGUOUS_DATE_ORDER" not in codes(b)


def test_malformed_rows_skipped_and_reported():
    a = ci.analyze(b"t(s),Voltage(V)\n0,50\n1,49,EXTRA,CELLS\n2,48\n")
    issue = next(i for i in a.issues if i["code"] == "MALFORMED_ROWS")
    assert issue["rows"] == [3]
    assert a.stats["rows"] == 2


def test_invalid_mapping_reported_as_errors():
    data = sample(CLEAN_CSV)
    bad = [
        {"column": "Test Time(s)", "field": "time_elapsed", "unit": "s"},
        {"column": "Voltage(V)", "field": "voltage", "unit": "furlongs"},
        {"column": "Nope", "field": "current", "unit": "A"},
    ]
    a = ci.analyze(data, mapping=bad)
    assert {"INVALID_UNIT", "COLUMN_NOT_FOUND"} <= {e["code"] for e in a.errors}


def test_cell_count_mismatch_and_chemistry_window():
    data = b"t(s),Cell1(V),Cell2(V)\n0,4.10,4.12\n1,4.11,4.13\n"
    a = ci.analyze(data, battery=BATTERY)
    assert {"CELL_COUNT_MISMATCH", "CELL_VOLTAGE_OUTSIDE_CHEMISTRY_WINDOW"} <= codes(a)


def test_unlabelled_time_unit_is_flagged():
    a = ci.analyze(b"Elapsed,Voltage(V)\n0,50\n10,49.9\n20,49.8\n")
    flagged = [i for i in a.issues if i["code"] == "UNIT_ASSUMED"]
    assert flagged and flagged[0]["field"] == "time_elapsed"
    confirmed = [{**m, "unit_source": "user"} for m in a.mapping]
    assert "UNIT_ASSUMED" not in codes(ci.analyze(b"Elapsed,Voltage(V)\n0,50\n10,49.9\n", mapping=confirmed))
