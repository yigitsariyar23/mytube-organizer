#!/usr/bin/env bash
# Diff scraped channel IDs against your Takeout subscriptions CSV.
# Usage: ./check-missing.sh [scraped-ids.txt] [abonelikler.csv]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRAPED="${1:-$DIR/scraped-ids.txt}"
CSV="${2:-/Users/yigitsariyar/Downloads/Takeout/YouTube ve YouTube Music/abonelikler/abonelikler.csv}"

grep -oE 'UC[0-9A-Za-z_-]{22}' "$CSV" | sort -u > /tmp/_csv_ids.txt
grep -oE 'UC[0-9A-Za-z_-]{22}' "$SCRAPED" | sort -u > /tmp/_scraped_ids.txt

echo "CSV subscriptions : $(wc -l < /tmp/_csv_ids.txt | tr -d ' ')"
echo "Scraped channels  : $(wc -l < /tmp/_scraped_ids.txt | tr -d ' ')"
echo

echo "=== In CSV but NOT scraped (missing from the app) ==="
comm -23 /tmp/_csv_ids.txt /tmp/_scraped_ids.txt > /tmp/_missing.txt
if [ -s /tmp/_missing.txt ]; then
  # Show id + channel title from the CSV for context
  while read -r id; do
    title=$(grep -m1 "$id" "$CSV" | awk -F, '{print $NF}')
    echo "  $id  $title"
  done < /tmp/_missing.txt
else
  echo "  (none)"
fi
echo

echo "=== Scraped but NOT in CSV (extra / stale) ==="
comm -13 /tmp/_csv_ids.txt /tmp/_scraped_ids.txt || echo "  (none)"
