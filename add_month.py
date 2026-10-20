#!/usr/bin/env python3
"""Add one month of prices to data/prices.json.

Usage:
    python3 scripts/add_month.py 2026-11 templates/month_template.csv
    python3 scripts/add_month.py 2026-11 november.csv --replace-month

The CSV needs these columns (names are case-insensitive):
    brand, model, variant, mop, dp_rp
and may also have:
    other   extra prices worth keeping, as free text (for example "SRP 26,999 · NEP 26,999")
    note    a caution shown when you hover over the row
    source  where the price came from (for example "Xiaomi Ready Reckoner")

mop and dp_rp may be blank when the price list does not give one. Numbers can
contain commas ("1,39,999").

Rows are matched to earlier months by brand + model + variant (exact text), so
spell them the same way each month. A new combination is added at the end;
an existing one keeps its position.

By default rows are merged into the month (a row for the same variant replaces
the earlier row for that month). Use --replace-month to delete everything
already stored for the month first, which is what you want when re-importing
a whole month.

Only the Python standard library is needed.
"""
import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path

ALIASES = {
    "dp_rp": ("dp_rp", "dp/rp", "dp", "rp", "billing price", "retailer dp", "retailer price"),
    "mop": ("mop", "msp", "srp", "rrp"),
}


def to_int(text, line, field):
    text = (text or "").strip().replace(",", "").replace("₹", "")
    if text == "":
        return None
    if not re.fullmatch(r"\d+", text):
        sys.exit(f"Line {line}: '{field}' must be a whole number or blank, got {text!r}")
    return int(text)


def pick(header, wanted):
    """Find the CSV column for a field, accepting a few common names."""
    names = {h.strip().lower(): h for h in header}
    for alias in wanted:
        if alias in names:
            return names[alias]
    return None


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            sys.exit("The CSV is empty.")
        cols = {
            "brand": pick(reader.fieldnames, ("brand",)),
            "model": pick(reader.fieldnames, ("model",)),
            "variant": pick(reader.fieldnames, ("variant",)),
            "mop": pick(reader.fieldnames, ALIASES["mop"]),
            "rp": pick(reader.fieldnames, ALIASES["dp_rp"]),
            "other": pick(reader.fieldnames, ("other",)),
            "note": pick(reader.fieldnames, ("note",)),
            "source": pick(reader.fieldnames, ("source",)),
        }
        missing = [k for k in ("brand", "model", "variant", "mop", "rp") if cols[k] is None]
        if missing:
            sys.exit(f"The CSV is missing column(s): {', '.join(missing)}. Found: {', '.join(reader.fieldnames)}")
        out = []
        for i, row in enumerate(reader, start=2):
            if not any((v or "").strip() for v in row.values()):
                continue
            get = lambda k: (row.get(cols[k]) or "").strip() if cols[k] else ""
            brand, model = get("brand"), get("model")
            if not brand or not model:
                sys.exit(f"Line {i}: brand and model are required.")
            out.append({
                "brand": brand,
                "model": model,
                "variant": get("variant"),
                "mop": to_int(row.get(cols["mop"]), i, "mop"),
                "rp": to_int(row.get(cols["rp"]), i, "dp_rp"),
                "other": get("other"),
                "note": get("note"),
                "source": get("source"),
            })
        return out


def write_rows(path, rows):
    # One row per line keeps Git diffs readable.
    with open(path, "w", encoding="utf-8") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n]\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("month", help="Month as YYYY-MM, for example 2026-11")
    ap.add_argument("csv", help="CSV file with the month's prices")
    ap.add_argument("--data", default=str(Path(__file__).resolve().parent.parent / "data" / "prices.json"),
                    help="Path to prices.json (default: data/prices.json)")
    ap.add_argument("--replace-month", action="store_true",
                    help="Delete all rows already stored for this month before importing")
    ap.add_argument("--dry-run", action="store_true", help="Show what would change and write nothing")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", args.month):
        sys.exit("Month must look like 2026-11.")

    data_path = Path(args.data)
    existing = json.loads(data_path.read_text(encoding="utf-8")) if data_path.exists() else []
    new_rows = read_csv(args.csv)
    if not new_rows:
        sys.exit("The CSV has no data rows.")

    seq_by_key = {}
    for r in existing:
        seq_by_key.setdefault(r["key"], r["seq"])
    next_seq = math.floor(max((r["seq"] for r in existing), default=0)) + 1

    if args.replace_month:
        dropped = sum(1 for r in existing if r["month"] == args.month)
        existing = [r for r in existing if r["month"] != args.month]
    else:
        dropped = 0

    by_key_month = {(r["key"], r["month"]): i for i, r in enumerate(existing)}
    added = updated = 0
    new_variants = []
    warnings = []
    seen_in_csv = set()

    for r in new_rows:
        key = f'{r["brand"]}|{r["model"]}|{r["variant"]}'
        if key in seen_in_csv:
            sys.exit(f"The CSV lists {key!r} twice. Each variant can appear once per month.")
        seen_in_csv.add(key)
        if key not in seq_by_key:
            seq_by_key[key] = next_seq
            next_seq += 1
            new_variants.append(key)
        row = {
            "key": key, "seq": seq_by_key[key], "brand": r["brand"], "model": r["model"],
            "variant": r["variant"], "month": args.month, "mop": r["mop"], "rp": r["rp"],
            "other": r["other"], "note": r["note"], "source": r["source"],
        }
        if r["mop"] and r["rp"] and r["rp"] > r["mop"]:
            warnings.append(f"{key}: DP/RP ({r['rp']}) is higher than MOP ({r['mop']}).")
        if r["mop"] is None and r["rp"] is None:
            warnings.append(f"{key}: has neither MOP nor DP/RP.")
        idx = by_key_month.get((key, args.month))
        if idx is not None:
            existing[idx] = row
            updated += 1
        else:
            existing.append(row)
            added += 1

    previous = {r["key"] for r in existing if r["month"] < args.month}
    missing_now = sorted(previous - seen_in_csv)

    print(f"Month {args.month}: {added} added, {updated} updated" + (f", {dropped} dropped first" if dropped else "") + ".")
    if new_variants:
        print(f"{len(new_variants)} variant(s) not seen in earlier months.")
    if missing_now:
        print(f"{len(missing_now)} variant(s) from earlier months are not in this CSV and will show blank for {args.month}.")
    for w in warnings:
        print("Warning:", w)

    if args.dry_run:
        print("Dry run: nothing written.")
        return
    write_rows(data_path, existing)
    print(f"Wrote {data_path}.")


if __name__ == "__main__":
    main()
