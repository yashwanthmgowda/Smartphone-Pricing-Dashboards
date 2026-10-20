#!/usr/bin/env python3
"""Sanity-check data/prices.json.

    python3 scripts/check_data.py

Checks for duplicate brand/model/variant/month rows, malformed months, prices
that are not whole numbers, and DP/RP values that look off compared with MOP
(DP/RP is usually 90-99% of MOP). Prints the price-segment counts for the
latest month. Exits with a non-zero status if a real error is found, so it can
run in CI. Only the Python standard library is needed.
"""
import collections
import json
import re
import sys
from pathlib import Path

BANDS = [(10000, "<10k"), (15000, "10k-15k"), (20000, "15k-20k"), (25000, "20k-25k"),
         (30000, "25k-30k"), (40000, "30k-40k"), (60000, "40k-60k"), (float("inf"), "60k+")]


def segment(mop):
    if mop is None:
        return "No MOP"
    return next(label for hi, label in BANDS if mop < hi)


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "prices.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    errors, notes = [], []

    seen = collections.Counter((r["key"], r["month"]) for r in rows)
    for (key, month), n in seen.items():
        if n > 1:
            errors.append(f"{key} appears {n} times in {month}")

    for r in rows:
        where = f'{r["key"]} ({r["month"]})'
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", r["month"]):
            errors.append(f"{where}: month should look like 2026-11")
        if r["key"] != f'{r["brand"]}|{r["model"]}|{r["variant"]}':
            errors.append(f"{where}: key does not match brand|model|variant")
        for f in ("mop", "rp"):
            v = r[f]
            if v is not None and (not isinstance(v, int) or v <= 0):
                errors.append(f"{where}: {f} must be a positive whole number or null, got {v!r}")
        if r["mop"] and r["rp"]:
            ratio = r["rp"] / r["mop"]
            if r["rp"] > r["mop"]:
                notes.append(f"{where}: DP/RP is higher than MOP")
            elif ratio < 0.85:
                notes.append(f"{where}: DP/RP is only {ratio:.0%} of MOP")

    months = sorted({r["month"] for r in rows})
    last = months[-1] if months else None
    cur = [r for r in rows if r["month"] == last]
    print(f"{len(rows)} rows, {len(months)} month(s): {', '.join(months)}")
    print(f"Latest month {last}: {len(cur)} variants across {len({r['brand'] for r in cur})} brands")
    counts = collections.Counter(segment(r["mop"]) for r in cur)
    print("Segments:", ", ".join(f"{label} {counts.get(label, 0)}" for _, label in BANDS), f"| No MOP {counts.get('No MOP', 0)}")

    for n in notes:
        print("Note:", n)
    for e in errors:
        print("ERROR:", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
