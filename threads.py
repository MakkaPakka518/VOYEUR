import json
import re
import shutil
import time
from datetime import datetime, timezone

from playwright.sync_api import TimeoutError as PlaywrightTimeout

from platforms import parse_cookie, read_json, write_json


POST_RE = re.compile(r"^https://www\.threads\.(?:com|net)/@([a-zA-Z0-9._]+)/post/([A-Za-z0-9_-]+)")


class ThreadsError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def page_data(page):
    result = []
    for text in page.locator('script[type="application/json"]').all_text_contents():
        try:
            result.append(json.loads(text))
        except json.JSONDecodeError:
            continue
    return result


def extract_posts(data, target=None):
    result = {}
    def walk(value):
        if isinstance(value, dict):
            code = str(value.get("code", ""))
            permalink = str(value.get("permalink") or value.get("canonical_url") or "")
            user = value.get("user") or {}
            owner = str(user.get("username", "")) if isinstance(user, dict) else ""
            if re.fullmatch(r"[A-Za-z0-9_-]+", code) and ("threads.com/" in permalink or "threads.net/" in permalink):
                if not target or owner.lower() == target.lower():
                    result[code] = value
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
    walk(data)
    return result


def urls(value):
    if isinstance(value, str):
        return [value] if value.startswith("https://") else []
    if isinstance(value, dict):
        direct = value.get("url")
        if isinstance(direct, str):
            return urls(direct)
        return list(dict.fromkeys(url for item in value.values() for url in urls(item)))
    if isinstance(value, list):
        return list(dict.fromkeys(url for item in value for url in urls(item)))
    return []


def media_groups(post):
    media = post.get("carousel_media") or [post]
    groups = []
    for item in media:
        videos = urls(item.get("video_versions") or [])
        images = urls((item.get("image_versions2") or {}).get("candidates") or [])
        if videos:
            groups.append(("video", videos))
        elif images:
            groups.append(("image", images))
    return groups


def meta_content(page, property_name):
    locator = page.locator(f'meta[property="{property_name}"]')
    return locator.first.get_attribute("content", timeout=3000) if locator.count() else ""


def attention(page, root, code, message):
    page.screenshot(path=str(root / "login-required.png"), full_page=True)
    raise ThreadsError(code, message)


def login(context, page, config, root):
    if config.get("login_method") == "cookie":
        context.add_cookies(parse_cookie(config.get("cookie", ""), ".threads.com", "Threads"))
        return "cookie"
    if any(cookie["name"] in {"sessionid", "ds_user_id"} for cookie in context.cookies("https://www.threads.com")):
        return "session"
    if not config.get("username") and not config.get("password"):
        return "public"
    page.goto("https://www.threads.com/login", wait_until="domcontentloaded", timeout=60_000)
    alternate = page.get_by_text(re.compile(r"log in with username", re.I)).first
    if alternate.count() and alternate.is_visible():
        alternate.click()
    account = page.locator('input[name="username"], input[autocomplete="username"]').first
    password = page.locator('input[type="password"]').first
    try:
        account.wait_for(state="visible", timeout=20_000)
        account.fill(config["username"])
        password.fill(config["password"])
        page.get_by_role("button", name=re.compile(r"^log in$", re.I)).last.click(timeout=10_000)
    except PlaywrightTimeout:
        attention(page, root, "login_page_changed", "未找到 Threads 登录表单，可改用 Cookie 或公开模式")
    verification = str(read_json(root / "verification.json", {}).get("code", ""))
    submitted = False
    deadline = time.monotonic() + 45
    try:
        while time.monotonic() < deadline:
            if any(cookie["name"] in {"sessionid", "ds_user_id"} for cookie in context.cookies("https://www.threads.com")):
                (root / "login-required.png").unlink(missing_ok=True)
                return "credentials"
            body = page.locator("body").inner_text(timeout=5_000).lower()
            if any(text in body for text in ("incorrect password", "password was incorrect", "密码错误", "密码不正确")):
                attention(page, root, "invalid_credentials", "Threads 账号或密码错误")
            code_input = next((item.nth(i) for item in [page.locator('input[autocomplete="one-time-code"], input[name="code"]')] for i in range(item.count()) if item.nth(i).is_visible()), None)
            if code_input and not submitted:
                if not verification:
                    attention(page, root, "verification_required", "Threads 要求验证码")
                code_input.fill(verification)
                code_input.press("Enter")
                submitted = True
            captcha = page.locator('[id*="captcha"], [class*="captcha"], iframe[src*="challenge"]')
            if any(captcha.nth(i).is_visible() for i in range(captcha.count())):
                attention(page, root, "manual_verification", "Threads 要求人工验证，请查看截图或改用 Cookie")
            page.wait_for_timeout(1000)
    finally:
        (root / "verification.json").unlink(missing_ok=True)
    attention(page, root, "login_failed", "Threads 登录未完成，可改用 Cookie 或公开模式")


def download(context, candidates, kind, directory, index, referer):
    extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4"}
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
    raise ThreadsError("media_unavailable", "Threads 原始媒体下载失败，保留截图并在下次检查重试")


def archive_post(context, page, root, target, code, profile_item=None):
    url = f"https://www.threads.com/@{target}/post/{code}"
    directory = root / "targets" / target / "items" / code
    directory.mkdir(parents=True, exist_ok=True)
    video_requests = []
    def capture(request):
        if (request.resource_type == "media" or ".mp4" in request.url) and request.url not in video_requests:
            video_requests.append(request.url)
    page.on("request", capture)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(directory / "page.png"), full_page=True)
        posts = {}
        for data in page_data(page):
            posts.update(extract_posts(data))
        item = posts.get(code) or profile_item or {}
        groups = media_groups(item)
        if not groups and not item:
            canonical = meta_content(page, "og:url")
            match = POST_RE.match(canonical)
            if not match or match.group(2) != code:
                raise ThreadsError("post_unavailable", "Threads 帖子当前不可访问，将在下次检查重试")
            image = meta_content(page, "og:image")
            if video_requests:
                groups = [("video", video_requests)]
            elif image:
                groups = [("image", [image])]
        files = [download(context, candidates, kind, directory, index, url) for index, (kind, candidates) in enumerate(groups, 1)]
        caption = str((item.get("caption") or {}).get("text") or meta_content(page, "og:description") or "")
        if caption and not groups:
            temporary = directory / "content.txt.part"
            temporary.write_text(caption, encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(directory / "content.txt")
        write_json(directory / "metadata.json", {"url": url, "captured_at": now(), "caption": caption[:10_000], "media": files, "platform": "threads"})
        return {"id": code, "url": url, "media": files}
    finally:
        page.remove_listener("request", capture)


def collect_target(context, page, root, target, seen, limit):
    directory = root / "targets" / target
    directory.mkdir(parents=True, exist_ok=True)
    url = f"https://www.threads.com/@{target}"
    page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(4000)
    body = page.locator("body").inner_text(timeout=10_000)
    if "page isn't available" in body.lower() or "profile isn't available" in body.lower():
        attention(page, root, "profile_unavailable", "Threads 用户不存在或当前不可访问")
    links = []
    for link in page.locator('a[href*="/post/"]').evaluate_all("nodes => nodes.map(node => node.href)"):
        match = POST_RE.match(link)
        if match and match.group(1).lower() == target:
            canonical = f"https://www.threads.com/@{target}/post/{match.group(2)}"
            if canonical not in links:
                links.append(canonical)
    page.screenshot(path=str(directory / "latest.png"), full_page=True)
    profile_posts = {}
    for data in page_data(page):
        profile_posts.update(extract_posts(data, target))
    if not links and any(text in body.lower() for text in ("profile is private", "log in to see more")):
        attention(page, root, "threads_blocked", "Threads 未返回作品列表，请登录、更新 Cookie 或确认账号访问权限")
    selected = links[:limit]
    new_items = []
    failed_items = []
    for link in reversed(selected):
        code = link.rstrip("/").rsplit("/", 1)[-1]
        if code in seen:
            continue
        try:
            result = archive_post(context, page, root, target, code, profile_posts.get(code))
            new_items.append(result)
            seen[code] = now()
            write_json(root / "seen.json", seen)
        except Exception as error:
            failed_items.append({"id": code, "error": str(error)})
            print(f"threads post {code}: {error}", flush=True)
    result = {"platform": "threads", "target": target, "checked_at": now(), "visible_posts": len(selected), "new_items": new_items, "failed_items": failed_items}
    write_json(directory / "status.json", result)
    return result


def run_cycle(playwright, config, root, limit):
    root.mkdir(parents=True, exist_ok=True)
    if (root / "reset-session.trigger").exists():
        shutil.rmtree(root / "profile", ignore_errors=True)
        (root / "reset-session.trigger").unlink()
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
                result = {"platform": "threads", "target": target, "checked_at": now(), "error": str(error), "error_code": getattr(error, "code", "collection_failed")}
                write_json(root / "targets" / target / "status.json", result)
                results.append(result)
        errors = [result for result in results if "error" in result]
        if not errors:
            (root / "login-required.png").unlink(missing_ok=True)
        return {"state": "error" if errors else "ready", "checked_at": now(), "login_mode": mode, "targets": results, **({"error": errors[0]["error"], "error_code": errors[0]["error_code"]} if errors else {})}
    finally:
        context.close()
