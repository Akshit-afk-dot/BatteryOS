"""Immutable, content-addressed file storage on the local filesystem.

Files are stored under <storage_dir>/<org_id>/<sha256[:2]>/<sha256> and are made
read-only after writing. The original filename is kept only in the database, so
user-controlled names never touch the filesystem (no path traversal), and the
same bytes uploaded twice are stored once. Swap this module for an object store
(S3, Supabase Storage) in production; the interface is three functions.
"""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path

from .config import get_settings


def _root() -> Path:
    root = Path(get_settings().storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path_for(key: str) -> Path:
    root = _root().resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise ValueError("Invalid storage key")
    return path


def put(org_id: str, data: bytes) -> tuple[str, str]:
    """Store bytes; returns (storage_key, sha256)."""
    digest = hashlib.sha256(data).hexdigest()
    key = f"{org_id}/{digest[:2]}/{digest}"
    path = _path_for(key)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        os.chmod(path, stat.S_IREAD | stat.S_IRGRP)
    return key, digest


def get(key: str) -> bytes:
    return _path_for(key).read_bytes()


def verify(key: str, sha256: str) -> bool:
    try:
        return hashlib.sha256(get(key)).hexdigest() == sha256
    except FileNotFoundError:
        return False
