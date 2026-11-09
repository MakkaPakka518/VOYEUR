import hashlib
import json
import os
import fcntl
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "/opt/ig-luv/data"))
CONFIG_PATH = DATA_DIR / "config.json"
ROOT = DATA_DIR / "wechat"
TARGET = ROOT / "targets" / "moments"
STATUS_PATH = ROOT / "status.json"
TRIGGER_PATH = DATA_DIR / "run.trigger"
DISPLAY = os.getenv("DISPLAY", ":2")
XAUTHORITY = os.getenv("XAUTHORITY", "/mnt/data/wechat-home/.Xauthority")
ENV = {**os.environ, "DISPLAY": DISPLAY, "XAUTHORITY": XAUTHORITY, "HOME": "/mnt/data/wechat-home"}


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def xdotool(*arguments, check=True):
    return subprocess.run(["xdotool", *map(str, arguments)], env=ENV, text=True, capture_output=True, check=check, timeout=10).stdout.strip()


def windows(name):
    result = xdotool("search", "--name", f"^{name}$", check=False)
    return [item for item in result.splitlines() if item]


def geometry(window):
    values = {}
    for line in xdotool("getwindowgeometry", "--shell", window).splitlines():
        key, separator, value = line.partition("=")
        if separator and value.isdigit():
            values[key] = int(value)
    return values["X"], values["Y"], values["WIDTH"], values["HEIGHT"]


def validate_moments_window(window):
    if xdotool("getwindowname", window) != "朋友圈":
        raise RuntimeError("朋友圈窗口标题已变化")
    properties = subprocess.run(["xprop", "-id", window, "WM_CLASS", "_NET_WM_PID"], env=ENV, text=True, capture_output=True, check=True, timeout=10).stdout
    if '"wechat", "wechat"' not in properties:
        raise RuntimeError("朋友圈窗口不属于微信客户端")
    x, y, width, height = geometry(window)
    if width < 320 or height < 400 or width > 1000 or height > 1200:
        raise RuntimeError("朋友圈窗口尺寸异常")
    return x, y, width, height


def capture_window(window):
    result = subprocess.run(["import", "-silent", "-window", window, "png:-"], env=ENV, capture_output=True, check=True, timeout=30)
    if not result.stdout.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("朋友圈窗口截图格式无效")
    return result.stdout


def ensure_moments_window():
    moments = windows("朋友圈")
    if not moments:
        raise RuntimeError("请先在 Linux 微信中打开朋友圈窗口")
    validate_moments_window(moments[0])
    return moments[0]


def cleanup(days):
    if not days:
        return
    cutoff = time.time() - days * 86_400
    items = TARGET / "items"
    if not items.exists():
        return
    for item in (path for path in items.iterdir() if path.is_dir()):
        metadata = item / "metadata.json"
        try:
            modified = metadata.stat().st_mtime
        except FileNotFoundError:
            modified = item.stat().st_mtime
        if modified < cutoff:
            shutil.rmtree(item)


def collect(limit):
    # shortcut: archive feed viewports until structured sns.db enrollment is reliable.
    window = ensure_moments_window()
    xdotool("windowmap", window, "windowraise", window)
    _x, _y, width, height = validate_moments_window(window)
    xdotool("key", "--window", window, "Home")
    time.sleep(2)
    new_items = []
    previous = None
    for index in range(limit):
        xdotool("windowraise", window)
        time.sleep(0.2)
        _x, _y, width, height = validate_moments_window(window)
        body = capture_window(window)
        digest = hashlib.sha256(body).hexdigest()
        if digest == previous:
            break
        previous = digest
        item_id = digest[:20]
        directory = TARGET / "items" / item_id
        if not (directory / "metadata.json").exists() or not (directory / "media-01.png").exists():
            temporary = TARGET / ".staging" / item_id
            shutil.rmtree(temporary, ignore_errors=True)
            temporary.mkdir(parents=True, exist_ok=True)
            (temporary / "media-01.png").write_bytes(body)
            write_json(temporary / "metadata.json", {
                "url": "",
                "captured_at": now(),
                "caption": f"朋友圈页面快照 {index + 1}",
                "media": ["media-01.png"],
                "platform": "wechat",
            })
            shutil.rmtree(directory, ignore_errors=True)
            temporary.replace(directory)
            new_items.append({"id": item_id, "media": ["media-01.png"]})
        xdotool("key", "--window", window, "Next")
        time.sleep(2)
    result = {
        "state": "ready",
        "platform": "wechat",
        "target": "moments",
        "checked_at": now(),
        "visible_posts": len({path.name for path in (TARGET / "items").iterdir()}) if (TARGET / "items").exists() else 0,
        "new_items": new_items,
    }
    write_json(STATUS_PATH, result)
    return result


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = (ROOT / "collector.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("WeChat Moments collector is already running")
    last_run = 0.0
    marker = 0
    while True:
        config = read_json(CONFIG_PATH, {}).get("wechat", {})
        enabled = config.get("enabled", False)
        interval = max(60, min(86_400, int(config.get("interval", 300))))
        limit = max(1, min(24, int(config.get("post_limit", 6))))
        cleanup_days = max(0, min(3650, int(config.get("cleanup_days", 0))))
        current_marker = TRIGGER_PATH.stat().st_mtime_ns if TRIGGER_PATH.exists() else 0
        due = time.monotonic() - last_run >= interval or current_marker != marker
        marker = current_marker
        cleanup(cleanup_days)
        if not enabled:
            write_json(STATUS_PATH, {"state": "disabled"})
        elif due:
            write_json(STATUS_PATH, {"state": "running", "started_at": now()})
            try:
                result = collect(limit)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            except Exception as error:
                result = {"state": "error", "checked_at": now(), "error": str(error), "error_code": "wechat_capture_failed"}
                write_json(STATUS_PATH, result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            last_run = time.monotonic()
        time.sleep(5)


if __name__ == "__main__":
    main()
