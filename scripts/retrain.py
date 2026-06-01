"""
Retrain pipeline — collect incremental data then retrain model.
Called by watcher.ts every ~50 new oracle settlements.

Run: python3 scripts/retrain.py
"""
import subprocess, sys, os

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

print("=== FairLine Retrain Pipeline ===\n")

# Step 1: collect new data (incremental mode)
print("Step 1: Collecting new oracle data…")
r1 = subprocess.run([sys.executable, "scripts/collect_training_data.py", "--incr"],
                    capture_output=True, text=True)
print(r1.stdout)
if r1.returncode != 0:
    print("Collection error:", r1.stderr[:300])
    sys.exit(1)

# Step 2: retrain
print("Step 2: Retraining model…")
r2 = subprocess.run([sys.executable, "scripts/train_model.py"],
                    capture_output=True, text=True)
print(r2.stdout)
if r2.returncode != 0:
    print("Training error:", r2.stderr[:300])
    sys.exit(1)

print("=== Retrain complete — weights updated ===")
