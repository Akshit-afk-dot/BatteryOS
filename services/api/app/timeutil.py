"""Workspace-local dates. Timestamps are stored in UTC; calendar dates such as
"received on" or "valid until" follow the workspace's time zone."""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TZ = "Asia/Kolkata"


def zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def is_valid_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def today(tz_name: str | None) -> date:
    return datetime.now(timezone.utc).astimezone(zone(tz_name)).date()


def local(dt: datetime, tz_name: str | None) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(zone(tz_name))


def local_date(dt: datetime, tz_name: str | None) -> date:
    return local(dt, tz_name).date()
