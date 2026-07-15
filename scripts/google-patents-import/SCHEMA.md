# Extraction Schema Contract — Google Patents → Staging

Extract in **exactly this format**. The loader (`download-and-load.sh`) does a positional
`\copy`, so **column order and count are load-bearing** — a reordered or extra column
corrupts the import silently.

## File format

- **Format:** CSV, **gzip**-compressed, **no header row**, comma-delimited (`,`)
- **Quoting:** RFC-4180 (BigQuery `EXPORT DATA` does this automatically) — required because
  text fields contain commas
- **Encoding:** UTF-8
- **Sharding:** `part-*.csv.gz` (BigQuery emits `part-000000000000.csv.gz`, …)
- **Path on GCS / staging disk:** `.../spotipr-patents/publications/part-*.csv.gz`

## The 14 columns (exact order)

| # | Column | Type | Source field | Formatting rule | → Postgres |
|---|---|---|---|---|---|
| 1 | `publication_number` | STRING | `patents.publications.publication_number` | e.g. `US-11123456-B2` | `publicationNumber` |
| 2 | `pub_canonical` | STRING | derived | UPPER, strip non-alphanumerics, strip trailing kind code | (join/dedup key) |
| 3 | `title` | STRING | `research.publications.title` | English; collapse whitespace to single spaces | `title` (≤1000 chars) |
| 4 | `abstract` | STRING | `research.publications.abstract` | English (MT where needed); collapse whitespace | `abstract` |
| 5 | `url` | STRING | `research.publications.url` | as-is | (carried, not stored) |
| 6 | `cpc` | STRING | `patents.publications.cpc[].code` | **`\|`-joined**, distinct | `classifications[]` |
| 7 | `top_terms` | STRING | `research.publications.top_terms` | **`\|`-joined** | `ragText` |
| 8 | `country_code` | STRING | `patents.publications.country_code` | e.g. `US`, `IN`, `CN` | `country` (+ IN dual-tag) |
| 9 | `publication_date` | STRING | `patents.publications.publication_date` | **`YYYYMMDD`** (as-is INT64→string) | `publicationDate` |
| 10 | `filing_date` | STRING | `patents.publications.filing_date` | **`YYYYMMDD`** | `filingDate` |
| 11 | `kind_code` | STRING | `patents.publications.kind_code` | e.g. `B2`, `A1` | `kind` |
| 12 | `family_id` | STRING | `patents.publications.family_id` | DOCDB family id | `familyId` |
| 13 | `first_claim` | STRING | `patents.publications.claims_localized` (en) | full English claims blob; collapse whitespace. **US-only → empty elsewhere** | `claimsText` |
| 14 | `description_snippet` | STRING | `patents.publications.description_localized` (en) | first 5000 chars, English; collapse whitespace. **US-only → empty elsewhere** | `descriptionText` |

### Rules that matter

1. **Order is positional** — do not reorder, add, or drop columns. To drop `description_snippet`
   (saves BigQuery scan cost + Postgres disk), keep the column but export it empty, OR remove it
   from BOTH this export and the staging DDL in `download-and-load.sh` / `04-upsert.sql`.
2. **Collapse newlines to spaces** in every text field (title/abstract/claims/description) so no
   CSV field spans multiple lines. The staging SQL does this with `REGEXP_REPLACE(x, r'\s+', ' ')`.
3. **Arrays are `|`-joined** (cpc, top_terms) — never exported as repeated fields (CSV can't hold them).
4. **Dates stay `YYYYMMDD` strings** — the loader converts to `date` (`to_date(x,'YYYYMMDD')`).
5. **Claims/description are US-only** in the public dataset — columns 13/14 are empty for IN, CN, etc.
   Indian claims/descriptions keep coming from the IPIndia PDF pipeline.
6. **English extraction** uses `language='en'`, NOT `[SAFE_OFFSET(0)]` (which grabs whichever
   language is first and returns the full-claims blob, not one claim).

## The exact BigQuery that produces it

`01-bigquery-staging.sql` builds the staging table (in your BQ project) and `03-bigquery-export-to-gcs.sql`
exports it as the 14-column gzip CSV. Run `01` year-by-year with `--maximum_bytes_billed` — column 14
(`description_localized`) is the dataset's largest scan cost regardless of the `LEFT(...,5000)`.

## Verify a sample before the full run

```bash
# Export one week, then eyeball a shard:
gcloud storage cat gs://<bucket>/spotipr-patents/publications/part-000000000000.csv.gz | gunzip | head -3
# Expect 14 comma-separated, RFC-4180-quoted fields per line, no header.
```
