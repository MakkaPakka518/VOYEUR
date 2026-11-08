import hashlib
import hmac
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from platforms import PLATFORMS, parse_cookie, platform_dir, read_json, write_json, target_list, valid_target


ROOT = Path(__file__).parent
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
CONFIG_PATH = DATA_DIR / "config.json"
STATUS_PATH = DATA_DIR / "status.json"
TRIGGER_PATH = DATA_DIR / "run.trigger"
RESET_PATH = DATA_DIR / "reset-session.trigger"
VERIFICATION_PATH = DATA_DIR / "verification.json"
PANEL_PASSWORD = os.environ["PANEL_PASSWORD"]
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def session_token():
    return hmac.new(PANEL_PASSWORD.encode(), b"ig-luv-panel", hashlib.sha256).hexdigest()


def authenticated(request):
    supplied = request.cookies.get("ig_luv_session", "")
    return hmac.compare_digest(supplied, session_token())


@app.middleware("http")
async def protect_panel(request, call_next):
    path = request.url.path
    if path == "/health" or path == "/login" or path.startswith("/static/") or authenticated(request):
        return await call_next(request)
    if path.startswith("/api/") or path.startswith("/files/"):
        return JSONResponse({"detail": "请重新登录面板"}, status_code=401)
    return RedirectResponse("/login", status_code=303)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/login")
def login_page(request: Request):
    if authenticated(request):
        return RedirectResponse("/", status_code=303)
    return FileResponse(ROOT / "static" / "login.html")


@app.post("/login")
async def login(request: Request):
    form = await request.form()
    if not hmac.compare_digest(str(form.get("password", "")), PANEL_PASSWORD):
        return RedirectResponse("/login?error=1", status_code=303)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        "ig_luv_session", session_token(), httponly=True, secure=COOKIE_SECURE,
        samesite="strict", max_age=2_592_000,
    )
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie("ig_luv_session")
    return response


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


def file_url(path):
    return "/files/" + quote(str(path.relative_to(DATA_DIR)), safe="/")


def platform_library(platform):
    result = []
    targets_dir = platform_dir(DATA_DIR, platform) / "targets"
    if not targets_dir.exists():
        return result
    for target_dir in sorted(path for path in targets_dir.iterdir() if path.is_dir()):
        target = {
            "name": target_dir.name,
            "platform": platform,
            "key": target_dir.name if platform == "instagram" else f"tiktok:{target_dir.name}",
            "status": read_json(target_dir / "status.json", {}),
            "latest": file_url(target_dir / "latest.png") if (target_dir / "latest.png").exists() else None,
            "items": [],
        }
        items_dir = target_dir / "items"
        if items_dir.exists():
            for item_dir in (path for path in items_dir.iterdir() if path.is_dir()):
                metadata = read_json(item_dir / "metadata.json", {})
                files = []
                for path in sorted(item_dir.iterdir()):
                    if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".mp4"}:
                        continue
                    kind = "video" if path.suffix.lower() == ".mp4" else "image"
                    files.append({"name": path.name, "kind": kind, "url": file_url(path)})
                target["items"].append({
                    "id": item_dir.name,
                    "captured_at": metadata.get("captured_at", ""),
                    "caption": metadata.get("caption", ""),
                    "source_url": metadata.get("url", ""),
                    "files": files,
                })
            target["items"].sort(key=lambda item: item["captured_at"], reverse=True)
        result.append(target)
    return result


def library():
    return [target for platform in PLATFORMS for target in platform_library(platform)]


@app.get("/api/state")
def state(library_data: bool = True):
    config = read_json(CONFIG_PATH, {})
    tiktok = config.get("tiktok", {})
    return {
        "config": {
            "targets": config.get("targets", []),
            "username": config.get("username", ""),
            "has_password": bool(config.get("password")),
            "interval": config.get("interval", 300),
            "post_limit": config.get("post_limit", 12),
            "tiktok": {"targets": tiktok.get("targets", []), "username": tiktok.get("username", ""), "has_password": bool(tiktok.get("password")), "has_cookie": bool(tiktok.get("cookie")), "login_method": tiktok.get("login_method", "password")},
        },
        "status": read_json(STATUS_PATH, {"state": "not_configured"}),
        "login_screenshot": file_url(DATA_DIR / "login-required.png") if (DATA_DIR / "login-required.png").exists() else None,
        "tiktok_login_screenshot": file_url(DATA_DIR / "tiktok" / "login-required.png") if (DATA_DIR / "tiktok" / "login-required.png").exists() else None,
        "library": library() if library_data else None,
    }


@app.post("/api/config")
async def save_config(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "配置必须为对象")
    platform = payload.get("platform", "instagram")
    if platform not in PLATFORMS:
        raise HTTPException(400, "未知平台")
    existing = read_json(CONFIG_PATH, {})
    saved = existing if platform == "instagram" else existing.get("tiktok", {})
    password = str(payload.get("password", "")) or str(saved.get("password", ""))
    username = str(payload.get("username", "")).strip()
    try:
        targets = target_list(payload.get("targets", []))
        interval = max(60, min(86_400, int(payload.get("interval", existing.get("interval", 300)))))
        post_limit = max(1, min(24, int(payload.get("post_limit", existing.get("post_limit", 12)))))
    except (ValueError, TypeError) as error:
        raise HTTPException(400, "请输入有效的用户名、检查间隔和条数") from error
    if not targets:
        raise HTTPException(400, "请填写关注用户")
    selected = {"targets": targets, "username": username, "password": password}
    if platform == "instagram" and (not username or not password):
        raise HTTPException(400, "请填写 Instagram 账号和密码")
    if platform == "tiktok":
        method = payload.get("login_method", saved.get("login_method", "password"))
        if method not in {"password", "cookie"}:
            raise HTTPException(400, "请选择账号密码或 Cookie 登录")
        cookie = str(payload.get("cookie", "")) or str(saved.get("cookie", ""))
        if method == "cookie":
            try:
                parse_cookie(cookie)
            except ValueError as error:
                raise HTTPException(400, str(error)) from error
        elif bool(username) != bool(password):
            raise HTTPException(400, "请同时填写 TikTok 账号和密码，或都留空采集公开账号")
        selected.update({"login_method": method, "cookie": cookie})
    config = dict(existing)
    if platform == "instagram":
        config.update(selected)
    else:
        config["tiktok"] = selected
    config.update({"interval": interval, "post_limit": post_limit})
    write_json(CONFIG_PATH, config)
    root = platform_dir(DATA_DIR, platform)
    root.mkdir(parents=True, exist_ok=True)
    (root / "login-paused.json").unlink(missing_ok=True)
    changed = saved.get("username") and saved.get("username") != username
    if platform == "tiktok":
        changed = changed or saved.get("login_method") != selected["login_method"] or saved.get("cookie", "") != selected["cookie"]
    if changed:
        (root / "reset-session.trigger").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


@app.post("/api/run")
def run_now():
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


@app.post("/api/reset-session")
def reset_session(platform: str = "instagram"):
    if platform not in PLATFORMS:
        raise HTTPException(400, "未知平台")
    root = platform_dir(DATA_DIR, platform)
    root.mkdir(parents=True, exist_ok=True)
    (root / "verification.json").unlink(missing_ok=True)
    (root / "login-paused.json").unlink(missing_ok=True)
    (root / "reset-session.trigger").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


def target_dir_or_404(target, platform="instagram"):
    if platform not in PLATFORMS or not valid_target(target):
        raise HTTPException(404)
    path = platform_dir(DATA_DIR, platform) / "targets" / target
    if not path.is_dir():
        raise HTTPException(404)
    return path


@app.delete("/api/targets/{target}")
def delete_target(target, platform: str = "instagram"):
    path = target_dir_or_404(target, platform)
    shutil.rmtree(path)
    return {"ok": True}


@app.delete("/api/targets/{target}/items/{item_id}")
def delete_item(target, item_id, platform: str = "instagram"):
    path = target_dir_or_404(target, platform) / "items" / item_id
    if not re.fullmatch(r"[A-Za-z0-9_-]+", item_id) or not path.is_dir():
        raise HTTPException(404)
    shutil.rmtree(path)
    return {"ok": True}


@app.post("/api/verification")
async def submit_verification(request: Request, platform: str = "instagram"):
    if platform not in PLATFORMS:
        raise HTTPException(400, "未知平台")
    payload = await request.json()
    code = re.sub(r"\s+", "", str(payload.get("code", "")))
    if not re.fullmatch(r"\d{4,10}", code):
        raise HTTPException(400, "请输入有效的验证码")
    write_json(platform_dir(DATA_DIR, platform) / "verification.json", {"code": code})
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


@app.get("/files/{relative_path:path}")
def files(relative_path, download: bool = False):
    path = (DATA_DIR / relative_path).resolve()
    if DATA_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, filename=path.name if download else None)
