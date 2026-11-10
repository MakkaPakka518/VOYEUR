import json
import os
from pathlib import Path

from wxextract.keys import verify_enc_key
from wxextract.passphrase import capture_passphrase, pbkdf2_key

WECHAT_HOME = Path(os.getenv("WECHAT_HOME", "/mnt/data/wechat-home"))
STATE_DIR = Path(os.getenv("WECHAT_STATE_DIR", str(WECHAT_HOME / ".local/state/ig-luv-wechat")))

account_roots = [path for path in (WECHAT_HOME / "xwechat_files").glob("*/db_storage") if path.is_dir()]
if len(account_roots) != 1:
    raise RuntimeError(f"expected one WeChat account, found {len(account_roots)}")

database = account_roots[0] / "sns" / "sns.db"
page1 = database.read_bytes()[:4096]
passphrase = capture_passphrase(
    Path(os.getenv("WECHAT_BINARY", "/opt/wechat/wechat")),
    timeout=300,
    probe_page1=page1,
    launch_cmd=["/usr/bin/wechat"],
)
key = pbkdf2_key(passphrase, page1[:16])
if not verify_enc_key(key, page1):
    raise RuntimeError("captured passphrase did not validate against sns.db")

STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_DIR.chmod(0o700)
key_path = STATE_DIR / "sns-key.json"
temporary = key_path.with_suffix(".tmp")
temporary.write_text(json.dumps({"version": 1, "key": key.hex()}), encoding="utf-8")
temporary.chmod(0o600)
temporary.replace(key_path)
print("SNS key enrolled and validated", flush=True)
