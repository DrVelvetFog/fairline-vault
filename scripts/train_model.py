"""
Train a logistic regression to predict BTC settlement direction.

Features: realized_vol, trend_pct, momentum_pct, range_pct, basis_bps,
          hour_utc, day_of_week, mins_to_expiry, vol_regime (encoded)
Label:    label_up (1 = BTC settled above ATM strike)

Exports model weights to scripts/model_weights.json for TypeScript inference.

Run: python3 scripts/train_model.py
"""

import json, csv, math
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.pipeline import Pipeline

DATA_PATH   = "scripts/training_data.csv"
WEIGHTS_OUT = "scripts/model_weights.json"

# ── Load data ─────────────────────────────────────────────────────────────────

df = pd.read_csv(DATA_PATH)
print(f"Loaded {len(df)} examples")
print(f"Label distribution: UP={df['label_up'].sum()} DOWN={len(df)-df['label_up'].sum()}")

# ── Feature engineering ───────────────────────────────────────────────────────

# Encode vol_regime as ordinal
vol_map = {"low": 0, "medium": 1, "high": 2}
df["vol_regime_enc"] = df["vol_regime"].map(vol_map)

# Hour of day as sin/cos (cyclical encoding — hour 23 is close to hour 0)
df["hour_sin"] = np.sin(2 * np.pi * df["hour_utc"] / 24)
df["hour_cos"] = np.cos(2 * np.pi * df["hour_utc"] / 24)

# Day of week sin/cos
df["dow_sin"] = np.sin(2 * np.pi * df["day_of_week"] / 7)
df["dow_cos"] = np.cos(2 * np.pi * df["day_of_week"] / 7)

# Interaction: trend × vol (strong trend + low vol = more predictive)
df["trend_x_vol"] = df["trend_pct"] * (1 / (df["realized_vol"] + 0.1))

FEATURES = [
    "realized_vol",
    "trend_pct",
    "momentum_pct",
    "range_pct",
    "basis_bps",
    "mins_to_expiry",
    "vol_regime_enc",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "trend_x_vol",
]

X = df[FEATURES].values
y = df["label_up"].values

print(f"\nFeatures: {FEATURES}")

# ── Cross-validation ──────────────────────────────────────────────────────────

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

print("\n── Logistic Regression (5-fold CV) ──")
lr_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("clf",    LogisticRegression(C=1.0, max_iter=1000, random_state=42)),
])
lr_scores = cross_val_score(lr_pipeline, X, y, cv=cv, scoring="accuracy")
print(f"  Accuracy: {lr_scores.mean():.4f} ± {lr_scores.std():.4f}")
print(f"  Per-fold: {[f'{s:.3f}' for s in lr_scores]}")

print("\n── Gradient Boosting (5-fold CV) ──")
gb_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("clf",    GradientBoostingClassifier(
        n_estimators=100, max_depth=3, learning_rate=0.1,
        subsample=0.8, random_state=42,
    )),
])
gb_scores = cross_val_score(gb_pipeline, X, y, cv=cv, scoring="accuracy")
print(f"  Accuracy: {gb_scores.mean():.4f} ± {gb_scores.std():.4f}")
print(f"  Per-fold: {[f'{s:.3f}' for s in gb_scores]}")

# ── Train final LR model on all data ─────────────────────────────────────────

print("\n── Training final Logistic Regression on full dataset ──")
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
clf = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
clf.fit(X_scaled, y)

# In-sample accuracy (for reference — CV accuracy is the real number)
preds = clf.predict(X_scaled)
in_sample_acc = (preds == y).mean()
print(f"  In-sample accuracy: {in_sample_acc:.4f}")
print(f"  CV accuracy (true): {lr_scores.mean():.4f}")
print(f"\nClassification report (in-sample):")
print(classification_report(y, preds, target_names=["DOWN", "UP"]))

# ── Feature importance (LR coefficients) ─────────────────────────────────────

print("── Feature coefficients ──")
coef_pairs = sorted(zip(FEATURES, clf.coef_[0]), key=lambda x: abs(x[1]), reverse=True)
for feat, coef in coef_pairs:
    bar = "+" * int(abs(coef) * 20) if coef > 0 else "-" * int(abs(coef) * 20)
    print(f"  {feat:<20} {coef:+.4f}  {bar}")

# ── Export weights for TypeScript inference ───────────────────────────────────

weights = {
    "model_type":   "logistic_regression",
    "features":     FEATURES,
    "cv_accuracy":  round(float(lr_scores.mean()), 6),
    "cv_std":       round(float(lr_scores.std()), 6),
    "scaler_mean":  scaler.mean_.tolist(),
    "scaler_scale": scaler.scale_.tolist(),
    "coef":         clf.coef_[0].tolist(),
    "intercept":    float(clf.intercept_[0]),
    "trained_on":   len(df),
    "label":        "1=UP (settle > ATM strike), 0=DOWN",
}

with open(WEIGHTS_OUT, "w") as f:
    json.dump(weights, f, indent=2)

# Write model stats for dashboard
from datetime import datetime, timezone
stats = {
    "cv_accuracy":    round(float(lr_scores.mean()), 6),
    "cv_std":         round(float(lr_scores.std()), 6),
    "gb_cv_accuracy": round(float(gb_scores.mean()), 6),
    "trained_on":     len(df),
    "features":       FEATURES,
    "top_features":   [(f, round(c, 4)) for f, c in coef_pairs[:5]],
    "trained_at":     datetime.now(timezone.utc).isoformat(),
    "edge_over_random_pp": round((lr_scores.mean() - 0.5) * 100, 2),
}
with open("scripts/model_stats.json", "w") as f:
    json.dump(stats, f, indent=2)

print(f"\n✅ Weights exported → {WEIGHTS_OUT}")
print(f"   CV accuracy: {lr_scores.mean():.4f} ({lr_scores.mean()*100:.1f}%)")
print(f"   Random baseline: 50.0%")
print(f"   Edge over random: {(lr_scores.mean() - 0.5)*100:+.1f}pp")
print(f"   Stats → scripts/model_stats.json")
