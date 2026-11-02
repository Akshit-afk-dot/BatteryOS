"""CSV parsing, column mapping, validation and normalization.

Everything here is deterministic. The same bytes, parser options and column
mapping always produce the same validation report and normalized values; the
import endpoint re-runs the full analysis server-side rather than trusting
anything the browser sends back.

Canonical units after normalization:
  time s (elapsed from first valid sample) · voltage V · current A (charge
  positive, discharge negative) · temperature °C · state of charge % ·
  capacity Ah · energy Wh · power W
"""

from __future__ import annotations

import csv
import io
import math
import re
import warnings
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- field catalogue

FIELDS: dict[str, dict[str, Any]] = {
    "time_elapsed": {
        "label": "Elapsed time",
        "units": ["s", "ms", "min", "h", "hh:mm:ss"],
        "multi": False,
        "group": "time",
    },
    "timestamp": {
        "label": "Timestamp (date & time)",
        "units": ["datetime", "epoch_s", "epoch_ms"],
        "multi": False,
        "group": "time",
    },
    "voltage": {"label": "Pack voltage", "units": ["V", "mV"], "multi": False, "range": (0.0, 1500.0)},
    "current": {"label": "Current", "units": ["A", "mA"], "multi": False, "range": (-3000.0, 3000.0)},
    "temperature": {"label": "Temperature", "units": ["°C", "°F", "K"], "multi": True, "range": (-40.0, 120.0)},
    "soc": {"label": "State of charge", "units": ["%", "fraction"], "multi": False, "range": (0.0, 100.0)},
    "cell_voltage": {"label": "Cell voltage", "units": ["V", "mV"], "multi": True, "range": (0.0, 5.0)},
    "capacity": {"label": "Capacity counter (equipment)", "units": ["Ah", "mAh"], "multi": False},
    "energy": {"label": "Energy counter (equipment)", "units": ["Wh", "kWh", "mWh"], "multi": False},
    "power": {"label": "Power", "units": ["W", "kW"], "multi": False},
    "cycle": {"label": "Cycle index", "units": ["count"], "multi": False},
    "step": {"label": "Step / mode label", "units": ["text"], "multi": False},
}

UNIT_FACTORS: dict[str, float] = {
    "s": 1.0, "ms": 1e-3, "min": 60.0, "h": 3600.0,
    "V": 1.0, "mV": 1e-3,
    "A": 1.0, "mA": 1e-3,
    "%": 1.0, "fraction": 100.0,
    "Ah": 1.0, "mAh": 1e-3,
    "Wh": 1.0, "kWh": 1e3, "mWh": 1e-3,
    "W": 1.0, "kW": 1e3,
    "count": 1.0,
}

MISSING_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "--", "?", "#n/a", "#value!"}
DELIMITERS = [",", ";", "\t", "|"]
MAX_PREVIEW_ROWS = 20

DEFAULT_OPTIONS: dict[str, Any] = {
    "encoding": None,
    "delimiter": None,
    "header_row": None,
    "decimal": None,
    "dayfirst": None,
    "current_sign": None,
}


class CsvError(Exception):
    """The file cannot be read as a CSV table at all."""


@dataclass
class Table:
    encoding: str
    delimiter: str
    header_row: int
    decimal: str
    columns: list[str]
    rows: list[list[str]]
    source_line: list[int]  # 1-based line number in the original file for each row
    preamble: list[str]
    malformed_rows: list[int]
    duplicate_columns: list[str]
    auto: dict[str, bool]


@dataclass
class Analysis:
    table: Table
    options: dict[str, Any]
    mapping: list[dict[str, Any]]
    columns: list[dict[str, Any]]
    issues: list[dict[str, Any]] = field(default_factory=list)
    t_s: np.ndarray | None = None
    series: dict[str, np.ndarray] = field(default_factory=dict)
    text_series: dict[str, list[str | None]] = field(default_factory=dict)
    valid: np.ndarray | None = None
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def errors(self) -> list[dict[str, Any]]:
        return [i for i in self.issues if i["severity"] == "error"]

    @property
    def warnings(self) -> list[dict[str, Any]]:
        return [i for i in self.issues if i["severity"] == "warning"]

    @property
    def can_import(self) -> bool:
        return not self.errors


def issue(code: str, severity: str, message: str, **extra: Any) -> dict[str, Any]:
    out = {"code": code, "severity": severity, "message": message}
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


# --------------------------------------------------------------------------- reading


def decode(data: bytes, encoding: str | None = None) -> tuple[str, str]:
    if encoding:
        try:
            # utf-8-sig also strips a byte-order mark if one is present.
            return data.decode("utf-8-sig" if encoding == "utf-8" else encoding), encoding
        except (UnicodeDecodeError, LookupError) as e:
            raise CsvError(f"The file could not be decoded as {encoding}.") from e
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16"), "utf-16"
    if b"\x00" in data[:4096]:
        raise CsvError("This looks like a binary file, not a CSV text file.")
    try:
        return data.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace"), "cp1252"


def _split(line: str, delimiter: str) -> list[str]:
    return next(csv.reader([line], delimiter=delimiter), [])


def _detect_delimiter(lines: list[str]) -> str:
    sample = [ln for ln in lines[:80] if ln.strip()]
    best, best_score = ",", -1.0
    for d in DELIMITERS:
        counts = [len(_split(ln, d)) for ln in sample]
        if not counts:
            continue
        mode, freq = Counter(counts).most_common(1)[0]
        if mode < 2:
            continue
        score = (freq / len(counts)) * math.log(mode + 1)
        if score > best_score + 1e-9:
            best, best_score = d, score
    return best


_NUMERIC_RE = re.compile(r"^\s*[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?\s*$")


def _looks_numeric(cell: str) -> bool:
    return bool(_NUMERIC_RE.match(cell)) or bool(re.match(r"^\s*\d{1,4}[-/:.]\d{1,2}", cell))


def _detect_header_row(lines: list[str], delimiter: str) -> int:
    """First row that has the table's column count and mostly non-numeric cells.
    Handles exports that put metadata lines above the real header."""
    sample = lines[:200]
    split = [_split(ln, delimiter) for ln in sample]
    counts = [len(r) for r in split if any(c.strip() for c in r)]
    if not counts:
        return 0
    width = Counter(counts[len(counts) // 3 :] or counts).most_common(1)[0][0]
    for i, row in enumerate(split):
        if len(row) != width:
            continue
        cells = [c for c in row if c.strip()]
        if not cells:
            continue
        textual = sum(1 for c in cells if not _looks_numeric(c))
        if textual / len(cells) >= 0.5:
            return i
    return 0


def _detect_decimal(rows: list[list[str]], delimiter: str) -> str:
    if delimiter == ",":
        return "."
    comma = dot = 0
    for row in rows[:200]:
        for c in row:
            c = c.strip()
            if re.match(r"^[-+]?\d+,\d+$", c):
                comma += 1
            elif re.match(r"^[-+]?\d+\.\d+$", c):
                dot += 1
    return "," if comma > dot else "."


def read_table(data: bytes, options: dict[str, Any], max_rows: int) -> Table:
    if not data.strip():
        raise CsvError("The file is empty.")
    text, encoding = decode(data, options.get("encoding"))
    lines = text.splitlines()
    if not any(ln.strip() for ln in lines):
        raise CsvError("The file is empty.")

    auto = {}
    delimiter = options.get("delimiter")
    auto["delimiter"] = delimiter is None
    if delimiter is None:
        delimiter = _detect_delimiter(lines)
    if delimiter not in DELIMITERS:
        raise CsvError("Unsupported delimiter.")

    header_row = options.get("header_row")
    auto["header_row"] = header_row is None
    if header_row is None:
        header_row = _detect_header_row(lines, delimiter)
    if header_row < 0 or header_row >= len(lines):
        raise CsvError("The header row is outside the file.")

    reader = csv.reader(io.StringIO("\n".join(lines[header_row:])), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration as e:
        raise CsvError("No header row found.") from e

    columns: list[str] = []
    seen: Counter[str] = Counter()
    duplicates: list[str] = []
    for i, name in enumerate(header):
        name = name.strip() or f"Column {i + 1}"
        seen[name] += 1
        if seen[name] > 1:
            duplicates.append(name)
            name = f"{name} ({seen[name]})"
        columns.append(name)

    rows: list[list[str]] = []
    source_line: list[int] = []
    malformed: list[int] = []
    width = len(columns)
    try:
        for offset, row in enumerate(reader, start=1):
            line_no = header_row + offset + 1
            if not row or not any(c.strip() for c in row):
                continue
            if len(row) != width:
                # Tolerate a trailing empty cell (common "a,b,c," exports).
                if len(row) == width + 1 and not row[-1].strip():
                    row = row[:-1]
                else:
                    malformed.append(line_no)
                    continue
            rows.append(row)
            source_line.append(line_no)
            if len(rows) > max_rows:
                raise CsvError(f"The file has more than {max_rows:,} data rows, which is above the import limit.")
    except csv.Error as e:
        raise CsvError(f"The file could not be parsed as CSV: {e}") from e

    decimal = options.get("decimal")
    auto["decimal"] = decimal is None
    if decimal is None:
        decimal = _detect_decimal(rows, delimiter)

    return Table(
        encoding=encoding,
        delimiter=delimiter,
        header_row=header_row,
        decimal=decimal,
        columns=columns,
        rows=rows,
        source_line=source_line,
        preamble=[ln for ln in lines[:header_row] if ln.strip()][:20],
        malformed_rows=malformed,
        duplicate_columns=duplicates,
        auto=auto,
    )


# --------------------------------------------------------------------------- column profiling


def _clean_numeric(values: pd.Series, decimal: str) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (numbers, missing_mask, invalid_mask)."""
    s = values.astype(str).str.strip()
    missing = s.str.lower().isin(MISSING_TOKENS)
    cleaned = s
    if decimal == ",":
        cleaned = cleaned.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    # Accept a trailing unit on the value itself, e.g. "3.65V" or "25 °C".
    cleaned = cleaned.str.replace(r"^([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*[A-Za-z°%Ω℃]{0,4}$", r"\1", regex=True)
    nums = pd.to_numeric(cleaned.where(~missing), errors="coerce")
    invalid = nums.isna() & ~missing
    return nums.astype(float), missing, invalid


_HMS_RE = re.compile(r"^\s*(?:(\d+)[.d]\s*)?(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?\s*$")


def _parse_hms(values: pd.Series) -> pd.Series:
    def one(v: str) -> float:
        m = _HMS_RE.match(v)
        if not m:
            return math.nan
        days, a, b, c = m.groups()
        if c is None:  # mm:ss
            secs = int(a) * 60 + float(b)
        else:
            secs = int(a) * 3600 + int(b) * 60 + float(c)
        return secs + (int(days) * 86400 if days else 0)

    return values.astype(str).map(one).astype(float)


_DATE_PREFIX = re.compile(r"^\s*(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})")


def _date_order(values: pd.Series) -> str:
    """'dayfirst', 'monthfirst', 'iso', or 'ambiguous' for slash/dash dates."""
    first_gt12 = second_gt12 = False
    iso = True
    seen = 0
    for v in values.head(5000):
        m = _DATE_PREFIX.match(str(v))
        if not m:
            continue
        seen += 1
        a, b, _ = m.groups()
        if len(a) != 4:
            iso = False
        if int(a) > 12:
            first_gt12 = True
        if int(b) > 12:
            second_gt12 = True
    if seen == 0:
        return "iso"
    if iso:
        return "iso"
    if first_gt12 and not second_gt12:
        return "dayfirst"
    if second_gt12 and not first_gt12:
        return "monthfirst"
    if not first_gt12 and not second_gt12:
        return "ambiguous"
    return "dayfirst"


def _parse_datetimes(values: pd.Series, dayfirst: bool) -> pd.Series:
    s = values.astype(str).str.strip()
    s = s.where(~s.str.lower().isin(MISSING_TOKENS))
    with warnings.catch_warnings():
        # pandas warns when it has to guess a format; we report ambiguity ourselves.
        warnings.simplefilter("ignore")
        parsed = pd.to_datetime(s, errors="coerce", dayfirst=dayfirst)
        if parsed.notna().mean() < 0.9:
            parsed = pd.to_datetime(s, errors="coerce", dayfirst=dayfirst, format="mixed")
    if getattr(parsed.dt, "tz", None) is not None:
        parsed = parsed.dt.tz_convert("UTC").dt.tz_localize(None)
    return parsed


UNIT_PATTERNS: list[tuple[str, str]] = [
    (r"(?<![a-z])mv(?![a-z])", "mV"),
    (r"(?<![a-z])ma(?![a-z])", "mA"),
    (r"(?<![a-z])mah(?![a-z])", "mAh"),
    (r"(?<![a-z])kwh(?![a-z])", "kWh"),
    (r"(?<![a-z])mwh(?![a-z])", "mWh"),
    (r"(?<![a-z])wh(?![a-z])", "Wh"),
    (r"(?<![a-z])ah(?![a-z])", "Ah"),
    (r"(?<![a-z])kw(?![a-z])", "kW"),
    (r"°\s*c|℃|degc|deg c|\(c\)|\[c\]|_c$|celsius", "°C"),
    (r"°\s*f|degf|deg f|\(f\)|\[f\]|fahrenheit", "°F"),
    (r"\(k\)|\[k\]|kelvin", "K"),
    (r"%|percent|pct", "%"),
    (r"\(ms\)|\[ms\]|_ms$|millisec", "ms"),
    (r"\(min\)|\[min\]|_min$|minutes", "min"),
    (r"\(h\)|\[h\]|\(hr?s?\)|_h$|hours", "h"),
    (r"\(s\)|\[s\]|_s$|\(sec\)|seconds|\bsec\b", "s"),
    # Only explicit unit markers count; a column merely named "Volt" or "Amps"
    # says what it measures, not the scale of its values.
    (r"\(v\)|\[v\]|_v$|\(volts?\)|\[volts?\]|\bin volts\b", "V"),
    (r"\(a\)|\[a\]|_a$|\(amps?\)|\[amps?\]|\bin amps\b", "A"),
    (r"\(w\)|\[w\]|_w$|\(watts?\)|\[watts?\]", "W"),
]


def detect_header_unit(name: str) -> str | None:
    low = name.lower().strip()
    for pattern, unit in UNIT_PATTERNS:
        if re.search(pattern, low):
            return unit
    return None


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9%°]+", " ", name.lower()).strip()


def suggest_field(name: str) -> str | None:
    n = _norm(name)
    raw = name.lower()
    if re.search(r"\bsoc\b|state of charge|charge level", n):
        return "soc"
    if re.search(r"\bcell\s*\d+|\bc\s?\d+\s*v\b|\bv\s?cell|\bcell\s*v|^v\s?\d+$|\bcv\s?\d+|\bu\s?\d+\b", n):
        return "cell_voltage"
    if re.search(r"timestamp|date|datetime|clock|real time|record time|absolute time", n):
        return "timestamp"
    if re.search(r"\btime\b|elapsed|duration|^t$|^t s$|\bseconds\b|\bsec\b|\bruntime\b", n):
        return "time_elapsed"
    if re.search(r"\bcycle", n):
        return "cycle"
    if re.search(r"\b(step|mode|phase|status)\b|\bstate\b", n):
        return "step"
    if re.search(r"temp|ntc|therm|\bt\s?\d+\b|°c|degc|℃", n + " " + raw):
        return "temperature"
    if re.search(r"capacity|\bcap\b|\bah\b|\bmah\b", n):
        return "capacity"
    if re.search(r"energy|\bwh\b|\bkwh\b", n):
        return "energy"
    if re.search(r"power|\bwatt|\bkw\b|^p$|^p w$", n):
        return "power"
    if re.search(r"curr|\bamp|^i$|^i a$|\bibat|\bi bat|\bi pack", n):
        return "current"
    if re.search(r"volt|^v$|^v v$|\bvbat|\bpack v|\bv pack|^u$|\bubat|\bu bat|\bvoltage", n):
        return "voltage"
    return None


def profile_columns(table: Table) -> list[dict[str, Any]]:
    out = []
    df = pd.DataFrame(table.rows, columns=table.columns) if table.rows else pd.DataFrame(columns=table.columns)
    for idx, name in enumerate(table.columns):
        col = df[name] if name in df else pd.Series([], dtype=str)
        nums, missing, invalid = _clean_numeric(col, table.decimal)
        non_missing = int((~missing).sum())
        numeric_rate = float((nums.notna().sum() / non_missing) if non_missing else 0.0)
        inferred = "empty"
        if non_missing:
            if numeric_rate >= 0.9:
                inferred = "numeric"
            elif _parse_hms(col[~missing].head(200)).notna().mean() >= 0.9:
                inferred = "duration"
            elif _parse_datetimes(col[~missing].head(200), True).notna().mean() >= 0.9:
                inferred = "datetime"
            else:
                inferred = "text"
        sample = [v for v in col.head(5).tolist()]
        out.append(
            {
                "index": idx,
                "name": name,
                "inferred_type": inferred,
                "non_empty": non_missing,
                "numeric_rate": round(numeric_rate, 3),
                "sample": sample,
                "header_unit": detect_header_unit(name),
                "suggested_field": suggest_field(name),
                "min": float(nums.min()) if nums.notna().any() else None,
                "max": float(nums.max()) if nums.notna().any() else None,
            }
        )
    return out


# --------------------------------------------------------------------------- mapping


def _assume_unit(fld: str, col: dict[str, Any], battery: dict[str, Any] | None) -> str:
    lo, hi = col.get("min"), col.get("max")
    mag = max(abs(lo or 0), abs(hi or 0))
    if fld == "time_elapsed":
        return "hh:mm:ss" if col["inferred_type"] == "duration" else "s"
    if fld == "timestamp":
        if col["inferred_type"] == "numeric":
            return "epoch_ms" if mag > 1e11 else "epoch_s"
        return "datetime"
    if fld == "voltage":
        return "mV" if mag > 1500 else "V"
    if fld == "cell_voltage":
        return "mV" if mag > 10 else "V"
    if fld == "current":
        rated = (battery or {}).get("rated_capacity_ah")
        if rated and mag > 50 * rated:
            return "mA"
        return "mA" if mag > 3000 else "A"
    if fld == "temperature":
        return "K" if lo is not None and lo > 200 else "°C"
    if fld == "soc":
        return "fraction" if hi is not None and hi <= 1.0 else "%"
    if fld == "capacity":
        return "mAh" if mag > 5000 else "Ah"
    if fld == "energy":
        return "Wh"
    if fld == "power":
        return "W"
    return FIELDS[fld]["units"][0]


def suggest_mapping(columns: list[dict[str, Any]], battery: dict[str, Any] | None) -> list[dict[str, Any]]:
    mapping: list[dict[str, Any]] = []
    taken: set[str] = set()

    def time_rank(c: dict[str, Any]) -> int:
        n = c["name"].lower()
        return 0 if any(k in n for k in ("test", "total", "elapsed", "run")) else (2 if "step" in n else 1)

    ordered = sorted(columns, key=lambda c: (c["suggested_field"] != "time_elapsed", time_rank(c), c["index"]))
    for col in ordered:
        fld = col["suggested_field"]
        if fld is None or col["inferred_type"] == "empty":
            continue
        if fld in ("time_elapsed", "timestamp"):
            # Decide from the values: a "Time" column may hold dates, durations or seconds.
            if col["inferred_type"] == "datetime":
                fld = "timestamp"
            elif col["inferred_type"] == "duration":
                fld = "time_elapsed"
            elif col["inferred_type"] == "numeric":
                fld = "timestamp" if (col["max"] or 0) > 1e8 else "time_elapsed"
            else:
                continue
            if "time_elapsed" in taken or "timestamp" in taken:
                continue
        if not FIELDS[fld]["multi"] and fld in taken:
            continue
        if fld not in ("step",) and fld not in ("timestamp",) and col["inferred_type"] not in ("numeric", "duration"):
            continue
        header_unit = col["header_unit"]
        if header_unit and header_unit in FIELDS[fld]["units"]:
            unit, source = header_unit, "header"
        elif fld == "step":
            unit, source = "text", "header"
        elif fld == "cycle":
            unit, source = "count", "header"
        elif fld == "timestamp" and col["inferred_type"] == "datetime":
            unit, source = "datetime", "header"
        elif fld == "time_elapsed" and col["inferred_type"] == "duration":
            unit, source = "hh:mm:ss", "header"
        else:
            unit, source = _assume_unit(fld, col, battery), "assumed"
        mapping.append({"column": col["name"], "field": fld, "unit": unit, "unit_source": source})
        taken.add(fld)
    mapping.sort(key=lambda m: next(c["index"] for c in columns if c["name"] == m["column"]))
    return mapping


def check_mapping(mapping: list[dict[str, Any]], columns: list[str]) -> list[dict[str, Any]]:
    issues = []
    counts: Counter[str] = Counter()
    seen_cols: set[str] = set()
    for m in mapping:
        fld, col, unit = m.get("field"), m.get("column"), m.get("unit")
        if fld not in FIELDS:
            issues.append(issue("UNKNOWN_FIELD", "error", f"Unknown target field '{fld}'.", column=col))
            continue
        if col not in columns:
            issues.append(issue("COLUMN_NOT_FOUND", "error", f"Mapped column '{col}' is not in the file.", column=col))
            continue
        if col in seen_cols:
            issues.append(issue("COLUMN_MAPPED_TWICE", "error", f"Column '{col}' is mapped more than once.", column=col))
        seen_cols.add(col)
        if unit not in FIELDS[fld]["units"]:
            issues.append(
                issue(
                    "INVALID_UNIT",
                    "error",
                    f"'{unit}' is not a valid unit for {FIELDS[fld]['label']} "
                    f"(allowed: {', '.join(FIELDS[fld]['units'])}).",
                    column=col,
                    field=fld,
                )
            )
        counts[fld] += 1
    for fld, n in counts.items():
        if n > 1 and not FIELDS[fld]["multi"]:
            issues.append(issue("FIELD_MAPPED_TWICE", "error", f"{FIELDS[fld]['label']} is mapped to {n} columns; choose one."))
    if counts["time_elapsed"] + counts["timestamp"] == 0:
        issues.append(
            issue(
                "MISSING_TIME_COLUMN",
                "error",
                "Map a time column (elapsed time or timestamp). Time-series files cannot be imported without one.",
            )
        )
    elif counts["time_elapsed"] and counts["timestamp"]:
        issues.append(issue("TWO_TIME_COLUMNS", "error", "Map either elapsed time or a timestamp, not both."))
    measured = {"voltage", "current", "temperature", "soc", "cell_voltage", "capacity", "energy", "power"}
    if not any(counts[f] for f in measured):
        issues.append(
            issue(
                "NO_MEASUREMENT_COLUMNS",
                "error",
                "Map at least one measurement column (voltage, current, temperature, SOC, cell voltage, capacity, energy or power).",
            )
        )
    return issues


# --------------------------------------------------------------------------- analysis


def _rows_of(mask: np.ndarray, lines: np.ndarray, limit: int = 5) -> list[int]:
    return [int(x) for x in lines[mask][:limit]]


def _series_count(pack_config: str | None) -> int | None:
    if not pack_config:
        return None
    m = re.search(r"(\d+)\s*s", pack_config.lower())
    return int(m.group(1)) if m else None


CHEMISTRY_CELL_WINDOW = {
    "LFP": (2.0, 3.8),
    "NMC": (2.5, 4.35),
    "NCA": (2.5, 4.35),
    "LCO": (2.75, 4.35),
    "LMO": (2.5, 4.35),
    "LTO": (1.5, 2.9),
}


def analyze(
    data: bytes,
    options: dict[str, Any] | None = None,
    mapping: list[dict[str, Any]] | None = None,
    battery: dict[str, Any] | None = None,
    max_rows: int = 500_000,
) -> Analysis:
    opts = {**DEFAULT_OPTIONS, **(options or {})}
    table = read_table(data, opts, max_rows)
    columns = profile_columns(table)
    mapping_was_suggested = mapping is None
    if mapping is None:
        mapping = suggest_mapping(columns, battery)
    a = Analysis(table=table, options=opts, mapping=mapping, columns=columns)
    a.options.update(
        {"encoding": table.encoding, "delimiter": table.delimiter, "header_row": table.header_row, "decimal": table.decimal}
    )
    issues = a.issues

    n = len(table.rows)
    lines = np.array(table.source_line, dtype=int)
    if n == 0:
        issues.append(issue("NO_DATA_ROWS", "error", "The file has a header but no data rows."))
    if table.malformed_rows:
        issues.append(
            issue(
                "MALFORMED_ROWS",
                "warning",
                f"{len(table.malformed_rows)} row(s) have a different number of cells than the header and will be skipped.",
                count=len(table.malformed_rows),
                rows=table.malformed_rows[:5],
            )
        )
    if table.duplicate_columns:
        issues.append(
            issue(
                "DUPLICATE_COLUMN_NAMES",
                "info",
                "Some column names repeat; they were numbered to keep them apart: " + ", ".join(sorted(set(table.duplicate_columns))),
            )
        )
    if table.preamble:
        issues.append(
            issue(
                "PREAMBLE_SKIPPED",
                "info",
                f"{len(table.preamble)} line(s) above the header were treated as file metadata and not imported as data.",
                count=len(table.preamble),
            )
        )

    issues.extend(check_mapping(mapping, table.columns))
    if a.errors or n == 0:
        return a

    df = pd.DataFrame(table.rows, columns=table.columns)
    valid = np.ones(n, dtype=bool)

    # ---- time
    time_map = next(m for m in mapping if m["field"] in ("time_elapsed", "timestamp"))
    tcol = df[time_map["column"]]
    if time_map.get("unit_source") == "assumed" and time_map["unit"] not in ("datetime", "hh:mm:ss"):
        issues.append(
            issue(
                "UNIT_ASSUMED",
                "warning",
                f"The time column '{time_map['column']}' does not state a unit; the values were read as {time_map['unit']}. "
                "Confirm the unit (seconds, minutes, hours…).",
                column=time_map["column"],
                field=time_map["field"],
            )
        )
    if time_map["field"] == "time_elapsed":
        if time_map["unit"] == "hh:mm:ss":
            t = _parse_hms(tcol).to_numpy()
        else:
            nums, _, _ = _clean_numeric(tcol, table.decimal)
            t = nums.to_numpy() * UNIT_FACTORS[time_map["unit"]]
    else:
        if time_map["unit"] in ("epoch_s", "epoch_ms"):
            nums, _, _ = _clean_numeric(tcol, table.decimal)
            t = nums.to_numpy() * (1e-3 if time_map["unit"] == "epoch_ms" else 1.0)
            ts = pd.to_datetime(nums * (1e-3 if time_map["unit"] == "epoch_ms" else 1.0), unit="s", errors="coerce")
        else:
            order = _date_order(tcol)
            a.options["dayfirst_detected"] = order
            dayfirst = a.options.get("dayfirst")
            if dayfirst is None:
                if order == "ambiguous":
                    issues.append(
                        issue(
                            "AMBIGUOUS_DATE_ORDER",
                            "warning",
                            "Dates could be read as day/month or month/day (for example 03/04). "
                            "They were read as day/month; confirm the date order in the import options.",
                            column=time_map["column"],
                        )
                    )
                dayfirst = order != "monthfirst"
            ts = _parse_datetimes(tcol, False if order == "iso" else bool(dayfirst))
            t = (ts - ts.min()).dt.total_seconds().to_numpy() if ts.notna().any() else np.full(n, np.nan)
        if pd.notna(ts).any():
            a.first_timestamp = pd.Timestamp(ts.min()).isoformat()
            a.last_timestamp = pd.Timestamp(ts.max()).isoformat()
    t = t.astype(float)
    bad_t = ~np.isfinite(t)
    if bad_t.all():
        issues.append(
            issue(
                "TIME_UNPARSEABLE",
                "error",
                f"None of the values in '{time_map['column']}' could be read as {time_map['unit']}.",
                column=time_map["column"],
            )
        )
        return a
    if bad_t.any():
        issues.append(
            issue(
                "TIME_INVALID_ROWS",
                "warning",
                f"{int(bad_t.sum())} row(s) have a missing or unreadable time value and will be excluded.",
                column=time_map["column"],
                count=int(bad_t.sum()),
                rows=_rows_of(bad_t, lines),
            )
        )
    valid &= ~bad_t
    t = t - np.nanmin(t[valid])

    tv = t[valid]
    dt = np.diff(tv)
    if dt.size:
        back = dt < 0
        dup = dt == 0
        if back.any():
            issues.append(
                issue(
                    "TIME_NOT_MONOTONIC",
                    "warning",
                    f"Time goes backwards {int(back.sum())} time(s). The file may combine several tests or have clock resets.",
                    column=time_map["column"],
                    count=int(back.sum()),
                    rows=_rows_of(np.concatenate([[False], back]), lines[valid]),
                )
            )
        if dup.any():
            issues.append(
                issue(
                    "DUPLICATE_TIMESTAMPS",
                    "warning",
                    f"{int(dup.sum())} sample(s) repeat the previous time value.",
                    column=time_map["column"],
                    count=int(dup.sum()),
                    rows=_rows_of(np.concatenate([[False], dup]), lines[valid]),
                )
            )
        pos = dt[dt > 0]
        if pos.size:
            median = float(np.median(pos))
            a.stats["median_interval_s"] = median
            gap_mask = dt > max(5 * median, 1.0)
            if gap_mask.any():
                biggest = float(dt[gap_mask].max())
                issues.append(
                    issue(
                        "TIME_GAPS",
                        "warning",
                        f"{int(gap_mask.sum())} gap(s) longer than 5× the typical sampling interval "
                        f"({_fmt_duration(median)}); the longest is {_fmt_duration(biggest)}.",
                        column=time_map["column"],
                        count=int(gap_mask.sum()),
                        rows=_rows_of(np.concatenate([[False], gap_mask]), lines[valid]),
                        detail={"median_interval_s": median, "longest_gap_s": biggest},
                    )
                )
            elif pos.size > 10 and float(np.std(pos)) > 0.5 * median:
                issues.append(
                    issue("IRREGULAR_SAMPLING", "info", f"Sampling interval varies (typical {_fmt_duration(median)}).")
                )
    a.t_s = t

    # ---- measurement columns
    counters: Counter[str] = Counter()
    for m in mapping:
        fld = m["field"]
        if fld in ("time_elapsed", "timestamp"):
            continue
        col = m["column"]
        if fld == "step":
            vals = df[col].astype(str).str.strip()
            a.text_series["step"] = [None if v.lower() in MISSING_TOKENS else v[:60] for v in vals]
            continue
        nums, missing, invalid = _clean_numeric(df[col], table.decimal)
        arr = nums.to_numpy(dtype=float)
        unit = m["unit"]
        if fld == "temperature":
            if unit == "°F":
                arr = (arr - 32.0) * 5.0 / 9.0
            elif unit == "K":
                arr = arr - 273.15
        else:
            arr = arr * UNIT_FACTORS[unit]

        counters[fld] += 1
        key = _series_key(fld, counters[fld])
        a.series[key] = arr

        label = f"'{col}' ({FIELDS[fld]['label']})"
        if m.get("unit_source") == "assumed":
            issues.append(
                issue(
                    "UNIT_ASSUMED",
                    "warning",
                    f"The column header {label} does not state a unit; the values were read as {unit}. Confirm the unit.",
                    column=col,
                    field=fld,
                )
            )
        if invalid.any():
            examples = df[col][invalid].head(3).tolist()
            issues.append(
                issue(
                    "NON_NUMERIC_VALUES",
                    "warning",
                    f"{int(invalid.sum())} value(s) in {label} are not numbers (e.g. {', '.join(repr(e) for e in examples)}) "
                    "and will be stored as missing.",
                    column=col,
                    field=fld,
                    count=int(invalid.sum()),
                    rows=_rows_of(invalid.to_numpy(), lines),
                )
            )
        miss = (missing.to_numpy() | invalid.to_numpy()) & valid
        if miss.any():
            pct = 100.0 * miss.sum() / max(valid.sum(), 1)
            issues.append(
                issue(
                    "MISSING_VALUES",
                    "warning" if pct >= 1.0 else "info",
                    f"{int(miss.sum())} row(s) ({pct:.1f}%) have no value in {label}.",
                    column=col,
                    field=fld,
                    count=int(miss.sum()),
                    rows=_rows_of(miss, lines),
                )
            )
        finite = np.isfinite(arr) & valid
        if not finite.any():
            issues.append(issue("COLUMN_EMPTY", "warning", f"{label} has no usable values.", column=col, field=fld))
            continue
        rng = FIELDS[fld].get("range")
        if rng:
            lo, hi = rng
            out = finite & ((arr < lo) | (arr > hi))
            if out.any():
                issues.append(
                    issue(
                        "OUT_OF_RANGE",
                        "warning",
                        f"{int(out.sum())} value(s) in {label} are outside the plausible range {lo:g}–{hi:g} "
                        f"{_canon_unit(fld)} after unit conversion. Check the unit or the sensor.",
                        column=col,
                        field=fld,
                        count=int(out.sum()),
                        rows=_rows_of(out, lines),
                    )
                )
        vals = arr[finite]
        if vals.size > 10 and float(np.nanstd(vals)) == 0.0:
            issues.append(
                issue(
                    "CONSTANT_VALUES",
                    "warning",
                    f"Every value in {label} is {vals[0]:g}. This can indicate a disconnected sensor or a placeholder.",
                    column=col,
                    field=fld,
                )
            )
        if fld == "temperature" and float(np.nanmax(vals)) > 60.0:
            hot = finite & (arr > 60.0)
            issues.append(
                issue(
                    "HIGH_TEMPERATURE_READINGS",
                    "warning",
                    f"{int(hot.sum())} reading(s) in {label} exceed 60 °C (max {float(np.nanmax(vals)):.1f} °C). "
                    "A technician should review these readings.",
                    column=col,
                    field=fld,
                    count=int(hot.sum()),
                    rows=_rows_of(hot, lines),
                )
            )
        if fld == "voltage" and vals.size > 2:
            jumps = np.abs(np.diff(arr[finite]))
            limit = max(0.15 * float(np.nanmedian(vals)), 2.0)
            big = jumps > limit
            if big.any():
                issues.append(
                    issue(
                        "VOLTAGE_JUMPS",
                        "warning",
                        f"{int(big.sum())} sudden voltage change(s) larger than {limit:.1f} V between consecutive samples.",
                        column=col,
                        field=fld,
                        count=int(big.sum()),
                    )
                )

    _cross_checks(a, battery)

    # Current sign convention: needed to tell charge from discharge.
    if "current_a" in a.series:
        sign = a.options.get("current_sign")
        if sign not in ("discharge_negative", "discharge_positive"):
            issues.append(
                issue(
                    "CURRENT_SIGN_UNCONFIRMED",
                    "warning",
                    "Confirm the current sign convention (is discharge negative or positive in this file?). "
                    "It is assumed to be negative.",
                    field="current",
                )
            )
            sign = "discharge_negative"
        if sign == "discharge_positive":
            a.series["current_a"] = -a.series["current_a"]
        a.options["current_sign_applied"] = sign

    a.valid = valid
    if not mapping_was_suggested:
        a.options["mapping_source"] = "user"
    a.stats.update({"rows": n, "rows_importable": int(valid.sum())})
    return a


def _cross_checks(a: Analysis, battery: dict[str, Any] | None) -> None:
    if not battery:
        return
    v = a.series.get("voltage_v")
    nominal = battery.get("nominal_voltage_v")
    if v is not None and nominal:
        finite = v[np.isfinite(v)]
        if finite.size:
            med = float(np.median(finite))
            if not (0.6 * nominal <= med <= 1.4 * nominal):
                a.issues.append(
                    issue(
                        "VOLTAGE_INCONSISTENT_WITH_RECORD",
                        "warning",
                        f"The median pack voltage in this file is {med:.2f} V, but the battery record says {nominal:g} V nominal. "
                        "Check that this file belongs to this battery and that the voltage unit is correct.",
                        field="voltage",
                    )
                )
    cells = [k for k in a.series if k.startswith("cell_voltage_")]
    series_n = _series_count(battery.get("pack_configuration"))
    if cells and series_n and len(cells) != series_n:
        a.issues.append(
            issue(
                "CELL_COUNT_MISMATCH",
                "warning",
                f"The file has {len(cells)} cell-voltage column(s) but the pack configuration "
                f"'{battery.get('pack_configuration')}' implies {series_n} cells in series.",
                field="cell_voltage",
            )
        )
    window = CHEMISTRY_CELL_WINDOW.get(battery.get("chemistry") or "")
    if cells and window:
        stacked = np.vstack([a.series[k] for k in cells])
        finite = stacked[np.isfinite(stacked)]
        if finite.size and (finite.min() < window[0] or finite.max() > window[1]):
            a.issues.append(
                issue(
                    "CELL_VOLTAGE_OUTSIDE_CHEMISTRY_WINDOW",
                    "warning",
                    f"Cell voltages range {finite.min():.3f}–{finite.max():.3f} V, outside the typical "
                    f"{window[0]}–{window[1]} V window for {battery.get('chemistry')} cells. "
                    "Check the recorded chemistry, the unit, or review the cells.",
                    field="cell_voltage",
                )
            )
    i = a.series.get("current_a")
    rated = battery.get("rated_capacity_ah")
    if i is not None and rated:
        finite = np.abs(i[np.isfinite(i)])
        if finite.size and float(finite.max()) > 10 * rated:
            a.issues.append(
                issue(
                    "CURRENT_HIGH_FOR_RATED_CAPACITY",
                    "warning",
                    f"Peak current {float(finite.max()):.1f} A is more than 10× the rated capacity ({rated:g} Ah). "
                    "Check the current unit (A vs mA).",
                    field="current",
                )
            )


def _series_key(fld: str, ordinal: int) -> str:
    base = {
        "voltage": "voltage_v",
        "current": "current_a",
        "soc": "soc_pct",
        "capacity": "capacity_ah",
        "energy": "energy_wh",
        "power": "power_w",
        "cycle": "cycle",
    }
    if fld == "temperature":
        return "temperature_c" if ordinal == 1 else f"temperature_{ordinal}_c"
    if fld == "cell_voltage":
        return f"cell_voltage_{ordinal}_v"
    return base[fld]


def _canon_unit(fld: str) -> str:
    return {"voltage": "V", "cell_voltage": "V", "current": "A", "temperature": "°C", "soc": "%"}.get(fld, "")


def _fmt_duration(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.0f} ms"
    if seconds < 120:
        return f"{seconds:.3g} s"
    if seconds < 7200:
        return f"{seconds / 60:.1f} min"
    return f"{seconds / 3600:.2f} h"


# --------------------------------------------------------------------------- outputs


CORE_KEYS = ("voltage_v", "current_a", "temperature_c", "soc_pct")


def _num(v: float) -> float | None:
    return None if v is None or not np.isfinite(v) else float(v)


def preview_rows(a: Analysis, limit: int = 10) -> list[dict[str, Any]]:
    if a.t_s is None or a.valid is None:
        return []
    out = []
    idx = np.flatnonzero(a.valid)[:limit]
    for i in idx:
        row: dict[str, Any] = {"source_line": a.table.source_line[i], "t_s": _num(a.t_s[i])}
        for k, arr in a.series.items():
            row[k] = _num(arr[i])
        if "step" in a.text_series:
            row["step"] = a.text_series["step"][i]
        out.append(row)
    return out


def normalized_points(a: Analysis) -> list[dict[str, Any]]:
    assert a.t_s is not None and a.valid is not None
    extra_keys = [k for k in a.series if k not in CORE_KEYS]
    points = []
    seq = 0
    for i in np.flatnonzero(a.valid):
        extra = {k: _num(a.series[k][i]) for k in extra_keys}
        if "step" in a.text_series:
            extra["step"] = a.text_series["step"][i]
        extra = {k: v for k, v in extra.items() if v is not None}
        points.append(
            {
                "seq": seq,
                "source_row": a.table.source_line[i],
                "t_s": float(a.t_s[i]),
                "voltage_v": _num(a.series["voltage_v"][i]) if "voltage_v" in a.series else None,
                "current_a": _num(a.series["current_a"][i]) if "current_a" in a.series else None,
                "temperature_c": _num(a.series["temperature_c"][i]) if "temperature_c" in a.series else None,
                "soc_pct": _num(a.series["soc_pct"][i]) if "soc_pct" in a.series else None,
                "extra": extra or None,
            }
        )
        seq += 1
    return points


def summarize(a: Analysis) -> dict[str, Any]:
    """Deterministic calculated values. Every metric states its method so a
    report can show how it was derived. None of these are capacity-test results
    unless the test itself was a controlled full discharge."""
    assert a.t_s is not None and a.valid is not None
    v = a.valid
    t = a.t_s[v]
    metrics: list[dict[str, Any]] = []

    def add(key: str, label: str, value: float | None, unit: str, method: str) -> None:
        if value is None or not np.isfinite(value):
            return
        metrics.append({"key": key, "label": label, "value": round(float(value), 4), "unit": unit, "method": method})

    if t.size:
        add("duration_h", "Recorded duration", (np.nanmax(t) - np.nanmin(t)) / 3600.0, "h", "Last minus first valid time value.")
    add("samples", "Valid samples", float(v.sum()), "rows", "Rows with a readable time value.")
    if "median_interval_s" in a.stats:
        add("median_interval_s", "Typical sampling interval", a.stats["median_interval_s"], "s", "Median of positive time steps.")

    def series(key: str) -> np.ndarray | None:
        arr = a.series.get(key)
        if arr is None:
            return None
        arr = arr[v]
        return arr if np.isfinite(arr).any() else None

    volt = series("voltage_v")
    if volt is not None:
        f = volt[np.isfinite(volt)]
        add("voltage_min_v", "Minimum pack voltage", f.min(), "V", "Minimum of imported voltage samples.")
        add("voltage_max_v", "Maximum pack voltage", f.max(), "V", "Maximum of imported voltage samples.")
        add("voltage_start_v", "Pack voltage at start", f[0], "V", "First valid voltage sample.")
        add("voltage_end_v", "Pack voltage at end", f[-1], "V", "Last valid voltage sample.")

    cur = series("current_a")
    if cur is not None:
        f = cur[np.isfinite(cur)]
        add("current_max_discharge_a", "Peak discharge current", -f.min() if f.min() < 0 else None, "A", "Largest negative current sample (discharge is negative after sign normalization).")
        add("current_max_charge_a", "Peak charge current", f.max() if f.max() > 0 else None, "A", "Largest positive current sample.")
        ah_dis, ah_chg, wh_dis = _integrate(t, cur, volt, a.stats.get("median_interval_s"))
        method = (
            "Trapezoidal integration of current over time; intervals longer than 5× the typical sampling "
            "interval and backwards time steps are excluded. This is charge throughput, not a rated-capacity "
            "measurement unless the test was a controlled full discharge."
        )
        add("ah_discharged", "Charge throughput (discharge)", ah_dis, "Ah", method)
        add("ah_charged", "Charge throughput (charge)", ah_chg, "Ah", method)
        if volt is not None:
            add("wh_discharged", "Energy throughput (discharge)", wh_dis, "Wh", method.replace("current", "voltage × current"))

    temps = [k for k in a.series if k.startswith("temperature")]
    if temps:
        stacked = np.vstack([a.series[k][v] for k in temps])
        if np.isfinite(stacked).any():
            add("temperature_min_c", "Minimum temperature", np.nanmin(stacked), "°C", f"Minimum across {len(temps)} temperature column(s).")
            add("temperature_max_c", "Maximum temperature", np.nanmax(stacked), "°C", f"Maximum across {len(temps)} temperature column(s).")

    soc = series("soc_pct")
    if soc is not None:
        f = soc[np.isfinite(soc)]
        add("soc_start_pct", "State of charge at start (reported)", f[0], "%", "First SOC value in the file (as reported by the source device).")
        add("soc_end_pct", "State of charge at end (reported)", f[-1], "%", "Last SOC value in the file (as reported by the source device).")

    cells = [k for k in a.series if k.startswith("cell_voltage_")]
    if cells:
        stacked = np.vstack([a.series[k][v] for k in cells])
        with np.errstate(all="ignore"):
            full = np.isfinite(stacked).all(axis=0)
        if full.any():
            spread = (stacked[:, full].max(axis=0) - stacked[:, full].min(axis=0)) * 1000.0
            add("cell_count", "Cell-voltage columns", float(len(cells)), "cells", "Number of mapped cell-voltage columns.")
            add("cell_voltage_min_v", "Lowest cell voltage", np.nanmin(stacked), "V", "Minimum across all cell-voltage samples.")
            add("cell_voltage_max_v", "Highest cell voltage", np.nanmax(stacked), "V", "Maximum across all cell-voltage samples.")
            add("cell_spread_max_mv", "Largest cell voltage spread", spread.max(), "mV", "Maximum over samples of (highest − lowest cell voltage) where all cells have a value.")
            add("cell_spread_end_mv", "Cell voltage spread at end", spread[-1], "mV", "Highest − lowest cell voltage in the last complete sample.")
            weakest = int(np.argmin(np.nanmin(stacked, axis=1))) + 1
            add("cell_lowest_index", "Cell with the lowest reading", float(weakest), "cell #", "Index (in mapped column order) of the cell with the lowest single reading.")

    cap = series("capacity_ah")
    if cap is not None:
        f = cap[np.isfinite(cap)]
        add("capacity_counter_max_ah", "Capacity counter maximum (equipment-reported)", np.abs(f).max(), "Ah", "Maximum absolute value of the capacity column recorded by the test equipment.")
    en = series("energy_wh")
    if en is not None:
        f = en[np.isfinite(en)]
        add("energy_counter_max_wh", "Energy counter maximum (equipment-reported)", np.abs(f).max(), "Wh", "Maximum absolute value of the energy column recorded by the test equipment.")

    return {
        "metrics": metrics,
        "first_timestamp": a.first_timestamp,
        "last_timestamp": a.last_timestamp,
        "series_keys": sorted(a.series.keys()) + (["step"] if "step" in a.text_series else []),
    }


def _integrate(t: np.ndarray, cur: np.ndarray, volt: np.ndarray | None, median: float | None):
    if t.size < 2:
        return None, None, None
    dt = np.diff(t)
    i0, i1 = cur[:-1], cur[1:]
    ok = np.isfinite(i0) & np.isfinite(i1) & (dt > 0)
    if median:
        ok &= dt <= max(5 * median, 1.0)
    if not ok.any():
        return None, None, None
    avg_i = (i0 + i1) / 2.0
    ah = avg_i * dt / 3600.0
    dis = float(-ah[ok & (avg_i < 0)].sum())
    chg = float(ah[ok & (avg_i > 0)].sum())
    wh = None
    if volt is not None:
        v0, v1 = volt[:-1], volt[1:]
        okv = ok & np.isfinite(v0) & np.isfinite(v1)
        p = ((v0 * i0) + (v1 * i1)) / 2.0
        e = p * dt / 3600.0
        wh = float(-e[okv & (p < 0)].sum()) if okv.any() else None
    return dis, chg, wh


def analysis_to_dict(a: Analysis) -> dict[str, Any]:
    return {
        "parser": {
            "encoding": a.table.encoding,
            "delimiter": a.table.delimiter,
            "header_row": a.table.header_row,
            "decimal": a.table.decimal,
            "dayfirst": a.options.get("dayfirst"),
            "dayfirst_detected": a.options.get("dayfirst_detected"),
            "current_sign": a.options.get("current_sign"),
            "auto": a.table.auto,
        },
        "preamble": a.table.preamble,
        "columns": a.columns,
        "mapping": a.mapping,
        "raw_rows": [
            {"source_line": a.table.source_line[i], "cells": a.table.rows[i]}
            for i in range(min(MAX_PREVIEW_ROWS, len(a.table.rows)))
        ],
        "normalized_preview": preview_rows(a),
        "issues": a.issues,
        "counts": {
            "errors": len(a.errors),
            "warnings": len(a.warnings),
            "info": len([i for i in a.issues if i["severity"] == "info"]),
        },
        "row_count": len(a.table.rows),
        "importable_rows": int(a.valid.sum()) if a.valid is not None else 0,
        "can_import": a.can_import,
        "requires_acknowledgement": bool(a.warnings),
        "first_timestamp": a.first_timestamp,
        "last_timestamp": a.last_timestamp,
    }
