import base64
import json
import re
import shutil
import time
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlparse

from platforms import parse_cookie, read_json, write_json


POST_RE = re.compile(r"^https://www\.douyin\.com/(video|note)/(\d+)")
API_PATHS = ("/aweme/v1/web/aweme/post/", "/aweme/v1/web/aweme/detail/", "/aweme/v1/web/user/profile/other/")
LOGIN_URL = "https://www.douyin.com/login_page?service=https%3A%2F%2Fwww.douyin.com"


class DouyinError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def page_data(page):
    result = []
    for text in page.locator('#RENDER_DATA, script[type="application/json"]').all_text_contents():
        text = text.strip()
        if text.lower().startswith("%7b"):
            text = unquote(text)
        try:
            result.append(json.loads(text))
        except (json.JSONDecodeError, RecursionError):
            continue
    return result


def extract_items(data, target=None):
    result = {}

    def walk(value):
        if isinstance(value, dict):
            post_id = str(value.get("aweme_id") or value.get("awemeId") or "")
            author = value.get("author") or {}
            owner = str(author.get("sec_uid") or author.get("secUid") or "") if isinstance(author, dict) else ""
            if re.fullmatch(r"\d{10,25}", post_id) and (value.get("video") or value.get("images")):
                if not target or owner == target:
                    result[post_id] = value
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
        direct = value.get("url_list") or value.get("urlList") or value.get("UrlList") or value.get("url") or []
        return urls(direct)
    if isinstance(value, list):
        return list(dict.fromkeys(url for item in value for url in urls(item)))
    return []


def address_candidates(address):
    candidates = urls(address)
    uri = str(address.get("uri", "")) if isinstance(address, dict) else ""
    if uri:
        candidates.append(f"https://www.douyin.com/aweme/v1/play/?video_id={quote(uri)}&ratio=default")
    return list(dict.fromkeys(candidates))


def video_candidates(video):
    result = []
    bitrates = [item for item in video.get("bit_rate") or [] if not item.get("is_h265")]
    bitrates.sort(key=lambda item: int(item.get("bit_rate", 0)), reverse=True)
    for item in bitrates:
        result.extend(address_candidates(item.get("play_addr") or item.get("playAddr") or {}))
    for key in ("play_addr_h264", "play_addr_256", "play_addr"):
        result.extend(address_candidates(video.get(key) or {}))
    return list(dict.fromkeys(result))


def media_groups(item):
    groups = []
    images = item.get("images") or []
    if images:
        for image in images:
            candidates = urls(image)
            if candidates:
                groups.append(("image", list(reversed(candidates))))
            live_video = image.get("video") or {}
            live_candidates = video_candidates(live_video)
            if live_candidates:
                groups.append(("video", live_candidates))
        return groups
    candidates = video_candidates(item.get("video") or {})
    return [("video", candidates)] if candidates else []


def post_url(item, post_id):
    kind = "note" if item.get("images") else "video"
    return f"https://www.douyin.com/{kind}/{post_id}"


def attention(page, root, code, message):
    page.screenshot(path=str(root / "login-required.png"), full_page=True)
    raise DouyinError(code, message)


def has_session(context):
    names = {cookie["name"] for cookie in context.cookies("https://www.douyin.com")}
    return bool(names & {"sessionid", "sessionid_ss"}) and "sid_tt" in names


def qr_image(page):
    candidates = page.locator('img[src^="data:image/png;base64,"], #animate_qrcode_container img, [class*="qrcode"] img')
    for index in range(candidates.count()):
        candidate = candidates.nth(index)
        box = candidate.bounding_box() if candidate.is_visible() else None
        if box and box["width"] >= 140 and box["height"] >= 140:
            return candidate
    return None


def save_qr(image, path):
    temporary = path.with_name(path.stem + ".tmp" + path.suffix)
    source = image.get_attribute("src") or ""
    if source.startswith("data:image/png;base64,"):
        temporary.write_bytes(base64.b64decode(source.partition(",")[2]))
    else:
        image.screenshot(path=str(temporary))
    temporary.chmod(0o600)
    temporary.replace(path)


def capture_qr_response(response, state):
    if "check_qrconnect" not in response.url:
        return
    try:
        payload = response.json()
        data = payload.get("data") or {}
    except Exception:
        return
    state["status"] = str(data.get("status") or "")
    redirect = str(data.get("redirect_url") or payload.get("redirect_url") or "")
    hostname = urlparse(redirect).hostname or ""
    if redirect.startswith("https://") and (hostname == "douyin.com" or hostname.endswith(".douyin.com")):
        state["redirect_url"] = redirect


def login(context, page, config, root):
    if config.get("login_method") == "cookie":
        context.add_cookies(parse_cookie(config.get("cookie", ""), ".douyin.com", "抖音"))
        return "cookie"
    if has_session(context):
        return "session"
    if config.get("login_method") == "qrcode":
        screenshot = root / "login-required.png"
        state_path = root / "qr-state.json"
        screenshot.unlink(missing_ok=True)
        state_path.unlink(missing_ok=True)
        qr_state = {}
        capture = lambda response: capture_qr_response(response, qr_state)
        page.on("response", capture)
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(2500)
        acquisition_deadline = time.monotonic() + 15
        image = qr_image(page)
        while not image and time.monotonic() < acquisition_deadline:
            page.wait_for_timeout(500)
            image = qr_image(page)
        if not image:
            page.screenshot(path=str(screenshot), full_page=True)
            page.remove_listener("response", capture)
            raise DouyinError("login_page_changed", "抖音登录页未显示二维码，请查看登录页面后重试")
        save_qr(image, screenshot)
        write_json(state_path, {"state": "waiting"})
        deadline = time.monotonic() + 120
        last_capture = time.monotonic()
        try:
            while time.monotonic() < deadline:
                if has_session(context):
                    screenshot.unlink(missing_ok=True)
                    state_path.unlink(missing_ok=True)
                    return "qrcode"
                status = qr_state.get("status")
                if status in {"scanned", "2"}:
                    write_json(state_path, {"state": "scanned"})
                elif status in {"confirmed", "3", "4"}:
                    write_json(state_path, {"state": "confirming"})
                redirect = qr_state.pop("redirect_url", "")
                if redirect:
                    try:
                        page.goto(redirect, wait_until="domcontentloaded", timeout=60_000)
                    except Exception:
                        pass
                    page.wait_for_timeout(1500)
                    if has_session(context):
                        screenshot.unlink(missing_ok=True)
                        state_path.unlink(missing_ok=True)
                        return "qrcode"
                image = qr_image(page)
                if image and time.monotonic() - last_capture >= 4:
                    save_qr(image, screenshot)
                    last_capture = time.monotonic()
                page.wait_for_timeout(1000)
            page.screenshot(path=str(screenshot), full_page=True)
            write_json(state_path, {"state": "expired"})
            raise DouyinError("qr_login_required", "抖音二维码已过期，请点击立即检查生成新二维码")
        finally:
            page.remove_listener("response", capture)
    return "public"


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
    raise DouyinError("media_unavailable", "抖音原始媒体下载失败，保留截图并在下次检查重试")


def archive_post(context, page, root, target, post_id, profile_item=None, source_url=None):
    item = profile_item or {}
    url = source_url or post_url(item, post_id)
    directory = root / "targets" / target / "items" / post_id
    directory.mkdir(parents=True, exist_ok=True)
    details = {}

    def capture(response):
        if any(path in response.url for path in API_PATHS):
            try:
                details.update(extract_items(response.json(), target))
            except Exception:
                pass

    page.on("response", capture)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(directory / "page.png"), full_page=True)
        for data in page_data(page):
            details.update(extract_items(data, target))
        item = details.get(post_id) or profile_item or {}
        author = item.get("author") or {}
        owner = str(author.get("sec_uid") or author.get("secUid") or "") if isinstance(author, dict) else ""
        if str(item.get("aweme_id") or item.get("awemeId") or "") != post_id or owner != target:
            raise DouyinError("post_unavailable", "抖音作品当前不可访问，将在下次检查重试")
        groups = media_groups(item)
        if not groups or any(not candidates for _, candidates in groups):
            raise DouyinError("media_unavailable", "抖音作品未返回可下载媒体，将在下次检查重试")
        url = post_url(item, post_id)
        files = [download(context, candidates, kind, directory, index, url)
                 for index, (kind, candidates) in enumerate(groups, 1)]
        caption = str(item.get("desc") or item.get("title") or "")
        write_json(directory / "metadata.json", {"url": url, "captured_at": now(), "caption": caption[:10_000], "media": files, "platform": "douyin"})
        return {"id": post_id, "url": url, "media": files}
    finally:
        page.remove_listener("response", capture)


def collect_target(context, page, root, target, seen, limit):
    directory = root / "targets" / target
    directory.mkdir(parents=True, exist_ok=True)
    discovered = {}

    def capture(response):
        if any(path in response.url for path in API_PATHS):
            try:
                discovered.update(extract_items(response.json(), target))
            except Exception:
                pass

    page.on("response", capture)
    try:
        page.goto(f"https://www.douyin.com/user/{target}", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(4000)
        for data in page_data(page):
            discovered.update(extract_items(data, target))
        dom_links = []
        for _ in range(3):
            for link in page.locator('a[href*="/video/"], a[href*="/note/"]').evaluate_all("nodes => nodes.map(node => node.href)"):
                match = POST_RE.match(link)
                canonical = f"https://www.douyin.com/{match.group(1)}/{match.group(2)}" if match else ""
                if match and match.group(2) in discovered and canonical not in dom_links:
                    dom_links.append(canonical)
            if len(discovered) >= limit or len(dom_links) >= limit:
                break
            page.mouse.wheel(0, 1000)
            page.wait_for_timeout(1200)
        links = list(dom_links)
        for post_id, item in discovered.items():
            url = post_url(item, post_id)
            if url not in links:
                links.append(url)
        page.screenshot(path=str(directory / "latest.png"), full_page=True)
        body = page.locator("body").inner_text(timeout=10_000).lower()
        if any(text in body for text in ("用户不存在", "账号已被封禁", "帐号已被封禁")):
            attention(page, root, "profile_unavailable", "抖音用户不存在、已停用或当前不可访问")
        if not links:
            if any(text in body for text in ("暂无作品", "还没有发布作品", "暂时没有作品")):
                result = {"platform": "douyin", "target": target, "checked_at": now(), "visible_posts": 0, "new_items": [], "failed_items": []}
                write_json(directory / "status.json", result)
                return result
            attention(page, root, "douyin_blocked", "抖音未返回作品列表，请更新 Cookie、完成验证或确认主页链接")
        selected = links[:limit]
        pending = read_json(root / "pending.json", {})
        target_pending = dict(pending.get(target, {}))
        attempts = list(dict.fromkeys(list(target_pending.values()) + selected))
        new_items = []
        failed_items = []
        for link in attempts:
            post_id = link.rstrip("/").rsplit("/", 1)[-1]
            if post_id in seen:
                target_pending.pop(post_id, None)
                continue
            try:
                result = archive_post(context, page, root, target, post_id, discovered.get(post_id), link)
                new_items.append(result)
                seen[post_id] = now()
                target_pending.pop(post_id, None)
                write_json(root / "seen.json", seen)
            except Exception as error:
                failed_items.append({"id": post_id, "error": str(error)})
                target_pending[post_id] = link
                print(f"douyin post {post_id}: {error}", flush=True)
        pending[target] = target_pending
        write_json(root / "pending.json", pending)
        result = {"platform": "douyin", "target": target, "checked_at": now(), "visible_posts": len(selected), "new_items": new_items, "failed_items": failed_items}
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
    context = playwright.chromium.launch_persistent_context(
        str(root / "profile"), headless=False, viewport={"width": 1440, "height": 1000}, locale="zh-CN",
        timezone_id="Asia/Shanghai", args=["--disable-dev-shm-usage", "--no-sandbox"],
    )
    try:
        page = context.pages[0] if context.pages else context.new_page()
        mode = login(context, page, config, root)
        results = []
        for target in config["targets"]:
            try:
                results.append(collect_target(context, page, root, target, seen, limit))
            except Exception as error:
                result = {"platform": "douyin", "target": target, "checked_at": now(), "error": str(error), "error_code": getattr(error, "code", "collection_failed")}
                write_json(root / "targets" / target / "status.json", result)
                results.append(result)
        errors = [result for result in results if "error" in result]
        if not errors:
            (root / "login-required.png").unlink(missing_ok=True)
        return {"state": "error" if errors else "ready", "checked_at": now(), "login_mode": mode, "targets": results, **({"error": errors[0]["error"], "error_code": errors[0]["error_code"]} if errors else {})}
    finally:
        context.close()
