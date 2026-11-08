import json
import re
import shutil
import time
from datetime import datetime, timezone

from playwright.sync_api import TimeoutError as PlaywrightTimeout

from platforms import parse_cookie, read_json, write_json


POST_RE = re.compile(r"^https://(?:(?:www|mobile)\.)?(?:x|twitter)\.com/([A-Za-z0-9_]+)/status/(\d+)", re.I)


class XError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_post(url, target):
    if str(url).startswith("/"):
        url = "https://x.com" + str(url)
    match = POST_RE.match(str(url))
    if not match or match.group(1).lower() != target.lower():
        return None
    return f"https://x.com/{target}/status/{match.group(2)}"


def page_data(page):
    result = []
    for text in page.locator('script[type="application/json"]').all_text_contents():
        try:
            result.append(json.loads(text))
        except json.JSONDecodeError:
            continue
    return result


def tweet_owner(tweet):
    result = (((tweet.get("core") or {}).get("user_results") or {}).get("result") or {})
    return str((result.get("legacy") or {}).get("screen_name") or (result.get("core") or {}).get("screen_name") or "")


def tweet_text(tweet):
    note = (((tweet.get("note_tweet") or {}).get("note_tweet_results") or {}).get("result") or {})
    return str(note.get("text") or (tweet.get("legacy") or {}).get("full_text") or "")


def extract_tweets(data, target=None):
    result = {}

    def walk(value):
        if isinstance(value, dict):
            legacy = value.get("legacy") or {}
            post_id = str(value.get("rest_id") or legacy.get("id_str") or "")
            owner = tweet_owner(value)
            if re.fullmatch(r"\d+", post_id) and isinstance(legacy, dict) and (legacy.get("full_text") is not None or tweet_text(value)):
                if not target or owner.lower() == target.lower():
                    result[post_id] = value
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return result


def extract_timeline_tweets(data, target=None):
    result = {}

    def walk(value):
        if isinstance(value, dict):
            match = re.fullmatch(r"tweet-(\d+)", str(value.get("entryId", "")))
            if match:
                tweets = extract_tweets(value, target)
                if match.group(1) in tweets:
                    result[match.group(1)] = tweets[match.group(1)]
                return
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return result


def media_groups(tweet):
    media = ((tweet.get("legacy") or {}).get("extended_entities") or {}).get("media") or []
    groups = []
    for item in media:
        kind = item.get("type")
        if kind == "photo" and item.get("media_url_https"):
            groups.append(("image", [item["media_url_https"] + "?name=orig"]))
        elif kind in {"video", "animated_gif"}:
            variants = [variant for variant in (item.get("video_info") or {}).get("variants") or []
                        if variant.get("content_type") == "video/mp4" and str(variant.get("url", "")).startswith("https://")]
            variants.sort(key=lambda variant: int(variant.get("bitrate", 0)), reverse=True)
            if variants:
                groups.append(("video", [variant["url"] for variant in variants]))
    return groups


def meta_content(page, name):
    locator = page.locator(f'meta[property="{name}"], meta[name="{name}"]')
    return locator.first.get_attribute("content", timeout=3000) if locator.count() else ""


def post_article(page, target, post_id):
    articles = page.locator('article[data-testid="tweet"]')
    for index in range(articles.count()):
        article = articles.nth(index)
        permalink = article.locator('a[href*="/status/"]:has(time)').first
        if permalink.count() and canonical_post(permalink.get_attribute("href") or "", target) == f"https://x.com/{target}/status/{post_id}":
            return article
    return None


def attention(page, root, code, message):
    page.screenshot(path=str(root / "login-required.png"), full_page=True)
    raise XError(code, message)


def visible_input(page, selector):
    inputs = page.locator(selector)
    return next((inputs.nth(index) for index in range(inputs.count()) if inputs.nth(index).is_visible()), None)


def login(context, page, config, root):
    if config.get("login_method") == "cookie":
        context.add_cookies(parse_cookie(config.get("cookie", ""), ".x.com", "X"))
        return "cookie"
    if any(cookie["name"] == "auth_token" for cookie in context.cookies("https://x.com")):
        return "session"
    if not config.get("username") and not config.get("password"):
        return "public"

    page.goto("https://x.com/i/flow/login", wait_until="domcontentloaded", timeout=60_000)
    account = page.locator('input[autocomplete="username"]').first
    try:
        account.wait_for(state="visible", timeout=20_000)
        account.fill(config["username"])
        account.press("Enter")
        page.wait_for_timeout(1500)
        challenge = visible_input(page, 'input[data-testid="ocfEnterTextTextInput"]')
        if challenge:
            challenge.fill(config["username"])
            challenge.press("Enter")
        password = page.locator('input[name="password"], input[autocomplete="current-password"]').first
        password.wait_for(state="visible", timeout=15_000)
        password.fill(config["password"])
        password.press("Enter")
    except PlaywrightTimeout:
        attention(page, root, "login_page_changed", "未找到 X 登录表单，请改用 Cookie 登录")

    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if any(cookie["name"] == "auth_token" for cookie in context.cookies("https://x.com")):
            (root / "login-required.png").unlink(missing_ok=True)
            return "credentials"
        body = page.locator("body").inner_text(timeout=5_000).lower()
        if any(text in body for text in ("wrong password", "incorrect password", "密码错误", "密码不正确")):
            attention(page, root, "invalid_credentials", "X 账号或密码错误")
        if any(text in body for text in ("unusual login activity", "enter your phone number or username", "verify your identity")):
            attention(page, root, "manual_verification", "X 要求额外验证，请改用已登录浏览器的 Cookie")
        page.wait_for_timeout(1000)
    attention(page, root, "login_failed", "X 登录未完成，请改用 Cookie 登录")


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
    raise XError("media_unavailable", "X 原始媒体下载失败，保留截图并在下次检查重试")


def archive_post(context, page, root, target, post_id, profile_tweet=None):
    url = f"https://x.com/{target}/status/{post_id}"
    directory = root / "targets" / target / "items" / post_id
    directory.mkdir(parents=True, exist_ok=True)
    details = {}

    def capture_response(response):
        try:
            details.update(extract_tweets(response.json(), target))
        except Exception:
            pass

    page.on("response", capture_response)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(directory / "page.png"), full_page=True)
        for data in page_data(page):
            details.update(extract_tweets(data, target))
        tweet = details.get(post_id) or profile_tweet or {}
        article = post_article(page, target, post_id)
        if not tweet and not article:
            raise XError("post_unavailable", "X 帖子当前不可访问，将在下次检查重试")
        groups = media_groups(tweet)
        if article:
            image_urls = article.locator('[data-testid="tweetPhoto"] img').evaluate_all(
                "nodes => [...new Set(nodes.map(node => node.currentSrc || node.src).filter(url => url && url.includes('pbs.twimg.com/media/')))]"
            )
            if image_urls and not any(kind == "image" for kind, _ in groups):
                groups = [("image", [image]) for image in image_urls] + groups
            video_urls = article.locator("video").evaluate_all(
                "nodes => [...new Set(nodes.map(node => node.currentSrc || node.src).filter(url => url && url.startsWith('https://video.twimg.com/') && url.includes('.mp4')))]"
            )
            if video_urls and not any(kind == "video" for kind, _ in groups):
                groups.append(("video", video_urls))
            elif article.locator("video").count() and not any(kind == "video" for kind, _ in groups):
                raise XError("media_unavailable", "X 视频地址暂不可用，将在下次检查重试")
        files = [download(context, candidates, kind, directory, index, url)
                 for index, (kind, candidates) in enumerate(groups, 1)]
        caption = tweet_text(tweet)
        if not caption and article:
            text = article.locator('[data-testid="tweetText"]').first
            if text.count():
                caption = text.inner_text(timeout=3000)
        canonical = canonical_post(meta_content(page, "og:url"), target)
        if not caption and canonical == url:
            caption = meta_content(page, "og:description") or meta_content(page, "twitter:description")
        if not caption and not groups:
            raise XError("post_unavailable", "X 帖子当前不可访问，将在下次检查重试")
        if caption and not groups:
            temporary = directory / "content.txt.part"
            temporary.write_text(caption, encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(directory / "content.txt")
        write_json(directory / "metadata.json", {"url": url, "captured_at": now(), "caption": caption[:10_000], "media": files, "platform": "x"})
        return {"id": post_id, "url": url, "media": files}
    finally:
        page.remove_listener("response", capture_response)


def collect_target(context, page, root, target, seen, limit):
    directory = root / "targets" / target
    directory.mkdir(parents=True, exist_ok=True)
    discovered = {}

    def capture(response):
        try:
            discovered.update(extract_timeline_tweets(response.json(), target))
        except Exception:
            pass

    page.on("response", capture)
    try:
        page.goto(f"https://x.com/{target}", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        for data in page_data(page):
            discovered.update(extract_timeline_tweets(data, target))
        links = []
        for _ in range(3):
            for link in page.locator('article[data-testid="tweet"]').evaluate_all(
                "nodes => nodes.map(node => node.querySelector('a[href*=\"/status/\"] time')?.closest('a')?.href).filter(Boolean)"
            ):
                canonical = canonical_post(link, target)
                if canonical and canonical not in links:
                    links.append(canonical)
            if len(links) >= limit:
                break
            page.mouse.wheel(0, 1000)
            page.wait_for_timeout(1200)
        if not links:
            links.extend(f"https://x.com/{target}/status/{post_id}" for post_id in discovered)
        page.screenshot(path=str(directory / "latest.png"), full_page=True)
        body = page.locator("body").inner_text(timeout=10_000).lower()
        if any(text in body for text in ("this account doesn’t exist", "this account doesn't exist", "account suspended")):
            attention(page, root, "profile_unavailable", "X 用户不存在、已停用或当前不可访问")
        if not links:
            if "rate limit exceeded" in body:
                attention(page, root, "rate_limited", "X 请求频率受限，请稍后重试或更新 Cookie")
            if any(text in body for text in ("hasn’t posted", "hasn't posted", "no posts yet", "posts will show up here")):
                result = {"platform": "x", "target": target, "checked_at": now(), "visible_posts": 0, "new_items": [], "failed_items": []}
                write_json(directory / "status.json", result)
                return result
            attention(page, root, "x_blocked", "X 未返回帖子列表，请登录、更新 Cookie 或确认账号访问权限")
        selected = links[:limit]
        new_items = []
        failed_items = []
        for link in reversed(selected):
            post_id = link.rstrip("/").rsplit("/", 1)[-1]
            if post_id in seen:
                continue
            try:
                result = archive_post(context, page, root, target, post_id, discovered.get(post_id))
                new_items.append(result)
                seen[post_id] = now()
                write_json(root / "seen.json", seen)
            except Exception as error:
                failed_items.append({"id": post_id, "error": str(error)})
                print(f"x post {post_id}: {error}", flush=True)
        result = {"platform": "x", "target": target, "checked_at": now(), "visible_posts": len(selected), "new_items": new_items, "failed_items": failed_items}
        write_json(directory / "status.json", result)
        return result
    finally:
        page.remove_listener("response", capture)


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
                result = {"platform": "x", "target": target, "checked_at": now(), "error": str(error), "error_code": getattr(error, "code", "collection_failed")}
                write_json(root / "targets" / target / "status.json", result)
                results.append(result)
        errors = [result for result in results if "error" in result]
        if not errors:
            (root / "login-required.png").unlink(missing_ok=True)
        return {"state": "error" if errors else "ready", "checked_at": now(), "login_mode": mode, "targets": results, **({"error": errors[0]["error"], "error_code": errors[0]["error_code"]} if errors else {})}
    finally:
        context.close()
