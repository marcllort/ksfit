"""Login and dump the user profile."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ksfit import KSFitClient

c = KSFitClient()
info = c.login(force=True)
print(json.dumps(info, ensure_ascii=False, indent=2))
print(f"\n→ xjid:  {c.xjid}")
print(f"→ token: {c.token[:60]}…")
