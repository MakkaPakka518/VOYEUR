import json
import re
import shutil
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

from playwright.sync_api import TimeoutError as PlaywrightTimeout

from platforms import parse_cookie, read_json, write_json


POST_RE = re.compile(r"^https://www\.tiktok\.com/@([a-zA-Z0-9._]+)/(video|photo)/(\d+)")


class TikTokError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def page_data(page):
    result = []
    for text in page.locator("#__UNIVERSAL_DATA_FOR_REHYDRATION__, #SIGI_STATE").all_text_contents():
        try:
            result.append(json.loads(text))
        except json.JSONDecodeError:
            continue
    return result


def extract_items(data):
    if not isinstance(data, dict):
        return []
    scope = data.get("__DEFAULT_SCOPE__", data)
    items = list((data.get("ItemModule") or {}).values())
    items.extend(data.get("itemList") or [])
    for key in ("webapp.user-detail", "webapp.video-detail"):
        detail = scope.get(key) or {}
        items.extend((detail.get("userInfo") or {}).get("itemList") or [])
        item = (detail.get("itemInfo") or {}).get("itemStruct")
        if item:
            items.append(item)
    return [item for item in items if isinstance(item, dict) and re.fullmatch(r"\d+", str(item.get("id", "")))]


def urls(value):
    if isinstance(value, str):
        return [value] if value.startswith("https://") else []
    if isinstance(value, dict):
        return urls(value.get("urlList") or value.get("UrlList") or value.get("url") or [])
    if isinstance(value, list):
        return list(dict.fromkeys(url for item in value for url in urls(item)))
    return []


def media_groups(item):
    images = (item.get("imagePost") or {}).get("images") or []
    if images:
        return [("image", urls(image.get("imageURL") or image.get("displayImage") or {})) for image in images]
    video = item.get("video") or {}
    candidates = urls(video.get("playAddr")) + urls(video.get("downloadAddr"))
    for bitrate in video.get("bitrateInfo") or []:
        candidates.extend(urls(bitrate.get("PlayAddr")))
    return [("video", list(dict.fromkeys(candidates)))]


def attention(page, root, code, message):
    page.screenshot(path=str(root / "login-required.png"), full_page=True)
    if code == "rate_limited":
        write_json(root / "login-paused.json", {"code": code, "message": message})
    raise TikTokError(code, message)


def visible_input(page, selector):
    inputs = page.locator(selector)
    return next((inputs.nth(i) for i in range(inputs.count()) if inputs.nth(i).is_visible()), None)


def dismiss_cookies(page):
    button = page.get_by_role("button", name=re.compile(r"^(Decline optional cookies|Allow all)$", re.I)).first
    if button.count() and button.is_visible():
        button.click(timeout=5000)


def login(context, page, config, root):
    if config.get("login_method") == "cookie":
        context.add_cookies(parse_cookie(config.get("cookie", "")))
        (root / "login-paused.json").unlink(missing_ok=True)
        return "cookie"
    paused = read_json(root / "login-paused.json", {})
    if paused:
        raise TikTokError("rate_limited", paused.get("message", "TikTok 登录请求过于频繁，请更新登录设置后再试"))
    if any(cookie["name"] in {"sessionid", "sessionid_ss", "sid_tt"} for cookie in context.cookies("https://www.tiktok.com")):
        return "session"
    if not config.get("username") and not config.get("password"):
        return "public"
    page.goto("https://www.tiktok.com/login/phone-or-email/email", wait_until="domcontentloaded", timeout=60_000)
    account = page.locator('input[name="username"], input[name="email"], input[autocomplete="username"], input[placeholder="Email or username"]').first
    password = page.locator('input[type="password"]').first
    try:
        account.wait_for(state="visible", timeout=20_000)
        account.fill(config["username"])
        password.fill(config["password"])
        dismiss_cookies(page)
        page.get_by_role("button", name=re.compile(r"^log in$", re.I)).last.click(timeout=10_000)
    except PlaywrightTimeout:
        attention(page, root, "login_page_changed", "未找到 TikTok 登录表单，可改用 Cookie 登录")
    verification = read_json(root / "verification.json", {}).get("code", "")
    submitted = False
    deadline = time.monotonic() + 45
    try:
        while time.monotonic() < deadline:
            if any(cookie["name"] in {"sessionid", "sessionid_ss", "sid_tt"} for cookie in context.cookies("https://www.tiktok.com")):
                (root / "login-required.png").unlink(missing_ok=True)
                return "credentials"
            body = page.locator("body").inner_text(timeout=5_000).lower()
            if any(text in body for text in ("too many attempts", "too frequent", "maximum number of attempts", "too many requests", "频繁", "次数过多")):
                attention(page, root, "rate_limited", "TikTok 登录请求过于频繁，已暂停密码重试，请改用 Cookie 或更新登录设置后再试")
            if any(text in body for text in ("incorrect password", "incorrect account", "wrong password", "username or password doesn't match", "couldn't find a tiktok account", "密码错误", "账号或密码错误")):
                attention(page, root, "invalid_credentials", "TikTok 账号或密码错误")
            code_input = visible_input(page, 'input[autocomplete="one-time-code"], input[name="code"], input[placeholder*="code" i]')
            if code_input and not submitted:
                if not verification:
                    attention(page, root, "verification_required", "TikTok 要求验证码")
                code_input.fill(str(verification))
                code_input.press("Enter")
                submitted = True
            if submitted and any(text in body for text in ("incorrect code", "invalid code", "验证码错误")):
                attention(page, root, "invalid_verification", "TikTok 验证码错误")
            captcha = page.locator('[id*="captcha"], [class*="captcha-verify"], iframe[src*="captcha"]')
            if any(captcha.nth(i).is_visible() for i in range(captcha.count())):
                attention(page, root, "manual_verification", "TikTok 要求人工验证，请查看截图或切换 Cookie 登录")
            page.wait_for_timeout(1000)
    finally:
        (root / "verification.json").unlink(missing_ok=True)
    attention(page, root, "login_failed", "TikTok 登录未完成，可切换 Cookie 登录")


def download(context, candidates, kind, directory, index, referer):
    extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4"}
    for url in candidates:
        try:
            response = context.request.get(url, headers={"Referer": referer}, timeout=60_000)
            mime = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if not response.ok or mime not in extensions or not mime.startswith(kind + "/"):
                response.dispose()
                continue
            body = response.body()
            response.dispose()
            if not body:
                continue
            filename = f"media-{index:02d}{extensions[mime]}"
            temporary = directory / (filename + ".part")
            temporary.write_bytes(body)
            temporary.replace(directory / filename)
            return filename
        except Exception:
            continue
    raise TikTokError("media_unavailable", "TikTok 原始媒体下载失败，保留截图并在下次检查重试")


def archive_post(context, page, root, target, post_id, item):
    kind = "photo" if (item.get("imagePost") or {}).get("images") else "video"
    url = f"https://www.tiktok.com/@{target}/{kind}/{post_id}"
    directory = root / "targets" / target / "items" / post_id
    directory.mkdir(parents=True, exist_ok=True)
    video_urls = []
    def capture(request):
        if (".mp4" in request.url or "mime_type=video" in request.url or request.resource_type == "media") and request.url not in video_urls:
            video_urls.append(request.url)
    page.on("request", capture)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(directory / "page.png"), full_page=True)
        details = [value for data in page_data(page) for value in extract_items(data) if str(value["id"]) == post_id]
        item = details[0] if details else item
        groups = media_groups(item)
        if groups and groups[0][0] == "video":
            dom = page.locator("video").evaluate_all("nodes => nodes.map(node => node.currentSrc || node.src)")
            groups[0][1].extend(urls(dom) + video_urls)
        files = [download(context, candidates, media_kind, directory, i, url) for i, (media_kind, candidates) in enumerate(groups, 1)]
        write_json(directory / "metadata.json", {"url": url, "captured_at": now(), "caption": str(item.get("desc", ""))[:10_000], "media": files, "platform": "tiktok"})
        return {"id": post_id, "url": url, "media": files}
    finally:
        page.remove_listener("request", capture)


def collect_target(context, page, root, target, seen, limit):
    directory = root / "targets" / target
    directory.mkdir(parents=True, exist_ok=True)
    discovered = {}
    def ingest(data):
        for item in extract_items(data):
            author = item.get("author") or {}
            owner = author.get("uniqueId", "") if isinstance(author, dict) else author
            if isinstance(owner, str) and owner.isdigit():
                owner = ""
            if owner and owner.lower() != target:
                continue
            discovered[str(item["id"])] = item
    def capture(response):
        if "/api/post/item_list/" not in response.url:
            return
        try:
            ingest(response.json())
        except Exception:
            pass
    page.on("response", capture)
    try:
        page.goto(f"https://www.tiktok.com/@{target}", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        dismiss_cookies(page)
        refresh = page.get_by_role("button", name=re.compile(r"^Refresh$", re.I)).first
        if refresh.count() and refresh.is_visible():
            refresh.click(timeout=5000)
            page.wait_for_timeout(2500)
        for data in page_data(page):
            ingest(data)
        for _ in range(3):
            for link in page.locator('a[href*="/video/"], a[href*="/photo/"]').evaluate_all("nodes => nodes.map(node => node.href)"):
                match = POST_RE.match(link)
                if match and match.group(1).lower() == target:
                    discovered.setdefault(match.group(3), {"id": match.group(3), "imagePost": {"images": [{}]} if match.group(2) == "photo" else {}})
            if len(discovered) >= limit:
                break
            page.mouse.wheel(0, 900)
            page.wait_for_timeout(1200)
        page.screenshot(path=str(directory / "latest.png"), full_page=True)
        if not discovered:
            detail = next((data.get("__DEFAULT_SCOPE__", {}).get("webapp.user-detail", {}) for data in page_data(page)), {})
            user_info = detail.get("userInfo") or {}
            user = user_info.get("user") or {}
            if user.get("secUid"):
                response = context.request.get("https://www.tiktok.com/api/post/item_list/?" + urlencode({"aid": 1988, "count": limit, "cursor": 0, "secUid": user["secUid"]}), timeout=30_000)
                try:
                    if response.ok:
                        ingest(response.json())
                except (ValueError, json.JSONDecodeError):
                    pass
                finally:
                    response.dispose()
            if not discovered and (not user or user.get("privateAccount") or int((user_info.get("stats") or {}).get("videoCount", 1)) > 0):
                attention(page, root, "tiktok_blocked", "TikTok 未返回作品列表，请确认账号可访问，完成登录或更新 Cookie")
        selected = sorted(discovered.items(), key=lambda pair: int(pair[0]), reverse=True)[:limit]
        new_items = []
        for post_id, item in reversed(selected):
            if post_id in seen:
                continue
            result = archive_post(context, page, root, target, post_id, item)
            new_items.append(result)
            seen[post_id] = now()
            write_json(root / "seen.json", seen)
        result = {"platform": "tiktok", "target": target, "checked_at": now(), "visible_posts": len(selected), "new_items": new_items}
        write_json(directory / "status.json", result)
        return result
    finally:
        page.remove_listener("response", capture)


def run_cycle(playwright, config, root, limit):
    root.mkdir(parents=True, exist_ok=True)
    if (root / "reset-session.trigger").exists():
        shutil.rmtree(root / "profile", ignore_errors=True)
        (root / "reset-session.trigger").unlink()
        (root / "login-paused.json").unlink(missing_ok=True)
    seen = read_json(root / "seen.json", {})
    context = playwright.chromium.launch_persistent_context(str(root / "profile"), headless=True, viewport={"width": 1440, "height": 1000}, locale="en-US", args=["--disable-dev-shm-usage"])
    try:
        page = context.pages[0] if context.pages else context.new_page()
        mode = login(context, page, config, root)
        results = []
        for target in config["targets"]:
            try:
                results.append(collect_target(context, page, root, target, seen, limit))
            except Exception as error:
                result = {"platform": "tiktok", "target": target, "checked_at": now(), "error": str(error), "error_code": getattr(error, "code", "collection_failed")}
                write_json(root / "targets" / target / "status.json", result)
                results.append(result)
        errors = [result for result in results if "error" in result]
        if not errors:
            (root / "login-required.png").unlink(missing_ok=True)
        return {"state": "error" if errors else "ready", "checked_at": now(), "login_mode": mode, "targets": results, **({"error": errors[0]["error"], "error_code": errors[0]["error_code"]} if errors else {})}
    finally:
        context.close()
