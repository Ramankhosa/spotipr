#!/usr/bin/env python3
"""
Download Indian Patent Journal PDFs from the IPO journal portal.

The portal does not expose direct PDF links. Each PDF is served by posting a
hidden FileName value to /IPOJournal/Journal/ViewJournal. This script parses
those hidden values, skips design journals, and downloads Patent Journal
Parts I, II, and III.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Sequence


BASE_URL = "https://search.ipindia.gov.in"
JOURNAL_URL = f"{BASE_URL}/IPOJournal/Journal/Patent"
VIEW_URL = f"{BASE_URL}/IPOJournal/Journal/ViewJournal"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)
_FALLBACK_STATUS_WARNINGS: set[tuple[str, str]] = set()


@dataclass(frozen=True)
class DownloadEntry:
    label: str
    file_name: str
    part: int


@dataclass(frozen=True)
class JournalRow:
    serial_no: str
    journal_no: str
    publication_date: str
    availability_date: str
    downloads: tuple[DownloadEntry, ...]

    @property
    def date_key(self) -> str:
        return datetime.strptime(self.availability_date, "%d/%m/%Y").strftime("%Y%m%d")

    @property
    def date_dash(self) -> str:
        return datetime.strptime(self.availability_date, "%d/%m/%Y").strftime("%Y-%m-%d")

    @property
    def journal_issue(self) -> str:
        return self.journal_no.split("/", 1)[0].strip()

    @property
    def journal_year(self) -> str:
        parts = self.journal_no.split("/", 1)
        return parts[1].strip() if len(parts) == 2 else ""


class PatentJournalParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[JournalRow] = []
        self._in_tr = False
        self._in_td = False
        self._in_button = False
        self._cells: list[str] = []
        self._cell_chunks: list[str] = []
        self._downloads: list[dict[str, str]] = []
        self._form: dict[str, str] | None = None
        self._button_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {name.lower(): value or "" for name, value in attrs}
        if tag == "tr":
            self._in_tr = True
            self._cells = []
            self._downloads = []
        elif tag == "td" and self._in_tr:
            self._in_td = True
            self._cell_chunks = []
        elif tag == "form" and self._in_tr:
            self._form = {}
            self._button_chunks = []
        elif tag == "input" and self._form is not None:
            if attrs_dict.get("name") == "FileName":
                self._form["file_name"] = html.unescape(attrs_dict.get("value", ""))
        elif tag == "button" and self._form is not None:
            self._in_button = True
            self._button_chunks = []

    def handle_data(self, data: str) -> None:
        if self._in_td:
            self._cell_chunks.append(data)
        if self._in_button:
            self._button_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._form is not None:
            self._form["label"] = normalize_text(" ".join(self._button_chunks))
            self._in_button = False
        elif tag == "form" and self._form is not None:
            file_name = self._form.get("file_name", "")
            label = self._form.get("label", "")
            if file_name:
                self._downloads.append({"label": label, "file_name": file_name})
            self._form = None
            self._button_chunks = []
        elif tag == "td" and self._in_td:
            self._cells.append(normalize_text(" ".join(self._cell_chunks)))
            self._in_td = False
            self._cell_chunks = []
        elif tag == "tr" and self._in_tr:
            self._finish_row()
            self._in_tr = False

    def _finish_row(self) -> None:
        if len(self._cells) < 4 or not self._downloads:
            return

        entries: list[DownloadEntry] = []
        for item in self._downloads:
            label = item["label"]
            file_name = item["file_name"]
            part = classify_part(label, file_name)
            if part is None:
                continue
            entries.append(DownloadEntry(label=label, file_name=file_name, part=part))

        if not entries:
            return

        self.rows.append(
            JournalRow(
                serial_no=self._cells[0],
                journal_no=self._cells[1],
                publication_date=self._cells[2],
                availability_date=self._cells[3],
                downloads=tuple(sorted(entries, key=lambda item: item.part)),
            )
        )


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def classify_part(label: str, file_name: str) -> int | None:
    text = f"{label} {file_name}".lower().replace("\\", "/")
    if "design" in text:
        return None

    patterns = (
        (1, r"\bpart[\s_-]*(?:i|1)\b|\b1st[\s_-]*(?:part)?\b|\bpart[\s_-]*1\b"),
        (2, r"\bpart[\s_-]*(?:ii|2)\b|\b2nd[\s_-]*(?:part|docx)?\b|\bpart[\s_-]*2\b"),
        (3, r"\bpart[\s_-]*(?:iii|3)\b|\b3rd[\s_-]*(?:part|docx)?\b|\bpart[\s_-]*3\b|\blast[\s_-]*part\b"),
    )
    for part, pattern in patterns:
        if re.search(pattern, text):
            return part
    return None


def request_bytes(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def fetch_rows(timeout: int) -> list[JournalRow]:
    content = request_bytes(JOURNAL_URL, timeout=timeout).decode("utf-8", errors="replace")
    parser = PatentJournalParser()
    parser.feed(content)
    return parser.rows


def choose_rows(rows: list[JournalRow], args: argparse.Namespace) -> list[JournalRow]:
    if args.page_size < 1:
        raise ValueError("--page-size must be 1 or greater")

    selected = rows
    if args.since:
        since = datetime.strptime(args.since, "%Y-%m-%d").date()
        selected = [
            row
            for row in selected
            if datetime.strptime(row.availability_date, "%d/%m/%Y").date() >= since
        ]
    if args.page is not None:
        if args.page < 1:
            raise ValueError("--page must be 1 or greater")
        start = (args.page - 1) * args.page_size
        selected = selected[start : start + args.page_size]
    if not args.all and args.page is None:
        selected = selected[: (args.limit or 1)]
    elif args.limit is not None:
        selected = selected[: args.limit]
    return selected


def safe_filename(value: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", value).strip(" .")


def output_name(row: JournalRow, entry: DownloadEntry, template: str) -> str:
    roman = {1: "I", 2: "II", 3: "III"}[entry.part]
    name = template.format(
        date=row.date_key,
        date_dash=row.date_dash,
        journal=row.journal_no.replace("/", "-"),
        journal_issue=row.journal_issue,
        journal_year=row.journal_year,
        part=entry.part,
        roman=roman,
        key=job_key(entry),
    )
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return safe_filename(name)


def iter_jobs(rows: Iterable[JournalRow], output_dir: Path, template: str) -> Iterable[tuple[JournalRow, DownloadEntry, Path]]:
    for row in rows:
        for entry in row.downloads:
            yield row, entry, output_dir / output_name(row, entry, template)


def unique_jobs(
    jobs: Iterable[tuple[JournalRow, DownloadEntry, Path]]
) -> list[tuple[JournalRow, DownloadEntry, Path]]:
    seen: set[str] = set()
    unique: list[tuple[JournalRow, DownloadEntry, Path]] = []
    for row, entry, target in jobs:
        key = job_key(entry)
        if key in seen:
            continue
        seen.add(key)
        unique.append((row, entry, target))
    return unique


def job_key(entry: DownloadEntry) -> str:
    return hashlib.sha1(entry.file_name.encode("utf-8")).hexdigest()[:16]


def write_status(path: Path, records: dict[str, dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "key",
        "status",
        "availability_date",
        "publication_date",
        "journal_no",
        "part",
        "label",
        "output_file",
        "bytes",
        "sha256",
        "portal_file_name",
        "error",
        "updated_at",
    ]
    temp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    with temp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records.values():
            writer.writerow({field: record.get(field, "") for field in fieldnames})
    replace_or_fallback(temp, path)


def write_state(path: Path, records: dict[str, dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(records, handle, indent=2, sort_keys=True)
    replace_or_fallback(temp, path)


def replace_or_fallback(temp: Path, target: Path) -> None:
    for attempt in range(1, 6):
        try:
            os.replace(temp, target)
            return
        except PermissionError:
            if attempt == 5:
                break
            time.sleep(0.5 * attempt)

    fallback = target.with_name(f"{target.stem}.latest{target.suffix}")
    os.replace(temp, fallback)
    warning_key = (str(target), str(fallback))
    if warning_key not in _FALLBACK_STATUS_WARNINGS:
        _FALLBACK_STATUS_WARNINGS.add(warning_key)
        print(
            f"WARNING: {target} is locked by another program; wrote latest status to {fallback}. "
            f"Close the locked file to let future updates use the main path.",
            file=sys.stderr,
        )


def now_utc() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def build_status_records(
    jobs: Iterable[tuple[JournalRow, DownloadEntry, Path]]
) -> dict[str, dict[str, str]]:
    records: dict[str, dict[str, str]] = {}
    output_paths: dict[str, str] = {}
    for row, entry, target in jobs:
        key = job_key(entry)
        target_text = str(target)
        error = ""
        if target_text in output_paths and output_paths[target_text] != key:
            error = f"Output filename collision with {output_paths[target_text]}"
        else:
            output_paths[target_text] = key

        status = "missing"
        size = ""
        digest = ""
        if target.exists() and target.stat().st_size > 0:
            try:
                with target.open("rb") as handle:
                    header = handle.read(5)
                if header == b"%PDF-":
                    status = "downloaded"
                    size = str(target.stat().st_size)
                    digest = sha256_file(target)
                else:
                    status = "invalid"
                    error = "Existing file does not start with %PDF-"
            except OSError as exc:
                status = "invalid"
                error = str(exc)

        records[key] = {
            "key": key,
            "status": status,
            "availability_date": row.availability_date,
            "publication_date": row.publication_date,
            "journal_no": row.journal_no,
            "part": str(entry.part),
            "label": entry.label,
            "output_file": target_text,
            "bytes": size,
            "sha256": digest,
            "portal_file_name": entry.file_name,
            "error": error,
            "updated_at": now_utc(),
        }
    return records


def row_page_number(row_index: int, page_size: int) -> int:
    return (row_index // page_size) + 1


def chunk_rows(rows: Sequence[JournalRow], page_size: int) -> Iterable[tuple[int, Sequence[JournalRow]]]:
    if page_size < 1:
        yield 1, rows
        return
    for start in range(0, len(rows), page_size):
        yield row_page_number(start, page_size), rows[start : start + page_size]


def download_pdf(
    row: JournalRow,
    entry: DownloadEntry,
    target: Path,
    timeout: int,
    retries: int,
    overwrite: bool,
) -> tuple[str, int, str]:
    if target.exists() and target.stat().st_size > 0 and not overwrite:
        return "skipped", target.stat().st_size, sha256_file(target)

    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".tmp")
    data = urllib.parse.urlencode({"FileName": entry.file_name}).encode("utf-8")
    headers = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": JOURNAL_URL,
        "Origin": BASE_URL,
    }

    last_error: Exception | None = None
    for attempt in range(1, retries + 2):
        try:
            request = urllib.request.Request(VIEW_URL, data=data, headers=headers, method="POST")
            digest = hashlib.sha256()
            total = 0
            with urllib.request.urlopen(request, timeout=timeout) as response, temp.open("wb") as handle:
                content_type = response.headers.get("Content-Type", "")
                if "pdf" not in content_type.lower():
                    raise RuntimeError(f"Unexpected content type {content_type!r}")
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    digest.update(chunk)
                    handle.write(chunk)

            with temp.open("rb") as handle:
                header = handle.read(5)
            if header != b"%PDF-":
                raise RuntimeError("Downloaded file does not start with %PDF-")

            os.replace(temp, target)
            return "downloaded", total, digest.hexdigest()
        except (
            urllib.error.URLError,
            TimeoutError,
            RuntimeError,
            http.client.RemoteDisconnected,
            http.client.IncompleteRead,
            ConnectionError,
            OSError,
        ) as exc:
            last_error = exc
            if temp.exists():
                try:
                    temp.unlink()
                except OSError:
                    pass
            if attempt <= retries:
                time.sleep(min(2 * attempt, 10))
                continue
            raise RuntimeError(f"{target.name}: {last_error}") from last_error

    raise RuntimeError(f"{target.name}: failed without an error")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def append_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "availability_date",
        "publication_date",
        "journal_no",
        "part",
        "label",
        "portal_file_name",
        "output_file",
        "status",
        "bytes",
        "sha256",
    ]
    write_header = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download IPO Patent Journal PDFs, skipping design journals."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="download every parsed journal row instead of only the newest rows",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="number of newest journal rows to process; default is 1 unless --all is used",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=5,
        help="portal UI rows per page; used for page targeting/progress reporting",
    )
    parser.add_argument(
        "--page",
        type=int,
        help="process one portal UI page number using --page-size rows per page",
    )
    parser.add_argument(
        "--since",
        metavar="YYYY-MM-DD",
        help="only process journals with Date of Availability on or after this date",
    )
    parser.add_argument("--output-dir", default="downloads", help="directory for downloaded PDFs")
    parser.add_argument(
        "--name-template",
        default="{date}{part}.pdf",
        help=(
            "filename template. Available fields: {date}, {date_dash}, {journal}, "
            "{journal_issue}, {journal_year}, {part}, {roman}, {key}. Default: {date}{part}.pdf"
        ),
    )
    parser.add_argument("--manifest", default="downloads/manifest.csv", help="CSV manifest path")
    parser.add_argument(
        "--status",
        default="downloads/download_status.csv",
        help="CSV inventory of every expected file and whether it is present, missing, invalid, or failed",
    )
    parser.add_argument(
        "--state",
        default="downloads/download_state.json",
        help="JSON inventory mirroring --status for machine-readable resume/checks",
    )
    parser.add_argument(
        "--status-only",
        action="store_true",
        help="write the expected-file inventory without downloading",
    )
    parser.add_argument("--dry-run", action="store_true", help="print planned downloads only")
    parser.add_argument("--overwrite", action="store_true", help="replace existing PDFs")
    parser.add_argument("--timeout", type=int, default=180, help="HTTP timeout in seconds")
    parser.add_argument("--retries", type=int, default=2, help="retry count per PDF")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    output_dir = Path(args.output_dir)
    manifest = Path(args.manifest)
    status_path = Path(args.status)
    state_path = Path(args.state)

    print(f"Fetching journal list: {JOURNAL_URL}")
    rows = fetch_rows(timeout=args.timeout)
    if not rows:
        print("No patent journal rows were parsed.", file=sys.stderr)
        return 1

    try:
        selected = choose_rows(rows, args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if not selected:
        print("No rows matched the requested filters.", file=sys.stderr)
        return 1

    raw_jobs = list(iter_jobs(selected, output_dir, args.name_template))
    jobs = unique_jobs(raw_jobs)
    status_records = build_status_records(jobs)
    write_status(status_path, status_records)
    write_state(state_path, status_records)

    collisions = [record for record in status_records.values() if "collision" in record.get("error", "")]
    if collisions:
        print("Output filename collision detected. Use --name-template with {journal} to avoid overwrites.", file=sys.stderr)
        for record in collisions[:10]:
            print(f"  {record['output_file']}: {record['error']}", file=sys.stderr)
        return 1

    total_pages = (len(rows) + args.page_size - 1) // args.page_size
    print(
        f"Parsed {len(rows)} journal rows across {total_pages} portal page(s) "
        f"at {args.page_size} rows/page; selected {len(selected)} row(s), "
        f"{len(jobs)} unique PDF(s)."
    )
    if len(raw_jobs) != len(jobs):
        print(f"Collapsed {len(raw_jobs) - len(jobs)} duplicate portal entries with identical FileName values.")
    print(f"Status inventory written to {status_path}.")

    if args.dry_run or args.status_only:
        selected_offset = rows.index(selected[0]) if selected else 0
        for page_no, page_rows in chunk_rows(selected, args.page_size):
            actual_page_no = row_page_number(selected_offset, args.page_size) + page_no - 1
            print(f"Portal page {actual_page_no}/{total_pages}")
            for row, entry, target in iter_jobs(page_rows, output_dir, args.name_template):
                status = status_records[job_key(entry)]["status"]
                prefix = "STATUS" if args.status_only else "DRY RUN"
                print(f"{prefix} {status} {row.availability_date} {row.journal_no} Part {entry.part}: {target}")
        return 0

    manifest_rows: list[dict[str, str]] = []
    failures = 0
    selected_offset = rows.index(selected[0]) if selected else 0
    for page_no, page_rows in chunk_rows(selected, args.page_size):
        actual_page_no = row_page_number(selected_offset, args.page_size) + page_no - 1
        print(f"Portal page {actual_page_no}/{total_pages}")
        for row, entry, target in iter_jobs(page_rows, output_dir, args.name_template):
            print(f"{row.availability_date} {row.journal_no} Part {entry.part} -> {target}")
            try:
                status, size, digest = download_pdf(
                    row=row,
                    entry=entry,
                    target=target,
                    timeout=args.timeout,
                    retries=args.retries,
                    overwrite=args.overwrite,
                )
                print(f"  {status}: {size:,} bytes")
                status_records[job_key(entry)].update(
                    {
                        "status": "downloaded",
                        "bytes": str(size),
                        "sha256": digest,
                        "error": "",
                        "updated_at": now_utc(),
                    }
                )
                write_status(status_path, status_records)
                write_state(state_path, status_records)
                manifest_rows.append(
                    {
                        "availability_date": row.availability_date,
                        "publication_date": row.publication_date,
                        "journal_no": row.journal_no,
                        "part": str(entry.part),
                        "label": entry.label,
                        "portal_file_name": entry.file_name,
                        "output_file": str(target),
                        "status": status,
                        "bytes": str(size),
                        "sha256": digest,
                    }
                )
            except RuntimeError as exc:
                failures += 1
                print(f"  ERROR: {exc}", file=sys.stderr)
                status_records[job_key(entry)].update(
                    {
                        "status": "failed",
                        "error": str(exc),
                        "updated_at": now_utc(),
                    }
                )
                write_status(status_path, status_records)
                write_state(state_path, status_records)

    append_manifest(manifest, manifest_rows)
    if failures:
        print(
            f"Completed with {failures} failure(s). Manifest written to {manifest}; "
            f"status written to {status_path}.",
            file=sys.stderr,
        )
        return 2

    missing = sum(1 for record in status_records.values() if record["status"] != "downloaded")
    print(f"Done. Manifest written to {manifest}. Status written to {status_path}. Missing/failed: {missing}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
