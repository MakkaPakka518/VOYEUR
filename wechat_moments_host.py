import fcntl
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from platforms import cleanup_platform_media
from wechat_structured_host import cleanup_stale_runs, collect_structured, discover_authors


DATA_DIR = Path(os.getenv("DATA_DIR", "/opt/ig-luv/data"))
CONFIG_PATH = DATA_DIR / "wechat" / "collector-config.json"
ROOT = DATA_DIR / "wechat"
STATUS_PATH = ROOT / "status.json"
TRIGGER_PATH = DATA_DIR / "run.trigger"


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


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = (ROOT / "collector.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("WeChat Moments collector is already running")
    cleanup_stale_runs()
    if not (ROOT / "authors.json").exists():
        try:
            discover_authors()
        except Exception as error:
            print(f"WeChat author discovery deferred: {error}", flush=True)
    last_run = 0.0
    marker = 0
    while True:
        config = read_json(CONFIG_PATH, {})
        enabled = config.get("enabled", False)
        interval = max(60, min(86_400, int(config.get("interval", 300))))
        limit = max(1, min(24, int(config.get("post_limit", 6))))
        cleanup_days = max(0, min(3650, int(config.get("cleanup_days", 0))))
        targets = config.get("targets", [])
        current_marker = TRIGGER_PATH.stat().st_mtime_ns if TRIGGER_PATH.exists() else 0
        due = time.monotonic() - last_run >= interval or current_marker != marker
        marker = current_marker
        if cleanup_days:
            cleanup_platform_media(DATA_DIR, "wechat", cleanup_days)
        if not enabled:
            write_json(STATUS_PATH, {"state": "disabled"})
        elif due:
            write_json(STATUS_PATH, {"state": "running", "started_at": now()})
            try:
                if not targets:
                    raise RuntimeError("请在微信平台选择至少一位好友 wxid")
                imported = collect_structured(targets, limit)
                if imported is None:
                    raise RuntimeError("微信 SNS 密钥或结构化采集依赖不可用")
                if imported == 0:
                    raise RuntimeError("未找到指定好友的朋友圈缓存，请从候选列表选择 wxid")
                result = {"state": "ready", "platform": "wechat", "target": "moments", "checked_at": now(), "visible_posts": imported, "new_items": []}
                write_json(STATUS_PATH, result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            except Exception as error:
                result = {"state": "error", "checked_at": now(), "error": str(error), "error_code": "wechat_capture_failed"}
                write_json(STATUS_PATH, result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            last_run = time.monotonic()
        time.sleep(5)


if __name__ == "__main__":
    main()
