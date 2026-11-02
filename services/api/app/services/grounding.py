"""Deterministic checks run on every report draft and every edit.

They do not judge whether the narrative is right; they flag statements a
qualified reviewer must look at before approving:

  * numbers that do not appear anywhere in the cited evidence,
  * citations to records that are not in the evidence pack,
  * statements without any citation,
  * wording that amounts to a safety, certification, fitness-for-use,
    remaining-life or final-decision claim.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_.])[-+]?\d+(?:[.,]\d+)?(?![A-Za-z0-9_])|(?<![A-Za-z0-9_.])[-+]?\d+(?:\.\d+)?(?=[A-Za-z°%Ω])")
CITATION_RE = re.compile(r"\[[A-Z]\d{1,3}(?:\s*,\s*[A-Z]\d{1,3})*\]")
DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")

PROHIBITED: list[tuple[str, str]] = [
    (r"\b(is|are|was|were|be|been|deemed|considered|appears?|seems?)\s+(to be\s+)?(safe|unsafe)\b", "States that the battery is safe or unsafe."),
    (r"\bsafe (to|for)\b", "States that the battery is safe for a use."),
    (r"\bcertif(y|ied|ies|ication|icate)\b", "Mentions certification. The system cannot certify batteries."),
    (r"\bguarantee[ds]?\b", "Uses guarantee language."),
    (r"\bcompl(iant|iance)\b", "Makes a compliance claim."),
    (r"\bfit (for|to be) (use|purpose|service|reuse|resale|deployment)\b", "Makes a fitness-for-use claim."),
    (r"\b(ready|suitable|approved) for (reuse|resale|deployment|service|second[- ]life|installation)\b", "Makes a fitness-for-use claim."),
    (r"\bremaining (useful )?life\b|\bRUL\b|\byears? of (life|service)\b|\bcycles? (left|remaining)\b", "Estimates remaining life."),
    (r"\bresale value\b|\bworth\b|\bvaluation\b", "Makes a valuation claim."),
    (r"\b(should|must|will) be (reused|resold|scrapped|rejected|recycled|discarded|repaired|repurposed)\b", "Makes a final repair/reuse/rejection decision."),
    (r"\b(recommend|recommends|recommended|recommending)\s+(that\s+)?(the\s+)?(battery|pack)?\s*(be\s+)?(reuse|resale|scrap|reject|recycl|discard|repurpos)\w*", "Recommends a final reuse/rejection decision."),
]

SOH_RE = re.compile(r"\b(state of health|SOH)\b", re.IGNORECASE)


def _numbers_in(value: Any, out: set[float]) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        out.add(float(value))
    elif isinstance(value, str):
        for m in re.finditer(r"[-+]?\d+(?:[.,]\d+)?", value):
            try:
                out.add(float(m.group(0).replace(",", ".")))
            except ValueError:
                pass
    elif isinstance(value, dict):
        for v in value.values():
            _numbers_in(v, out)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _numbers_in(v, out)


def evidence_numbers(evidence: Iterable[dict[str, Any]]) -> set[float]:
    nums: set[float] = set()
    for item in evidence:
        _numbers_in(item.get("data"), nums)
        _numbers_in(item.get("label"), nums)
    return nums


def _supported(x: float, nums: set[float]) -> bool:
    """True if x equals an evidence value, allowing rounding (0–4 decimals),
    sign, and simple unit rescaling (milli, minutes, percent)."""
    x = abs(x)
    for e in nums:
        e = abs(e)
        for candidate in (e, e * 1000, e / 1000, e * 60, e / 60, e * 100):
            for k in range(0, 5):
                if abs(round(candidate, k) - x) < 1e-9:
                    return True
    return False


def _extract_numbers(text: str) -> list[tuple[str, float]]:
    clean = CITATION_RE.sub(" ", text)
    clean = DATE_RE.sub(lambda m: m.group(0).replace("-", " "), clean)
    found = []
    for m in NUMBER_RE.finditer(clean):
        raw = m.group(0)
        try:
            val = float(raw.replace(",", "."))
        except ValueError:
            continue
        found.append((raw, val))
    return found


def check_sections(
    sections: list[dict[str, Any]], evidence: list[dict[str, Any]], *, reviewer_conclusion: str | None = None
) -> list[dict[str, Any]]:
    keys = {i["key"] for i in evidence}
    nums = evidence_numbers(evidence)
    has_soh = any(
        "health" in str(i.get("label", "")).lower() or "soh" in str(i.get("data", {}).get("quantity", "")).lower()
        for i in evidence
    )
    checks: list[dict[str, Any]] = []

    def add(code: str, severity: str, message: str, section: str, paragraph: int | None, excerpt: str | None = None):
        checks.append(
            {
                "code": code,
                "severity": severity,
                "message": message,
                "section": section,
                "paragraph": paragraph,
                "excerpt": excerpt[:200] if excerpt else None,
            }
        )

    for s in sections:
        key = s.get("key", "")
        for idx, p in enumerate(s.get("paragraphs", [])):
            text = p.get("text", "") or ""
            cites = p.get("citations", []) or []
            for c in cites:
                if c not in keys:
                    add("UNKNOWN_CITATION", "warning", f"Cites [{c}], which is not in this report's evidence.", key, idx, c)
            numbers = _extract_numbers(text)
            unsupported = [raw for raw, val in numbers if abs(val) > 10 and not _supported(val, nums)]
            unsupported += [raw for raw, val in numbers if abs(val) <= 10 and "." in raw and not _supported(val, nums)]
            if unsupported:
                add(
                    "UNSUPPORTED_NUMBER",
                    "warning",
                    "Contains number(s) not found in the evidence: " + ", ".join(dict.fromkeys(unsupported))
                    + ". Check them against the source records or remove them.",
                    key,
                    idx,
                    text,
                )
            if not cites and key not in ("follow_up",) and text.strip():
                add(
                    "UNCITED_STATEMENT",
                    "warning" if numbers else "info",
                    "This statement does not cite any evidence record.",
                    key,
                    idx,
                    text,
                )
            for pattern, why in PROHIBITED:
                m = re.search(pattern, text, re.IGNORECASE)
                if m:
                    add("PROHIBITED_CLAIM", "warning", why + " Rephrase or remove before approval.", key, idx, m.group(0))
            if SOH_RE.search(text) and not has_soh:
                add(
                    "SOH_WITHOUT_EVIDENCE",
                    "warning",
                    "Mentions state of health, but no SOH measurement or validated model estimate is in the evidence.",
                    key,
                    idx,
                    text,
                )

    if reviewer_conclusion:
        for pattern, why in PROHIBITED[:5]:
            m = re.search(pattern, reviewer_conclusion, re.IGNORECASE)
            if m:
                add(
                    "CONCLUSION_WORDING",
                    "info",
                    "The reviewer conclusion uses wording such as '" + m.group(0) + "'. BatteryOS reports are "
                    "operational records, not safety certificates — make sure this is intended.",
                    "reviewer_conclusion",
                    None,
                    m.group(0),
                )
    return checks
