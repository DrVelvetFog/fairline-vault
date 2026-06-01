"""
Collect training data from settled DeepBook Predict oracles.

Modes:
  python3 scripts/collect_training_data.py          # fetch all available oracles
  python3 scripts/collect_training_data.py --incr   # only fetch oracles newer than CSV

For each settled oracle:
  - Fetch price history (100 most recent events)
  - Compute features at entry (earliest available prices)
  - Compute label: did BTC settle ABOVE or BELOW entry price?
  - Append to CSV for model training

Outputs: scripts/training_data.csv
"""

import json, math, urllib.request, csv, sys, os
from datetime import datetime, timezone

INDEXER  = "https://predict-server.testnet.mystenlabs.com"
OUT_PATH = "scripts/training_data.csv"
INCREMENTAL = "--incr" in sys.argv

def get(path):
    url = f"{INDEXER}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def log_returns(spots):
    """Compute log returns from a list of spot prices."""
    rets = []
    for i in range(1, len(spots)):
        if spots[i-1] > 0 and spots[i] > 0:
            rets.append(math.log(spots[i] / spots[i-1]))
    return rets

def compute_features(prices_raw, oracle):
    """
    Compute features from price history.
    prices_raw: list of price events (newest first from API)
    Returns dict of features, or None if insufficient data.
    """
    if len(prices_raw) < 10:
        return None

    # Sort chronologically (oldest first)
    prices = sorted(prices_raw, key=lambda p: p["checkpoint_timestamp_ms"])

    spots   = [p["spot"] / 1e9 for p in prices]
    fwds    = [p["forward"] / 1e9 for p in prices]
    times   = [p["checkpoint_timestamp_ms"] for p in prices]

    # Entry state: first 20 prices (earliest in oracle's life we can see)
    window = spots[:20]
    entry_spot   = window[0]
    entry_fwd    = fwds[0]
    window_ts    = times[:20]

    # Realized volatility (annualized) from entry window
    rets = log_returns(window)
    if len(rets) < 3:
        return None
    std_per_period   = math.sqrt(sum((r - sum(rets)/len(rets))**2 for r in rets) / len(rets))
    periods_per_year = 2 * 60 * 24 * 365    # ~2 updates/min
    realized_vol     = std_per_period * math.sqrt(periods_per_year) * 100

    # Price trend (% change across entry window)
    trend_pct = (window[-1] - window[0]) / window[0] * 100 if window[0] > 0 else 0.0

    # Momentum: compare first half vs second half of window
    mid = len(window) // 2
    first_half_mean  = sum(window[:mid]) / mid if mid > 0 else window[0]
    second_half_mean = sum(window[mid:]) / (len(window) - mid) if (len(window) - mid) > 0 else window[-1]
    momentum_pct = (second_half_mean - first_half_mean) / first_half_mean * 100 if first_half_mean > 0 else 0.0

    # Price range (high-low / mid)
    high = max(window); low = min(window); mid_price = (high + low) / 2
    range_pct = (high - low) / mid_price * 100 if mid_price > 0 else 0.0

    # Basis: (forward - spot) / spot in bps
    basis_bps = (entry_fwd - entry_spot) / entry_spot * 10_000 if entry_spot > 0 else 0.0

    # Time features
    expiry_dt   = datetime.fromtimestamp(oracle["expiry"] / 1000, tz=timezone.utc)
    entry_dt    = datetime.fromtimestamp(window_ts[0] / 1000, tz=timezone.utc)
    hour_utc    = entry_dt.hour
    day_of_week = entry_dt.weekday()   # 0=Mon, 6=Sun

    # Time to expiry at entry (minutes)
    mins_to_expiry = (oracle["expiry"] - window_ts[0]) / 60_000

    # Strike context: entry spot relative to min_strike
    min_strike_usd = oracle["min_strike"] / 1e9
    spot_above_min = (entry_spot - min_strike_usd) / min_strike_usd * 100 if min_strike_usd > 0 else 0.0

    # Vol regime bucket
    vol_regime = "low" if realized_vol < 5 else "medium" if realized_vol < 12 else "high"

    # ATM strike (nearest dollar)
    atm_strike = round(entry_spot)

    # Settlement price
    settle = oracle["settlement_price"] / 1e9

    return {
        # Identity
        "oracle_id":          oracle["oracle_id"],
        "expiry":             oracle["expiry"],
        "expiry_dt":          expiry_dt.isoformat(),

        # Features
        "entry_spot":         round(entry_spot, 4),
        "realized_vol":       round(realized_vol, 4),
        "trend_pct":          round(trend_pct, 6),
        "momentum_pct":       round(momentum_pct, 6),
        "range_pct":          round(range_pct, 4),
        "basis_bps":          round(basis_bps, 2),
        "mins_to_expiry":     round(mins_to_expiry, 2),
        "hour_utc":           hour_utc,
        "day_of_week":        day_of_week,
        "vol_regime":         vol_regime,
        "spot_above_min_pct": round(spot_above_min, 4),
        "n_prices":           len(prices),

        # Targets
        "settlement_price":   round(settle, 4),
        "atm_strike":         atm_strike,
        "label_up":           1 if settle > atm_strike else 0,   # 1=UP wins, 0=DOWN wins
        "move_pct":           round((settle - entry_spot) / entry_spot * 100, 6),
    }

def load_existing_oracle_ids():
    """Return set of oracle IDs already in the CSV."""
    if not os.path.exists(OUT_PATH):
        return set()
    with open(OUT_PATH, newline="") as f:
        reader = csv.DictReader(f)
        return {row["oracle_id"] for row in reader}

def main():
    existing_ids = load_existing_oracle_ids()
    mode = "incremental" if INCREMENTAL else "full"
    print(f"Mode: {mode} | Existing rows: {len(existing_ids)}")

    print("Fetching settled oracles…")
    all_oracles = get("/oracles?status=settled")
    with_price  = [o for o in all_oracles if o.get("settlement_price") is not None]

    if INCREMENTAL and existing_ids:
        oracles = [o for o in with_price if o["oracle_id"] not in existing_ids]
        print(f"New oracles since last run: {len(oracles)}")
    else:
        oracles = sorted(with_price, key=lambda o: o["expiry"])  # all, oldest first
        print(f"Total oracles with settlement price: {len(oracles)}")

    if not oracles:
        print("No new oracles to process.")
        return 0

    rows = []
    errors = 0
    for i, oracle in enumerate(oracles):
        try:
            prices = get(f"/oracles/{oracle['oracle_id']}/prices")
            feats  = compute_features(prices, oracle)
            if feats:
                rows.append(feats)
        except Exception as e:
            errors += 1
            if errors < 5:
                print(f"  Error oracle {oracle['oracle_id'][:12]}: {e}")
        sys.stdout.write(f"\r  Processed {i+1}/{len(oracles)} ({len(rows)} valid, {errors} errors)")
        sys.stdout.flush()

    print(f"\n\nNew examples collected: {len(rows)}")

    if not rows:
        print("Nothing new to write.")
        return 0

    # Append to CSV (or create with header if new)
    file_exists = os.path.exists(OUT_PATH)
    fieldnames  = list(rows[0].keys())
    with open(OUT_PATH, "a" if (INCREMENTAL and file_exists) else "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not (INCREMENTAL and file_exists):
            writer.writeheader()
        writer.writerows(rows)

    # Count total rows in CSV
    with open(OUT_PATH, newline="") as f:
        total_rows = sum(1 for _ in csv.reader(f)) - 1  # subtract header

    print(f"Saved → {OUT_PATH}  (total rows: {total_rows})")

    # Quick label stats for new rows
    up_count   = sum(r["label_up"] for r in rows)
    down_count = len(rows) - up_count
    print(f"\nNew label distribution:")
    print(f"  UP   (settle > ATM): {up_count}  ({up_count/len(rows)*100:.1f}%)")
    print(f"  DOWN (settle ≤ ATM): {down_count}  ({down_count/len(rows)*100:.1f}%)")
    return len(rows)

if __name__ == "__main__":
    result = main()
    sys.exit(0 if result is not None else 1)
