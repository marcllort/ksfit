"""Pull every read-only endpoint for the logged-in user and dump JSON."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ksfit import KSFitClient, KSFitError

c = KSFitClient()
c.login()

CALLS = [
    # profile
    ("user_info",         c.user_info),
    ("linked_accounts",   c.linked_accounts),
    ("guide",             c.guide),
    ("weight_log",        c.weight_log),
    # devices
    ("devices",           c.devices),
    # sport history
    ("sport_records",     c.sport_records),
    ("shared_records",    c.shared_records),
    # training plans
    ("schedules",         c.schedules),
    # catalogs
    ("tags",              c.tags),
    ("tags_short",        c.tags_short),
    ("tags_for_user",     c.tags_for_user),
    ("targets",           c.targets),
    # courses
    ("course_programs",   c.course_programs),
    ("course_collections", c.course_collections),
    ("course_history",    c.course_history),
    ("course_packs",      c.course_packs),
    ("course_ranking",    c.course_ranking),
    ("course_banner",     c.course_banner),
    # social / system
    ("groups",            c.groups),
    ("notices",           c.notices),
    ("notice_hint",       c.notice_hint),
    ("events",            c.events),
    ("ranking_types",     c.ranking_types),
]

out: dict = {}
for name, fn in CALLS:
    try:
        out[name] = fn()
        info = out[name]
        if isinstance(info, list):
            shape = f"list[{len(info)}]"
        elif isinstance(info, dict):
            sub = next((f"{k}=list[{len(v)}]" for k, v in info.items() if isinstance(v, list)), None)
            shape = f"obj{{{','.join(list(info.keys())[:6])}}}" + (f"  {sub}" if sub else "")
        else:
            shape = repr(info)[:60]
        print(f"  {name:22s}  {shape}")
    except KSFitError as e:
        out[name] = {"_error": str(e), "raw": e.raw}
        print(f"  {name:22s}  ERROR  {e}")

dump = Path(__file__).resolve().parent.parent / "out" / "dump.json"
dump.parent.mkdir(exist_ok=True)
dump.write_text(json.dumps(out, ensure_ascii=False, indent=2, default=str))
print(f"\n→ {dump}")
