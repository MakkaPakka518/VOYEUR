import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


DATA_DIR = Path(os.getenv("DATA_DIR", "/opt/ig-luv/data"))
WECHAT_HOME = Path(os.getenv("WECHAT_HOME", "/mnt/data/wechat-home"))
STATE = WECHAT_HOME / ".local/state/ig-luv-wechat"
WXEXTRACT = Path(os.getenv("WXEXTRACT", "/mnt/data/wechat-tools/wxextract"))
SNS_TOOL = Path(os.getenv("WECHAT_SNS_TOOL", "/mnt/data/wechat-tools/wechat-sns-source"))
_ACCOUNT_ROOT = os.getenv("WECHAT_ACCOUNT_DIR", "")
ACCOUNT_ROOT = Path(_ACCOUNT_ROOT) if _ACCOUNT_ROOT else None
SAFE_AUTHOR = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
SAFE_POST = re.compile(r"^\d{1,32}$")
SAFE_MEDIA = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def refresh_export(workdir):
    if not ACCOUNT_ROOT or not ACCOUNT_ROOT.is_dir() or not (STATE / "sns-key.json").is_file() or not WXEXTRACT.is_dir() or not SNS_TOOL.is_dir():
        return None
    source = ACCOUNT_ROOT / "sns/sns.db"
    plain = workdir / "sns-plain.db"
    export = workdir / "sns-export-private.json"
    snapshot = workdir / "sns.db"
    shutil.copy2(source, snapshot)
    sys.path.insert(0, str(WXEXTRACT / "src"))
    from wxextract.decrypt import decrypt_via_python, integrity_check
    key_path = STATE / "sns-key.json"
    if key_path.stat().st_mode & 0o077:
        raise RuntimeError("微信 SNS 密钥权限不安全")
    key = bytes.fromhex(json.loads(key_path.read_text())["key"])
    result = decrypt_via_python(snapshot, plain, key)
    if not result.ok or integrity_check(plain) != "ok":
        raise RuntimeError("微信朋友圈数据库快照解密失败")
    subprocess.run([
        sys.executable, str(SNS_TOOL / "export_sns.py"), "--db", str(plain), "--output", str(export), "--no-aux",
    ], check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    export.chmod(0o600)
    return json.loads(export.read_text(encoding="utf-8"))


def selected_posts(export, requested, limit):
    authors = {}
    for post in export.get("posts", []):
        username = str(post.get("username") or "")
        nickname = str(post.get("nickname") or username)
        if SAFE_AUTHOR.fullmatch(username):
            authors[username] = nickname
    write_json(DATA_DIR / "wechat/authors.json", [{"id": key, "name": value} for key, value in sorted(authors.items(), key=lambda item: item[1])])
    wanted = {item for item in requested if SAFE_AUTHOR.fullmatch(item)}
    if not wanted:
        return [], authors
    selected = []
    pending = json.loads((DATA_DIR / "wechat/pending.json").read_text()) if (DATA_DIR / "wechat/pending.json").exists() else {}
    for username in wanted:
        posts = [post for post in export.get("posts", []) if str(post.get("username") or "") == username]
        posts.sort(key=lambda post: int(post.get("create_time") or 0), reverse=True)
        chosen = posts[:limit]
        pending_ids = set(pending.get(username, []))
        chosen.extend(post for post in posts if str(post.get("id") or post.get("tid") or "") in pending_ids and post not in chosen)
        selected.extend(chosen)
    return selected, authors


def prepare_media(posts, workdir):
    internal = workdir / "sns-selected-private.json"
    write_json(internal, {"posts": posts})
    encrypted = workdir / "media-cdn"
    decrypted = workdir / "media-plain"
    subprocess.run([
        sys.executable, str(SNS_TOOL / "download_media.py"), "--json", str(internal), "--output", str(encrypted), "--workers", "2", "--no-thumbs",
    ], check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([
        sys.executable, str(SNS_TOOL / "decrypt_media.py"), "--json", str(internal), "--media-dir", str(encrypted),
        "--output", str(decrypted), "--wasm-dir", str(STATE / "wechat-wasm"), "--workers", "2",
    ], check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return decrypted


def import_posts(posts, authors, media_root):
    results = {}
    pending_path = DATA_DIR / "wechat/pending.json"
    pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
    allowed = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4"}
    for post in posts:
        username = str(post.get("username") or "")
        post_id = str(post.get("id") or post.get("tid") or "")
        if not SAFE_AUTHOR.fullmatch(username) or not SAFE_POST.fullmatch(post_id):
            continue
        target = DATA_DIR / "wechat/targets" / username
        directory = target / "items" / post_id
        files = []
        metadata_path = directory / "metadata.json"
        current = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
        complete = current and all((directory / filename).is_file() for filename in current.get("media", []))
        if not complete:
            staging = target / ".staging" / post_id
            shutil.rmtree(staging, ignore_errors=True)
            staging.mkdir(parents=True, exist_ok=True)
            for index, media in enumerate(post.get("media", []), 1):
                media_id = str(media.get("id") or f"{post.get('tid')}_{index - 1}")
                if not SAFE_MEDIA.fullmatch(media_id):
                    continue
                source = next((path for path in media_root.glob(f"{media_id}.*") if path.suffix.lower() in allowed), None)
                if not source:
                    continue
                filename = f"media-{index:02d}{source.suffix.lower()}"
                shutil.copy2(source, staging / filename)
                files.append(filename)
            if post.get("media") and len(files) < len(post["media"]):
                shutil.rmtree(staging, ignore_errors=True)
                items = set(pending.get(username, []))
                items.add(post_id)
                pending[username] = sorted(items)
                write_json(pending_path, {key: value for key, value in pending.items() if value})
                continue
            caption = str(post.get("content_desc") or "")
            if caption and not files:
                (staging / "content.txt").write_text(caption, encoding="utf-8")
            timestamp = int(post.get("create_time") or 0)
            captured = datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if timestamp else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            write_json(staging / "metadata.json", {
                "url": "",
                "captured_at": captured,
                "caption": caption[:10_000],
                "media": files,
                "platform": "wechat",
                "capture_mode": "structured",
            })
            write_json(target / "profile.json", {"display_name": authors.get(username, username)})
            directory.parent.mkdir(parents=True, exist_ok=True)
            shutil.rmtree(directory, ignore_errors=True)
            staging.replace(directory)
        items = set(pending.get(username, []))
        items.discard(post_id)
        pending[username] = sorted(items)
        results.setdefault(username, 0)
        results[username] += 1
    for username, count in results.items():
        write_json(DATA_DIR / "wechat/targets" / username / "status.json", {
            "state": "ready", "platform": "wechat", "target": username, "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "visible_posts": count,
        })
    write_json(pending_path, {key: value for key, value in pending.items() if value})
    return sum(results.values())


def cleanup_stale_runs():
    run_root = STATE / "runs"
    if not run_root.exists():
        return
    for stale in run_root.iterdir():
        if stale.is_dir():
            shutil.rmtree(stale, ignore_errors=True)


def discover_authors():
    run_root = STATE / "runs"
    run_root.mkdir(parents=True, exist_ok=True)
    cleanup_stale_runs()
    with tempfile.TemporaryDirectory(dir=run_root) as temporary:
        export = refresh_export(Path(temporary))
        if export is None:
            return 0
        _posts, authors = selected_posts(export, [], 1)
        return len(authors)


def collect_structured(requested, limit):
    run_root = STATE / "runs"
    run_root.mkdir(parents=True, exist_ok=True)
    cleanup_stale_runs()
    with tempfile.TemporaryDirectory(dir=run_root) as temporary:
        workdir = Path(temporary)
        export = refresh_export(workdir)
        if export is None:
            return None
        posts, authors = selected_posts(export, requested, limit)
        if not posts:
            return 0
        media_root = prepare_media(posts, workdir)
        return import_posts(posts, authors, media_root)
