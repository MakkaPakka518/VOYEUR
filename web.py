import hashlib
import hmac
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).parent
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
CONFIG_PATH = DATA_DIR / "config.json"
STATUS_PATH = DATA_DIR / "status.json"
TRIGGER_PATH = DATA_DIR / "run.trigger"
RESET_PATH = DATA_DIR / "reset-session.trigger"
VERIFICATION_PATH = DATA_DIR / "verification.json"
PANEL_PASSWORD = os.environ["PANEL_PASSWORD"]
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
USERNAME_RE = re.compile(r"^[a-z0-9._]+$")
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    path.chmod(0o600)


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


def library():
    result = []
    targets_dir = DATA_DIR / "targets"
    if not targets_dir.exists():
        return result
    for target_dir in sorted(path for path in targets_dir.iterdir() if path.is_dir()):
        target = {
            "name": target_dir.name,
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
                    if not path.is_file() or path.name == "metadata.json":
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


@app.get("/api/state")
def state(library_data: bool = True):
    config = read_json(CONFIG_PATH, {})
    return {
        "config": {
            "targets": config.get("targets", []),
            "username": config.get("username", ""),
            "has_password": bool(config.get("password")),
            "interval": config.get("interval", 300),
            "post_limit": config.get("post_limit", 12),
        },
        "status": read_json(STATUS_PATH, {"state": "not_configured"}),
        "login_screenshot": file_url(DATA_DIR / "login-required.png") if (DATA_DIR / "login-required.png").exists() else None,
        "library": library() if library_data else None,
    }


@app.post("/api/config")
async def save_config(request: Request):
    payload = await request.json()
    raw_targets = payload.get("targets", [])
    if isinstance(raw_targets, str):
        raw_targets = raw_targets.split(",")
    targets = list(dict.fromkeys(target.strip().lstrip("@").lower() for target in raw_targets if target.strip()))
    if not targets or any(not USERNAME_RE.fullmatch(target) for target in targets):
        raise HTTPException(400, "请输入有效的目标用户名")

    existing = read_json(CONFIG_PATH, {})
    password = str(payload.get("password", "")) or str(existing.get("password", ""))
    username = str(payload.get("username", "")).strip()
    if not username or not password:
        raise HTTPException(400, "请填写 Instagram 账号和密码")
    config = {
        "targets": targets,
        "username": username,
        "password": password,
        "interval": max(60, min(86_400, int(payload.get("interval", 300)))),
        "post_limit": max(1, min(24, int(payload.get("post_limit", 12)))),
    }
    write_json(CONFIG_PATH, config)
    if existing.get("username") and existing.get("username") != username:
        RESET_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


@app.post("/api/run")
def run_now():
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


@app.post("/api/reset-session")
def reset_session():
    VERIFICATION_PATH.unlink(missing_ok=True)
    RESET_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


def target_dir_or_404(target):
    if not USERNAME_RE.fullmatch(target):
        raise HTTPException(404)
    path = DATA_DIR / "targets" / target
    if not path.is_dir():
        raise HTTPException(404)
    return path


@app.delete("/api/targets/{target}")
def delete_target(target):
    path = target_dir_or_404(target)
    shutil.rmtree(path)
    return {"ok": True}


@app.delete("/api/targets/{target}/items/{item_id}")
def delete_item(target, item_id):
    path = target_dir_or_404(target) / "items" / item_id
    if not re.fullmatch(r"[A-Za-z0-9_-]+", item_id) or not path.is_dir():
        raise HTTPException(404)
    shutil.rmtree(path)
    return {"ok": True}


@app.post("/api/verification")
async def submit_verification(request: Request):
    payload = await request.json()
    code = re.sub(r"\s+", "", str(payload.get("code", "")))
    if not re.fullmatch(r"\d{4,10}", code):
        raise HTTPException(400, "请输入有效的验证码")
    write_json(VERIFICATION_PATH, {"code": code})
    TRIGGER_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"ok": True}


@app.get("/files/{relative_path:path}")
def files(relative_path, download: bool = False):
    path = (DATA_DIR / relative_path).resolve()
    if DATA_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, filename=path.name if download else None)
