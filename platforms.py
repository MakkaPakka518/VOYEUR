import json
import re
from pathlib import Path


PLATFORMS = ("instagram", "tiktok", "threads")
USERNAME_RE = re.compile(r"^[a-z0-9._]+$")


def valid_target(value):
    return isinstance(value, str) and bool(USERNAME_RE.fullmatch(value)) and value not in {".", ".."}


def target_list(value):
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError("请输入有效的目标用户名")
    targets = list(dict.fromkeys(item.strip().lstrip("@").lower() for item in value if item.strip()))
    if any(not valid_target(item) for item in targets):
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
