"""
Optional helper for users who want to enumerate which service names their
own account has access to on the public API.

Probes `<prefix>.<verb>` permutations with the cached auth header from
.env. A name is considered to *exist* when the backend returns anything
other than its "service not exists" marker. No payloads are mutated; the
script only POSTs empty params and reads the response.
"""
from __future__ import annotations

import concurrent.futures
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ksfit import KSFitClient

c = KSFitClient()
c.login()
auth = {"xjid": c.xjid, "token": c.token}

# --- Prefix list --------------------------------------------------------------
# Each row groups PhalApi class-name variants the framework might expose.
# We probe every prefix in both snake_case and camelCase where applicable.
PREFIXES: list[str] = [
    # auth / account
    "user", "account", "phone_login", "phoneLogin", "email", "oauth",
    "wechat", "weibo", "xiaomi", "vivo", "huawei", "google", "apple",
    "xiaodu", "qrcode", "sms", "register", "login", "logout", "session",
    # device
    "device", "devices", "bind", "firmware", "fota", "ota", "wifi",
    "blue", "bluetooth", "ble", "wxiot", "miio",
    # sport / activity
    "sport", "sport_record", "sportRecord", "sportrecord",
    "record", "records", "session", "exercise", "workout", "training",
    "activity", "step", "steps", "walk", "walking", "run", "running",
    "treadmill", "rowing", "spinning", "cycling", "bike", "dumbbell",
    "weight", "body", "bodyfat", "scale", "kcal", "calorie",
    # targets / goals / plans / courses
    "target", "target_sport", "targetSport", "goal", "tag", "tags",
    "level", "plan", "training_plan", "trainingPlan", "course", "courses",
    "program", "schedule", "lesson", "video", "music",
    # health
    "heart", "heart_rate", "heartRate", "hr", "spo2", "sleep", "blood",
    # statistics / history
    "stat", "stats", "statistics", "history", "summary", "total",
    "ranking", "leaderboard", "rank", "medal", "achievement", "badge",
    "annual", "annualReport",
    # social / family
    "family", "friend", "friends", "share", "team", "group", "follow",
    "comment", "message", "msg", "notice", "notify", "push",
    # personal data / settings
    "personal", "profile", "info", "setting", "settings", "preference",
    "feedback", "survey", "questionnaire", "checkin", "check_in",
    "point", "points", "credit", "reward", "gift", "level", "vip",
    # commerce
    "product", "products", "shop", "cart", "order", "address", "pay",
    "payment", "alipay", "after_sale", "afterSale",
    # marketing
    "ad", "ads", "advertis", "advertise", "advertisement", "banner",
    "campaign", "promotion", "coupon",
    # platform / misc
    "version", "config", "common", "app", "system", "country", "lang",
    "ai", "openai", "translate", "search", "explore", "home", "main",
    "dashboard", "tab",
]

# --- Verb list ----------------------------------------------------------------
VERBS: list[str] = [
    # readers
    "getList", "getlist", "list", "get", "getInfo", "getinfo", "info",
    "detail", "getDetail", "getdetail", "show", "view", "fetch",
    "query", "find", "index", "main", "simple", "simpleList",
    # historical readers
    "history", "recent", "today", "yesterday",
    "byDay", "byWeek", "byMonth", "byYear",
    "daily", "weekly", "monthly", "yearly",
    "getByDay", "getByMonth", "getByYear", "dataByDay", "dataByMonth",
    # aggregates
    "total", "summary", "stat", "stats", "statistics", "count",
    "rank", "ranking",
    # mutating (probe-safe: backend rejects on missing params anyway)
    "add", "create", "edit", "update", "delete", "remove", "clear",
    "upload", "sync", "report", "submit", "save",
    # lifecycle
    "start", "stop", "end", "finish", "complete", "pause", "resume",
    "cancel", "confirm",
    # specific patterns
    "bind", "unbind", "rebind", "isBind", "getToken", "getName",
    "share", "shareList", "shareDetail",
    "checkUpdate", "check", "verify",
    # record-shape
    "getRecord", "getRecords", "recordList", "getAllRecord", "getAll",
    "getPointList", "pointList", "uploadPoint",
    "getWeight", "addWeight", "getWeightChart",
    "getHr", "addHr", "uploadHr",
    "getTarget", "getCurrent", "getCurrentPlan",
]

# Curated "high-signal" combinations worth probing explicitly —
# probe these explicitly so a verb miss doesn't lose them.
EXPLICIT: list[str] = [
    # sport_record
    "sport_record.uploadRecord", "sport_record.getRecord", "sport_record.getList",
    "sport_record.getAll", "sport_record.delete", "sport_record.getDetail",
    "sport_record.getPointList", "sport_record.uploadPointList",
    "sport_record.shareList", "sport_record.shareDetail",
    "sport_record.uploadTreadmillRecord", "sport_record.uploadBleRecord",
    "sport_record.uploadScale", "sport_record.assignRecord",
    "sport_record.wxiotUpload",
    "sport.getList", "sport.getRecord", "sport.upload", "sport.detail",
    "record.getList", "record.getRecord", "record.detail",
    # target_sport
    "target_sport.getList", "target_sport.getDetail",
    "target_sport.getListByDevice", "target_sport.getRunDetail",
    "target.getList", "target.getDetail",
    # device
    "device.getList", "device.bind", "device.unbind", "device.isBind",
    "device.getDeviceList", "device.getToken", "device.getName",
    "device.getBox", "device.uploadWifi", "device.getSaleArea",
    "device.getDid", "device.bindDid", "device.unbindDid",
    # heart_rate
    "heart_rate.add", "heart_rate.getStats", "heart_rate.upload",
    "hr.add", "hr.report", "hr.getStats", "hr.upload",
    # plan
    "plan.getCurrent", "plan.getList", "plan.signup", "plan.join",
    "plan.uploadStart", "plan.uploadEnd", "plan.getByDay",
    "plan.getByRange", "plan.aiGenerate", "plan.recommend",
    "training_plan.getCurrent", "training_plan.getList",
    # course
    "course.getList", "course.getDetail", "course.add", "course.delete",
    "course.start", "course.finish", "course.favorite", "course.unfavorite",
    "course.evaluate", "course.search", "course.recommend",
    "course.getRecent", "course.getActionList", "course.getMusic",
    "course.exploreBanner", "course.exploreBannerViewed",
    "course.getRanking", "course.report", "course.track",
    # personal / weight / tags
    "personal.getWeight", "personal.addWeight", "personal.deleteWeight",
    "personal.getWeightChart", "personal.getTags", "personal.setTags",
    "personal.getPoints", "personal.getCheckin", "personal.getGift",
    "personal.getAnnualReport", "personal.feedback", "personal.editProfile",
    "personal.uploadAvatar",
    # family
    "family.create", "family.getList", "family.getDetail",
    "family.invite", "family.join", "family.leave", "family.getMembers",
    "family.getDevices", "family.getDaily", "family.getBadges",
    # firmware
    "firmware.getLatest", "firmware.confirm", "firmware.getInfo",
    "firmware.getBle", "firmware.getMcu", "firmware.upgrade",
    # dumbbell / bike
    "dumbbell.getList", "dumbbell.getDetail", "dumbbell.start",
    "dumbbell.upload", "dumbbell.getRecord",
    "bike.getList", "bike.start", "bike.finish", "bike.checkin",
    # ai
    "ai.getCount", "ai.getQuota", "ai.generatePlan", "ai.advise",
    "ai.translate", "openai.translate",
    # advertis / notice / banner
    "advertis.AdvertisList", "advertis.getList", "notice.getList",
    "banner.getList", "ad.getList",
    # product (we already have getList/search; probe more)
    "product.getList", "product.search", "product.connect",
    "product.guidelist", "product.productGuideList", "product.getDetail",
    "product.getCategory",
    # ranking
    "ranking.getList", "ranking.weekly", "ranking.monthly",
    # message / activity
    "message.getList", "message.read", "message.delete",
    "activity.getList", "activity.detail",
    # auth alternates
    "user.login", "user.register", "user.info", "user.getUserInfo",
    "user.editProfile", "user.editionFeedback", "user.uploadAvatar",
    "user.logout", "user.bindPhone", "user.bindEmail",
    "user.resetPassword", "user.changePassword",
    "phone_login.smsLogin", "email.login", "oauth.wechat",
    # version
    "version.checkUpdate", "version.checkUpdateV2",
    # misc
    "sms.get", "sms.send", "sms.verify",
    "tag.getList", "tag.set", "tag.update",
    "qrcode.scan", "qrcode.generate",
]


def is_service_missing(j: dict) -> bool:
    """True if response is the PhalApi 'service not exists' marker."""
    msg = (j.get("msg") or "")
    data = j.get("data") if isinstance(j.get("data"), dict) else {}
    code = str(data.get("code", "") if data else "")
    dmsg = (data.get("msg") or "") if data else ""
    return (
        code == "-996"
        or "service not exists" in msg.lower()
        or "service not exists" in dmsg.lower()
        or "服务不存在" in msg
        or "服务不存在" in dmsg
        or "no such service" in msg.lower()
        or "no such service" in dmsg.lower()
    )


def probe(svc: str) -> tuple[str, dict] | None:
    try:
        j = c._post(svc, **auth)
    except Exception:
        return None
    if is_service_missing(j):
        return None
    return svc, j


candidates = sorted(set(
    [f"{p}.{v}" for p in PREFIXES for v in VERBS] + EXPLICIT
))
print(f"probing {len(candidates):,} candidates against {c.base_url}")
t0 = time.time()

hits: list[tuple[str, dict]] = []
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as exe:
    for i, r in enumerate(exe.map(probe, candidates)):
        if (i + 1) % 250 == 0:
            print(f"  …{i+1}/{len(candidates)}  hits so far: {len(hits)}")
        if r:
            hits.append(r)

dt = time.time() - t0
print(f"\n{len(hits)} services exist  ({dt:.1f}s, "
      f"{len(candidates)/dt:.1f} req/s)\n")

for svc, j in sorted(hits):
    ret = j.get("ret")
    data = j.get("data") if isinstance(j.get("data"), dict) else {}
    code = data.get("code", "") if data else ""
    msg = (data.get("msg") or j.get("msg") or "")[:80]
    print(f"  {svc:42s} ret={ret} code={str(code):>5s}  {msg}")

dump = Path(__file__).resolve().parent.parent / "out" / "services.json"
dump.parent.mkdir(exist_ok=True)
dump.write_text(json.dumps(
    [{"service": s, "raw": j} for s, j in hits],
    ensure_ascii=False, indent=2,
))
print(f"\nfull responses → {dump}")
