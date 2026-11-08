import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

from platforms import cleanup_platform_media, read_json, write_json, target_list
from tiktok import run_cycle as run_tiktok_cycle
from threads import run_cycle as run_threads_cycle
from x import run_cycle as run_x_cycle
from douyin import run_cycle as run_douyin_cycle


DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
CONFIG_PATH = DATA_DIR / "config.json"
STATUS_PATH = DATA_DIR / "status.json"
TRIGGER_PATH = DATA_DIR / "run.trigger"
RESET_PATH = DATA_DIR / "reset-session.trigger"
VERIFICATION_PATH = DATA_DIR / "verification.json"


class LoginError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_config():
    saved = read_json(CONFIG_PATH, {})
    default_interval = max(60, min(86_400, int(saved.get("interval", 300))))
    default_post_limit = max(1, min(24, int(saved.get("post_limit", 12))))
    targets = target_list(saved.get("targets", []), "instagram")
    tiktok = dict(saved.get("tiktok", {}))
    tiktok["targets"] = target_list(tiktok.get("targets", []), "tiktok")
    threads = dict(saved.get("threads", {}))
    threads["targets"] = target_list(threads.get("targets", []), "threads")
    x = dict(saved.get("x", {}))
    x["targets"] = target_list(x.get("targets", []), "x")
    douyin = dict(saved.get("douyin", {}))
    douyin["targets"] = target_list(douyin.get("targets", []), "douyin")
    for selected in (tiktok, threads, x, douyin):
        selected["enabled"] = selected.get("enabled", True) if isinstance(selected.get("enabled", True), bool) else True
        selected["interval"] = max(60, min(86_400, int(selected.get("interval", default_interval))))
        selected["cleanup_days"] = max(0, min(3650, int(selected.get("cleanup_days", 0))))
        selected["post_limit"] = max(1, min(24, int(selected.get("post_limit", default_post_limit))))
    return {
        "targets": targets,
        "username": str(saved.get("username", "")),
        "password": str(saved.get("password", "")),
        "enabled": saved.get("enabled", True) if isinstance(saved.get("enabled", True), bool) else True,
        "interval": default_interval,
        "cleanup_days": max(0, min(3650, int(saved.get("cleanup_days", 0)))),
        "post_limit": default_post_limit,
        "tiktok": tiktok,
        "threads": threads,
        "x": x,
        "douyin": douyin,
    }


def login_error(page, code, message):
    page.screenshot(path=str(DATA_DIR / "login-required.png"), full_page=True)
    raise LoginError(code, message)


def visible_input(page, selector):
    locator = page.locator(selector)
    for index in range(locator.count()):
        if locator.nth(index).is_visible():
            return locator.nth(index)
    return None


def login_if_needed(page, username, password, verification_code=""):
    cookies = page.context.cookies("https://www.instagram.com/")
    if any(cookie["name"] == "sessionid" for cookie in cookies):
        (DATA_DIR / "login-required.png").unlink(missing_ok=True)
        return "session"
    if not username or not password:
        return "public"

    page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded", timeout=60_000)
    cookie_button = page.get_by_role("button", name=re.compile(r"allow all cookies", re.I)).first
    try:
        cookie_button.wait_for(state="visible", timeout=8_000)
        cookie_button.click()
    except PlaywrightTimeout:
        pass

    username_input = page.locator(
        'input[name="username"], input[name="email"], input[autocomplete="username"]'
    ).first
    try:
        username_input.wait_for(state="visible", timeout=20_000)
    except PlaywrightTimeout:
        login_error(page, "login_page_changed", "未找到 Instagram 账号输入框，请查看登录截图")
    password_input = page.locator(
        'input[name="password"], input[name="pass"], input[autocomplete="current-password"]'
    ).first
    try:
        password_input.wait_for(state="visible", timeout=10_000)
    except PlaywrightTimeout:
        login_error(page, "login_page_changed", "未找到 Instagram 密码输入框，请查看登录截图")

    username_input.fill(username)
    password_input.fill(password)
    password_input.press("Enter")

    verification_submitted = False
    challenge_seen_at = None
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if any(cookie["name"] == "sessionid" for cookie in page.context.cookies("https://www.instagram.com/")):
            (DATA_DIR / "login-required.png").unlink(missing_ok=True)
            return "credentials"

        try:
            body = page.locator("body").inner_text(timeout=5_000).lower()
        except PlaywrightTimeout:
            time.sleep(1)
            continue
        if any(message in body for message in (
            "password was incorrect", "password you entered is incorrect", "wrong password",
            "password that you've entered is incorrect", "incorrect password",
            "isn't connected to an account", "密码不正确", "密码错误",
        )):
            login_error(page, "invalid_credentials", "Instagram 账号或密码错误")

        verification_input = visible_input(page,
            'input[autocomplete="one-time-code"], input[name="verificationCode"], '
            'input[name="approvals_code"], input[inputmode="numeric"]'
        )
        if not verification_input and ("/challenge/" in page.url or "/checkpoint/" in page.url):
            verification_input = visible_input(page, 'input[type="text"], input:not([type])')
        if verification_input:
            if verification_submitted:
                if any(message in body for message in ("incorrect code", "invalid code", "try again", "验证码错误")):
                    login_error(page, "invalid_verification", "验证码错误，请输入新的验证码")
            elif verification_code:
                verification_input.fill(verification_code)
                verification_input.press("Enter")
                verification_submitted = True
            else:
                login_error(page, "verification_required", "Instagram 要求输入验证码")

        if "/challenge/" in page.url or "/checkpoint/" in page.url:
            challenge_seen_at = challenge_seen_at or time.monotonic()
            if not verification_input and time.monotonic() - challenge_seen_at > 5:
                login_error(page, "manual_verification", "Instagram 要求确认登录，请查看登录页面")
        time.sleep(1)

    if verification_submitted:
        login_error(page, "invalid_verification", "验证码未通过，请输入新的验证码")
    login_error(page, "login_failed", "Instagram 登录未完成，请查看登录页面")


POST_RE = re.compile(r"^https://www\.instagram\.com/(?:([^/?#]+)/)?(?:p|reel)/([^/?#]+)/?")


def post_links(page, limit, target):
    links = page.locator('a[href*="/p/"], a[href*="/reel/"]').evaluate_all(
        "elements => elements.map(element => element.href)"
    )
    result = []
    for link in links:
        match = POST_RE.match(link)
        if not match or (match.group(1) and match.group(1).lower() != target):
            continue
        if link not in result:
            result.append(link)
    return result[:limit]


def media_urls(page):
    return page.locator("main li img, main li video").evaluate_all(
        """elements => [...new Set(elements
            .filter(element => element.tagName === 'VIDEO' || element.naturalWidth >= 500)
            .map(element => element.currentSrc || element.src)
            .filter(url => url && url.startsWith('http')))]"""
    )


def extension(content_type, url):
    known = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
    }
    content_type = content_type.split(";", 1)[0].lower()
    if content_type in known:
        return known[content_type]
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".mp4"} else ".bin"


def archive_post(context, page, target_dir, url):
    post_id = url.rstrip("/").rsplit("/", 1)[-1]
    item_dir = target_dir / "items" / post_id
    item_dir.mkdir(parents=True, exist_ok=True)

    video_urls = []
    page.on("request", lambda request: video_urls.append(request.url)
            if ".mp4" in request.url and request.url not in video_urls else None)

    page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_selector("main", timeout=30_000)
    page.wait_for_timeout(4_000)
    try:
        page.locator("main video, main li video").first.click(timeout=3_000)
    except PlaywrightTimeout:
        pass
    page.wait_for_timeout(4_000)
    page.screenshot(path=str(item_dir / "page.png"), full_page=True)

    candidates = media_urls(page) + video_urls[:1]
    saved_media = []
    for index, media_url in enumerate(dict.fromkeys(candidates), start=1):
        try:
            response = context.request.get(media_url, headers={"Referer": url}, timeout=60_000)
            if not response.ok:
                continue
            filename = f"media-{index:02d}{extension(response.headers.get('content-type', ''), media_url)}"
            (item_dir / filename).write_bytes(response.body())
            saved_media.append(filename)
        except Exception as error:
            print(f"media download failed {url}: {error}", flush=True)

    caption = page.locator('meta[property="og:description"]').get_attribute("content") or ""
    write_json(item_dir / "metadata.json", {
        "url": url,
        "captured_at": now(),
        "caption": caption[:10_000],
        "media": saved_media,
    })
    return post_id, saved_media


def collect_target(context, page, target, seen, post_limit):
    target_dir = DATA_DIR / "targets" / target
    target_dir.mkdir(parents=True, exist_ok=True)
    url = f"https://www.instagram.com/{target}/"
    page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    try:
        page.wait_for_selector('a[href*="/p/"], a[href*="/reel/"]', timeout=20_000)
    except PlaywrightTimeout:
        pass
    page.wait_for_timeout(2_000)
    page.screenshot(path=str(target_dir / "latest.png"), full_page=True)

    if "/accounts/login" in page.url:
        raise RuntimeError("此主页需要有效的 Instagram 登录会话")

    links = post_links(page, post_limit, target)
    new_items = []
    for link in reversed(links):
        post_id = link.rstrip("/").rsplit("/", 1)[-1]
        if post_id in seen:
            continue
        archived_id, files = archive_post(context, page, target_dir, link)
        seen[archived_id] = now()
        new_items.append({"id": archived_id, "url": link, "media": files})
        write_json(DATA_DIR / "seen.json", seen)

    result = {
        "target": target,
        "checked_at": now(),
        "visible_posts": len(links),
        "new_items": new_items,
    }
    write_json(target_dir / "status.json", result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def run_cycle(playwright, config, seen):
    context = playwright.chromium.launch_persistent_context(
        str(DATA_DIR / "profile"),
        headless=True,
        viewport={"width": 1440, "height": 1000},
        locale="en-US",
        args=["--disable-dev-shm-usage"],
    )
    try:
        page = context.pages[0] if context.pages else context.new_page()
        verification_code = str(read_json(VERIFICATION_PATH, {}).get("code", ""))
        try:
            login_mode = login_if_needed(page, config["username"], config["password"], verification_code)
        finally:
            if verification_code:
                VERIFICATION_PATH.unlink(missing_ok=True)
        page.close()
        page = context.new_page()
        results = []
        for target in config["targets"]:
            try:
                results.append(collect_target(context, page, target, seen, config["post_limit"]))
            except Exception as error:
                result = {"target": target, "checked_at": now(), "error": str(error)}
                write_json(DATA_DIR / "targets" / target / "status.json", result)
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
        state = "error" if any("error" in result for result in results) else "ready"
        return {
            "state": state,
            "checked_at": now(),
            "login_mode": login_mode,
            "targets": results,
        }
    finally:
        context.close()


def wait_for_trigger(seconds, marker=None):
    if marker is None:
        marker = TRIGGER_PATH.stat().st_mtime_ns if TRIGGER_PATH.exists() else 0
    for _ in range(seconds):
        current = TRIGGER_PATH.stat().st_mtime_ns if TRIGGER_PATH.exists() else 0
        if current != marker:
            return True
        time.sleep(1)
    return False


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    seen = read_json(DATA_DIR / "seen.json", {})
    due_at = {}
    cleanup_due = {}
    force = True
    with sync_playwright() as playwright:
        while True:
            trigger = TRIGGER_PATH.stat().st_mtime_ns if TRIGGER_PATH.exists() else 0
            try:
                config = load_config()
            except (ValueError, TypeError) as error:
                write_json(STATUS_PATH, {"state": "error", "checked_at": now(), "error": str(error)})
                if "--once" in sys.argv:
                    break
                force = wait_for_trigger(30, trigger)
                continue
            previous = read_json(STATUS_PATH, {})
            statuses = previous.get("platforms", {"instagram": previous})
            entries = (("instagram", config), ("tiktok", config["tiktok"]), ("threads", config["threads"]), ("x", config["x"]), ("douyin", config["douyin"]))
            if config["douyin"].get("login_method") in {"qrcode", "phone"} and config["douyin"]["enabled"]:
                entries = (entries[-1], *entries[:-1])
            current_time = time.monotonic()
            for platform, selected in entries:
                if selected["cleanup_days"] and (force or current_time >= cleanup_due.get(platform, 0)):
                    cleanup_platform_media(DATA_DIR, platform, selected["cleanup_days"])
                    cleanup_due[platform] = current_time + 86_400
                elif not selected["cleanup_days"]:
                    cleanup_due.pop(platform, None)
                if not selected["enabled"]:
                    statuses[platform] = {"state": "disabled"}
                    due_at.pop(platform, None)
                    continue
                if not selected["targets"]:
                    statuses[platform] = {"state": "not_configured"}
                    due_at.pop(platform, None)
                    continue
                if not force and current_time < due_at.get(platform, 0):
                    continue
                statuses[platform] = {"state": "running", "started_at": now(), "targets": []}
                write_json(STATUS_PATH, {"state": "running", "active_platform": platform, "started_at": now(), "platforms": statuses})
                try:
                    if platform == "instagram":
                        if RESET_PATH.exists():
                            shutil.rmtree(DATA_DIR / "profile", ignore_errors=True)
                            RESET_PATH.unlink()
                        statuses[platform] = run_cycle(playwright, config, seen)
                    elif platform == "tiktok":
                        statuses[platform] = run_tiktok_cycle(playwright, selected, DATA_DIR / "tiktok", selected["post_limit"])
                    elif platform == "threads":
                        statuses[platform] = run_threads_cycle(playwright, selected, DATA_DIR / "threads", selected["post_limit"])
                    elif platform == "x":
                        statuses[platform] = run_x_cycle(playwright, selected, DATA_DIR / "x", selected["post_limit"])
                    else:
                        statuses[platform] = run_douyin_cycle(playwright, selected, DATA_DIR / "douyin", selected["post_limit"])
                except Exception as error:
                    statuses[platform] = {"state": "error", "checked_at": now(), "error": str(error), "error_code": getattr(error, "code", "collection_failed")}
                    print(f"{platform}: {error}", flush=True)
                due_at[platform] = time.monotonic() + selected["interval"]
            configured = [statuses[platform] for platform, selected in entries if selected["enabled"] and selected["targets"]]
            state = "disabled" if not configured and all(not selected["enabled"] for _, selected in entries) else "not_configured" if not configured else "error" if any(value.get("state") == "error" for value in configured) else "ready"
            write_json(STATUS_PATH, {"state": state, "checked_at": now(), "platforms": statuses, "targets": [target for value in configured for target in value.get("targets", [])]})
            if "--once" in sys.argv:
                break
            waits = [due_at[platform] - time.monotonic() for platform, selected in entries if selected["enabled"] and selected["targets"]]
            force = wait_for_trigger(max(1, int(min(waits))) if waits else 30, trigger)


if __name__ == "__main__":
    main()
