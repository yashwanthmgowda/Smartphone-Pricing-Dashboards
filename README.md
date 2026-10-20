# Smartphone Price Tracker

A small, dependency-free dashboard that tracks smartphone **MOP** (minimum operating price) and **DP/RP** (retailer price) for every brand, model and memory variant, month by month.

![By brand view](docs/brand-view.png)

## What it does

- **By brand**: Brand, Model, Variant, then the latest DP/RP and MOP, then DP/RP and MOP for every month recorded.
- **By price segment**: the same table grouped by segment, with a summary card. Segments are based on each variant's latest MOP: `<10k`, `10k-15k`, `15k-20k`, `20k-25k`, `25k-30k`, `30k-40k`, `40k-60k`, `60k+`, plus `No MOP` for variants with no MOP. A range includes its lower value and stops just below its upper one (`15k-20k` is ₹15,000 to ₹19,999).
- Filter by brand or segment, search by model or variant, sort by any column, hide rows with no price.
- From the second month on, it also shows the change from the previous month for DP/RP and MOP.
- A price missing from a price list stays **blank**; it is never guessed.
- Rows that need a caution carry a note: they get an amber edge and show the note when you hover over them.
- Works in light and dark mode and on a phone.

![By price segment view](docs/segment-view.png)

## Run it

It is a static page, so there is nothing to install. Browsers block `fetch` from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Add a new month

1. Put the month's prices in a CSV (see [`templates/month_template.csv`](templates/month_template.csv)):

   | column | required | meaning |
   |---|---|---|
   | `brand`, `model`, `variant` | yes | spell them the same way every month, because rows are matched on these three |
   | `mop` | yes (may be blank) | minimum operating price |
   | `dp_rp` | yes (may be blank) | retailer price |
   | `other` | no | extra prices worth keeping, as free text, for example `NEP 26,999` |
   | `note` | no | a caution shown when you hover over the row |
   | `source` | no | where the price came from |

   Numbers may contain commas (`1,39,999`). Leave a price blank when the list does not give one.

2. Import it:

   ```bash
   python3 scripts/add_month.py 2026-11 november.csv --dry-run   # preview
   python3 scripts/add_month.py 2026-11 november.csv             # write data/prices.json
   python3 scripts/add_month.py 2026-11 november.csv --replace-month   # re-import the whole month
   ```

   The script tells you how many variants were added or updated, which variants from earlier months are missing this time (they show blank), and warns if a DP/RP is higher than its MOP.

3. Check and publish:

   ```bash
   python3 scripts/check_data.py
   git add data/prices.json && git commit -m "Add November 2026 prices" && git push
   ```

The page needs no code change: new months appear as new columns automatically.

## Data format

`data/prices.json` is a list with one row per variant per month:

```json
{"key": "Realme|Realme 16 5G|8GB+128GB", "seq": 91, "brand": "Realme", "model": "Realme 16 5G",
 "variant": "8GB+128GB", "month": "2026-10", "mop": 36999, "rp": 34905,
 "other": "", "note": "", "source": "Realme price list (Model / GB / MOP / DP)"}
```

`seq` only fixes the order of rows within a brand. `data/brand_notes.json` records how each brand's list was read (below); the page does not display it.

## How the price lists were read

Price lists name their columns differently, so these rules were applied. October 2026 is the first month recorded.

| Brand | MOP taken from | DP/RP taken from |
|---|---|---|
| Xiaomi / Redmi | SRP | none in the list (blank) |
| Motorola | RRP | none in the list (blank) |
| vivo, iQOO | MSP | DP |
| Tecno | MOP | RTLR Price |
| itel (incl. Zeno) | MOP | DP |
| Infinix | MOP | DP |
| Realme | MOP | DP |
| POCO | MOP | DP |
| Lava | MOP | RP |
| Mivi | MOP | Billing Price |
| AI+ | MOP | Retailer DP |

Where two lists disagree, the primary list is used and the row carries a note. Phones are listed; TVs, tablets and accessories are left out.

## Publish with GitHub Pages

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) checks the data and deploys the site on every push to `main`. In the repository go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.

> **Before you make the repository public:** the price lists this data comes from (retailer, distributor or billing prices) may be confidential trade information. Publish only what you are allowed to share, or keep the repository private (GitHub Pages for private repositories needs a paid plan).

## Project layout

```
index.html              the page
assets/app.js           reads data/prices.json and draws the tables
assets/styles.css       light and dark styles
data/prices.json        every price, one row per variant per month
data/brand_notes.json   how each brand's list was read
scripts/add_month.py    add a month from a CSV
scripts/check_data.py   sanity checks (also run in CI)
templates/              CSV template
docs/                   screenshots
```

## License

MIT, see [LICENSE](LICENSE). Replace `Your Name` in the license with your own.
