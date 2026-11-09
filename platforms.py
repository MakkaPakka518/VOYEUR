import json
import re
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse


PLATFORMS = ("instagram", "tiktok", "threads", "x", "douyin", "wechat")
USERNAME_RE = re.compile(r"^[a-z0-9._]+$")
DOUYIN_TARGET_RE = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


def valid_target(value, platform="instagram"):
    if platform == "douyin":
        return isinstance(value, str) and bool(DOUYIN_TARGET_RE.fullmatch(value))
    return isinstance(value, str) and bool(USERNAME_RE.fullmatch(value)) and value not in {".", ".."}


def target_list(value, platform="instagram"):
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError("请输入有效的目标用户名")
    if platform == "douyin":
        targets = []
        for item in value:
            item = item.strip()
            if not item:
                continue
            parsed = urlparse(item)
            if parsed.scheme or parsed.netloc:
                match = re.fullmatch(r"/user/([^/]+)/?", parsed.path)
                if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"douyin.com", "www.douyin.com"} or not match:
                    raise ValueError("请输入有效的抖音主页链接或 sec_user_id")
                item = match.group(1)
            if item not in targets:
                targets.append(item)
    else:
        targets = list(dict.fromkeys(item.strip().lstrip("@").lower() for item in value if item.strip()))
    if any(not valid_target(item, platform) for item in targets):
        raise ValueError("请输入有效的目标用户名")
    return targets


def platform_dir(data_dir, platform):
    if platform not in PLATFORMS:
        raise ValueError("未知平台")
    return Path(data_dir) if platform == "instagram" else Path(data_dir) / platform


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def cleanup_platform_media(data_dir, platform, older_than_days=None):
    root = platform_dir(data_dir, platform)
    cutoff = None if older_than_days is None else time.time() - older_than_days * 86_400
    removed = {"screenshots": 0, "videos": 0}
    targets = root / "targets"
    if not targets.exists():
        return removed

    def remove(path, kind):
        try:
            if path.is_file() and (cutoff is None or path.stat().st_mtime < cutoff):
                path.unlink()
                removed[kind] += 1
        except FileNotFoundError:
            pass

    for target in (path for path in targets.iterdir() if path.is_dir()):
        remove(target / "latest.png", "screenshots")
        items = target / "items"
        if not items.exists():
            continue
        for item in (path for path in items.iterdir() if path.is_dir()):
            if platform == "wechat":
                screenshots = list(item.glob("*.png"))
                if screenshots and (cutoff is None or min(path.stat().st_mtime for path in screenshots) < cutoff):
                    removed["screenshots"] += len(screenshots)
                    shutil.rmtree(item)
                continue
            remove(item / "page.png", "screenshots")
            for video in item.glob("*.mp4"):
                remove(video, "videos")
    return removed


def parse_cookie(value, domain=".tiktok.com", label="TikTok"):
    if not isinstance(value, str) or len(value) > 65_536 or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError(f"请输入浏览器请求头中的 {label} Cookie")
    result = []
    for part in value.strip().split(";"):
        if not part.strip():
            continue
        name, separator, content = part.strip().partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z0-9_~-]+", name) or not content:
            raise ValueError("Cookie 格式应为 name=value; name=value")
        result.append({"name": name, "value": content, "domain": domain, "path": "/", "secure": True})
    if not result:
        raise ValueError(f"请输入 {label} Cookie")
    return result
