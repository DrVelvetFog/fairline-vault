"""
Train a logistic regression to forecast a LARGE BTC settlement move — the event
that threatens the house. Reframed from direction (which the spread beats) to
P(|move| > threshold), which is what the defensive risk gate actually needs.

Features: realized_vol, trend_pct, momentum_pct, range_pct, basis_bps,
          hour_utc, day_of_week, mins_to_expiry, vol_regime (encoded)
Label:    label_big (1 = |settlement move| > LARGE_MOVE_THRESHOLD_PCT)

Exports model weights to scripts/model_weights.json for TypeScript inference
(same logistic structure — the inference outputs P(large move)).

Run: python3 scripts/train_model.py
"""

import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report
from sklearn.pipeline import Pipeline

DATA_PATH   = "scripts/training_data.csv"
WEIGHTS_OUT = "scripts/model_weights.json"
LARGE_MOVE_THRESHOLD_PCT = 0.10   # |settlement move| above this = "large move" (~p90 of the data)

# ── Load + label ──────────────────────────────────────────────────────────────

df = pd.read_csv(DATA_PATH)
print(f"Loaded {len(df)} examples")
df["label_big"] = (df["move_pct"].abs() > LARGE_MOVE_THRESHOLD_PCT).astype(int)
base_rate = df["label_big"].mean()
print(f"Label: P(|move| > {LARGE_MOVE_THRESHOLD_PCT}%) — large-move base rate "
      f"{base_rate*100:.1f}% ({int(df['label_big'].sum())} of {len(df)})")

# ── Feature engineering ───────────────────────────────────────────────────────

vol_map = {"low": 0, "medium": 1, "high": 2}
df["vol_regime_enc"] = df["vol_regime"].map(vol_map)
df["hour_sin"] = np.sin(2 * np.pi * df["hour_utc"] / 24)
df["hour_cos"] = np.cos(2 * np.pi * df["hour_utc"] / 24)
df["dow_sin"]  = np.sin(2 * np.pi * df["day_of_week"] / 7)
df["dow_cos"]  = np.cos(2 * np.pi * df["day_of_week"] / 7)
df["trend_x_vol"] = df["trend_pct"] * (1 / (df["realized_vol"] + 0.1))

FEATURES = [
    "realized_vol", "trend_pct", "momentum_pct", "range_pct", "basis_bps",
    "mins_to_expiry", "vol_regime_enc", "hour_sin", "hour_cos",
    "dow_sin", "dow_cos", "trend_x_vol",
]

X = df[FEATURES].values
y = df["label_big"].values
print(f"\nFeatures: {FEATURES}")

# ── Cross-validation (AUC is the real metric for an imbalanced target) ─────────

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

print("\n── Logistic Regression (5-fold CV, class-balanced) ──")
lr_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("clf",    LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced", random_state=42)),
])
lr_auc = cross_val_score(lr_pipeline, X, y, cv=cv, scoring="roc_auc")
lr_acc = cross_val_score(lr_pipeline, X, y, cv=cv, scoring="balanced_accuracy")
print(f"  ROC-AUC:            {lr_auc.mean():.4f} ± {lr_auc.std():.4f}  (0.5 = random)")
print(f"  Balanced accuracy:  {lr_acc.mean():.4f}")

print("\n── Gradient Boosting (5-fold CV) ──")
gb_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("clf",    GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.1,
                                          subsample=0.8, random_state=42)),
])
gb_auc = cross_val_score(gb_pipeline, X, y, cv=cv, scoring="roc_auc")
print(f"  ROC-AUC: {gb_auc.mean():.4f}")

# ── Train final LR on all data ────────────────────────────────────────────────

print("\n── Training final Logistic Regression on full dataset ──")
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
clf = LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced", random_state=42)
clf.fit(X_scaled, y)
print(classification_report(y, clf.predict(X_scaled), target_names=["small", "LARGE"]))

print("── Feature coefficients (what predicts a large move) ──")
coef_pairs = sorted(zip(FEATURES, clf.coef_[0]), key=lambda x: abs(x[1]), reverse=True)
for feat, coef in coef_pairs:
    bar = ("+" if coef > 0 else "-") * int(abs(coef) * 20)
    print(f"  {feat:<20} {coef:+.4f}  {bar}")

# ── Export ────────────────────────────────────────────────────────────────────

weights = {
    "model_type":   "logistic_regression",
    "objective":    "large_move",
    "threshold_pct": LARGE_MOVE_THRESHOLD_PCT,
    "base_rate":    round(float(base_rate), 6),
    "features":     FEATURES,
    "cv_auc":       round(float(lr_auc.mean()), 6),
    "cv_accuracy":  round(float(lr_acc.mean()), 6),
    "scaler_mean":  scaler.mean_.tolist(),
    "scaler_scale": scaler.scale_.tolist(),
    "coef":         clf.coef_[0].tolist(),
    "intercept":    float(clf.intercept_[0]),
    "trained_on":   len(df),
    "label":        f"1 = |settlement move| > {LARGE_MOVE_THRESHOLD_PCT}% (large move that threatens the house)",
}
with open(WEIGHTS_OUT, "w") as f:
    json.dump(weights, f, indent=2)

from datetime import datetime, timezone
stats = {
    "objective":      "large_move",
    "threshold_pct":  LARGE_MOVE_THRESHOLD_PCT,
    "base_rate":      round(float(base_rate), 6),
    "cv_auc":         round(float(lr_auc.mean()), 6),
    "cv_accuracy":    round(float(lr_acc.mean()), 6),
    "gb_cv_auc":      round(float(gb_auc.mean()), 6),
    "trained_on":     len(df),
    "features":       FEATURES,
    "top_features":   [(f, round(c, 4)) for f, c in coef_pairs[:5]],
    "trained_at":     datetime.now(timezone.utc).isoformat(),
    "edge_over_random_pp": round((lr_auc.mean() - 0.5) * 100, 2),
}
with open("scripts/model_stats.json", "w") as f:
    json.dump(stats, f, indent=2)

print(f"\n✅ Weights → {WEIGHTS_OUT}")
print(f"   Forecasts P(|move| > {LARGE_MOVE_THRESHOLD_PCT}%)  |  CV ROC-AUC {lr_auc.mean():.4f} (0.5 = random)")
print(f"   Stats → scripts/model_stats.json")
