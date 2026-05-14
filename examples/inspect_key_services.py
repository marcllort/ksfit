"""
Hit each high-value confirmed endpoint with a useful param shape and
dump the response so we can map the schema before wiring typed methods.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ksfit import KSFitClient

c = KSFitClient()
c.login()

today = dt.date.today()
month_ago = today - dt.timedelta(days=30)
year_ago = today - dt.timedelta(days=365)

CALLS: list[tuple[str, dict]] = [
    # core history
    ("record.GetAllRecords", {}),
    ("record.GetAllRecords", {"timestamp": 0}),
    ("record.getShareRecord", {}),
    ("user.weightLog", {}),
    # device list
    ("box.deviceList", {}),
    # schedule / fitness goals = daily step history
    ("schedule.listMy", {}),
    ("schedule.listFitnessGoalByDay", {"date": today.isoformat()}),
    ("schedule.listFitnessGoalByDateRange",
     {"start_date": month_ago.isoformat(), "end_date": today.isoformat()}),
    # courses
    ("lesson.collectlist", {}),
    ("lesson.programList", {}),
    ("lesson.personal", {}),
    ("lesson.rankinglist", {}),
    ("lesson.getPackList", {}),
    # extras
    ("user.userbind", {}),
    ("user.disablefacebook", {}),
    ("user.getGuide", {}),
    ("user.getProgram", {}),
    ("notice.hint", {}),
    ("course.exploreBanner", {}),
    ("event.getlist", {}),
]

out: dict[str, dict] = {}
for svc, params in CALLS:
    key = svc + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")
    try:
        out[key] = c.call(svc, **params)
        info = out[key].get("info") if isinstance(out[key], dict) else None
        if isinstance(info, list):
            shape = f"list[{len(info)}]"
            if info:
                shape += " first: " + ",".join(list(info[0].keys())[:8]) if isinstance(info[0], dict) else " first: " + str(info[0])[:60]
        elif isinstance(info, dict):
            shape = "obj{" + ",".join(list(info.keys())[:10]) + "}"
        elif info is not None:
            shape = str(info)[:80]
        else:
            shape = str(out[key])[:120]
        print(f"  {key:60s}  {shape}")
    except Exception as e:
        print(f"  {key:60s}  ERROR {e}")
        out[key] = {"_error": str(e)}

dump = Path(__file__).resolve().parent.parent / "out" / "key_services.json"
dump.write_text(json.dumps(out, ensure_ascii=False, indent=2, default=str))
print(f"\nfull responses → {dump}")
