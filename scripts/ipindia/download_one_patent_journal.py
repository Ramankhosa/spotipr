#!/usr/bin/env python3
"""Download one IPO patent journal PDF using the copied Patentjournal module."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from download_patent_journals import DownloadEntry, download_pdf


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download one IPO Patent Journal PDF.")
    parser.add_argument("--portal-file-name", required=True)
    parser.add_argument("--part", type=int, required=True)
    parser.add_argument("--label", default="")
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    target = Path(args.output_file)
    entry = DownloadEntry(label=args.label, file_name=args.portal_file_name, part=args.part)
    status, size, digest = download_pdf(
        row=None,  # The tested downloader does not use row data inside download_pdf.
        entry=entry,
        target=target,
        timeout=args.timeout,
        retries=args.retries,
        overwrite=args.overwrite,
    )
    print(f"{status} {size} {digest} {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
