"""
Unofficial read-only client for the KS Fit cloud API.

Lets a user fetch their own account data (sessions, weight log, telemetry,
devices, plans, courses) over the public HTTPS API. Authentication uses the
account's own email + password. The client never writes, mutates, or deletes
anything server-side.

Not affiliated with or endorsed by Kingsmith / KS Fit.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv, set_key

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH)


class KSFitError(RuntimeError):
    def __init__(self, ret: int, code: str | None, message: str, raw: dict):
        super().__init__(f"ret={ret} code={code} msg={message}")
        self.ret = ret
        self.code = code
        self.message = message
        self.raw = raw


@dataclass
class KSFitClient:
    email: str = field(default_factory=lambda: os.getenv("KSFIT_EMAIL", ""))
    password: str = field(default_factory=lambda: os.getenv("KSFIT_PASSWORD", ""))
    base_url: str = field(default_factory=lambda: os.getenv(
        "KSFIT_BASE_URL", "https://eu.api.ks.fit/V0.1/index.php"))
    xjid: str = field(default_factory=lambda: os.getenv("KSFIT_XJID", ""))
    token: str = field(default_factory=lambda: os.getenv("KSFIT_TOKEN", ""))
    refresh_token: str = field(default_factory=lambda: os.getenv(
        "KSFIT_REFRESH_TOKEN", ""))
    timeout: float = 15.0

    def _post(self, service: str, **params: Any) -> dict:
        body = {"service": service, **params}
        r = requests.post(
            self.base_url,
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def _auth(self) -> dict:
        return {"xjid": self.xjid, "token": self.token}

    def _check(self, j: dict) -> dict:
        ret = j.get("ret")
        data = j.get("data", {}) if isinstance(j.get("data"), dict) else {}
        code = data.get("code", "0")
        if ret != 200:
            raise KSFitError(ret, code, j.get("msg", ""), j)
        # PhalApi convention: code=0 = success, code=15 = no-data (soft empty,
        # surfaced as info=None rather than an error).
        if code not in ("0", 0, "15", 15):
            raise KSFitError(ret, code, data.get("msg", j.get("msg", "")), j)
        return data

    def login(self, force: bool = False, save: bool = True) -> dict:
        """Run user.login; cache xjid + token. Returns the full user info dict."""
        if not force and self.xjid and self.token:
            return {"xjid": self.xjid, "token": self.token, "cached": True}

        if not self.email or not self.password:
            raise KSFitError(0, None, "KSFIT_EMAIL / KSFIT_PASSWORD not set", {})

        pwmd5 = hashlib.md5(self.password.encode("utf-8")).hexdigest()
        j = self._post("user.login", email=self.email, pwd=pwmd5)
        data = self._check(j)
        info = data["info"]
        self.xjid = info["xjid"]
        self.token = info["token"]
        self.refresh_token = info.get("refresh_token", "")

        if save:
            set_key(str(ENV_PATH), "KSFIT_XJID", self.xjid)
            set_key(str(ENV_PATH), "KSFIT_TOKEN", self.token)
            if self.refresh_token:
                set_key(str(ENV_PATH), "KSFIT_REFRESH_TOKEN",
                        self.refresh_token)
        return info

    def call(self, service: str, **params: Any) -> Any:
        """Authenticated call to any service.

        Returns the response payload (`data.info`) unwrapped from the PhalApi
        `{code, info, msg}` envelope; auto-logs-in on first use and retries
        once on token-expiry. Raises `KSFitError` on non-success.
        """
        if not self.xjid or not self.token:
            self.login()
        j = self._post(service, **self._auth(), **params)
        if j.get("ret") in (401, 403) or (
            isinstance(j.get("data"), dict)
            and j["data"].get("code") in ("401", "403", "token_expired", "EXPIRED_TOKEN")
        ):
            self.login(force=True)
            j = self._post(service, **self._auth(), **params)
        return self._check(j).get("info")

    # ---- profile ------------------------------------------------------------

    def user_info(self) -> dict:
        return self.call("user.info")

    def get_user_info(self, user_id: str) -> dict:
        """`user.getUserInfo` — fetch another user's public profile by xjid."""
        return self.call("user.getUserInfo", user_id=user_id)

    def linked_accounts(self) -> dict:
        """`user.userbind` — which third-party accounts are bound (phone, email, fb, gg, …)."""
        return self.call("user.userbind")

    def guide(self) -> dict:
        """`user.getGuide` — onboarding-guide state per device family."""
        return self.call("user.getGuide")

    def user_programs(self) -> dict:
        """`user.getProgram` — user-created custom workout programs."""
        return self.call("user.getProgram")

    def weight_log(self) -> list:
        """`user.weightLog` — chronological weight + body-composition entries."""
        return self.call("user.weightLog")

    # ---- catalogs -----------------------------------------------------------

    def tags(self) -> dict:
        return self.call("tag.getList")

    def tags_short(self) -> list:
        return self.call("tag.getListShort")

    def tags_for_user(self) -> dict:
        return self.call("tag.getListForUser")

    def tags_for_guide(self) -> dict:
        return self.call("tag.getListForGuide")

    def tag_equipment(self) -> dict:
        return self.call("tag.getPackEquipment")

    def targets(self) -> list:
        """`target.getList` — preset workout targets (Running 10 min, etc.)."""
        return self.call("target.getList")

    def target(self, id: str) -> dict:
        return self.call("target.getById", id=id)

    # ---- sport history ------------------------------------------------------

    def sport_records(self, since_timestamp: int = 0) -> dict:
        """`record.GetAllRecords` — every treadmill / WalkingPad session for this user.

        Pass `since_timestamp` (server epoch from a previous response) to fetch
        only deltas. Returns `{"record": [SessionRecord], "timestamp": int}`.
        Each SessionRecord has detailid, did (MAC), run_id, distance (m),
        time (s), steps, consume (kcal × 10), heart, model, start_time,
        course_id, iw_* (Apple Watch fields), …
        """
        return self.call("record.GetAllRecords", timestamp=since_timestamp)

    def record_points(self, run_id: str) -> dict:
        """`record.getRecordPoint` — per-second telemetry (speed, hr, cadence) for a session."""
        return self.call("record.getRecordPoint", run_id=run_id)

    def shared_records(self) -> dict:
        """`record.getShareRecord` — sport records shared into your family group."""
        return self.call("record.getShareRecord")

    def shared_record_points(self, run_id: str) -> dict:
        return self.call("record.getShareRecordPoint", run_id=run_id)

    # ---- training plans / schedules ----------------------------------------

    def schedules(self) -> list:
        """`schedule.listMy` — every training plan the user has subscribed to."""
        return self.call("schedule.listMy")

    def schedule_detail(self, id: str) -> dict:
        return self.call("schedule.getDetail", id=id)

    def fitness_goal_day(self, date: str) -> list:
        """`schedule.listFitnessGoalByDay` — goal vs actual for one date (`YYYY-MM-DD`)."""
        return self.call("schedule.listFitnessGoalByDay", date=date)

    def fitness_goals_range(self, start_date: str, end_date: str) -> list:
        """`schedule.listFitnessGoalByDateRange` — goal vs actual across a date span."""
        return self.call(
            "schedule.listFitnessGoalByDateRange",
            start_date=start_date,
            end_date=end_date,
        )

    # ---- courses / lessons --------------------------------------------------

    def course_programs(self) -> dict:
        return self.call("lesson.programList")

    def course_collections(self) -> dict:
        """`lesson.collectlist` — user's favorited courses."""
        return self.call("lesson.collectlist")

    def course_history(self) -> dict:
        """`lesson.personal` — courses the user has actually trained with."""
        return self.call("lesson.personal")

    def course_packs(self) -> dict:
        """`lesson.getPackList` — paginated course-pack catalog."""
        return self.call("lesson.getPackList")

    def course_pack_detail(self, pack_id: str) -> dict:
        return self.call("lesson.getpackdetail", pack_id=pack_id)

    def course_detail(self, course_id: str) -> dict:
        return self.call("lesson.getDetail", course_id=course_id)

    def course_search(self, keyword: str) -> dict:
        return self.call("lesson.search", keyword=keyword)

    def course_ranking(self) -> dict:
        return self.call("lesson.rankinglist")

    def course_banner(self) -> dict:
        return self.call("course.exploreBanner")

    # ---- devices ------------------------------------------------------------

    def devices(self) -> dict:
        """`box.deviceList` — bound + shared devices with did (MAC), model, productId."""
        return self.call("box.deviceList")

    def device_name(self, product_detail_id: str) -> dict:
        return self.call("bind.getDeviceName", product_detail_id=product_detail_id)

    # ---- products -----------------------------------------------------------

    def products(self, country: str = "US") -> dict:
        return self.call("product.getList", country=country)

    def product_detail(self, product_detail_id: str) -> dict:
        return self.call("product.getDetail", product_detail_id=product_detail_id)

    def product_search_words(self) -> dict:
        return self.call("product.GetLeachWord")

    def product_guides(self, product_id: str) -> dict:
        return self.call("product.guidelist", product_id=product_id)

    # ---- social / notices ---------------------------------------------------

    def groups(self) -> dict:
        return self.call("share.getgrouplist")

    def group_info(self, group_id: str) -> dict:
        return self.call("share.getGroupInfo", group_id=group_id)

    def group_members(self, group_id: str) -> dict:
        return self.call("share.getGroupMemberList", group_id=group_id)

    def group_devices(self, group_id: str) -> dict:
        return self.call("share.getGroupDeviceList", group_id=group_id)

    def notice_hint(self) -> dict:
        return self.call("notice.hint")

    def notices(self) -> dict:
        return self.call("notice.getParentList")

    def notice_children(self, type_id: str) -> dict:
        return self.call("notice.getChildList", type_id=type_id)

    def feedback_list(self) -> dict:
        return self.call("notice.feedbackList")

    def events(self) -> dict:
        return self.call("event.getlist")

    # ---- leaderboard --------------------------------------------------------

    def ranking(self, type_: str = "1", start: int = 0, limit: int = 50) -> dict:
        return self.call("ranking.get", type=type_, start=start, limit=limit)

    def ranking_types(self) -> dict:
        return self.call("ranking.getType")
