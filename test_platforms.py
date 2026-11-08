import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault("PANEL_PASSWORD", "test-panel-password")
from fastapi.testclient import TestClient

import app
import tiktok
import web
from platforms import parse_cookie, read_json, target_list, write_json


class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.patches = [patch.object(module, name, self.root / suffix if suffix else self.root)
                        for module in (web, app) for name, suffix in (
                            ("DATA_DIR", ""), ("CONFIG_PATH", "config.json"),
                            ("STATUS_PATH", "status.json"), ("TRIGGER_PATH", "run.trigger"),
                            ("RESET_PATH", "reset-session.trigger"), ("VERIFICATION_PATH", "verification.json"))]
        for item in self.patches:
            item.start()
        self.client = TestClient(web.app)
        self.client.cookies.set("ig_luv_session", web.session_token())
        self.ig = {"targets": ["demo"], "username": "ig-account", "password": "ig-secret", "interval": 300, "post_limit": 12}
        write_json(self.root / "config.json", self.ig)

    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches):
            item.stop()
        self.temporary.cleanup()

    def save_tiktok(self, **options):
        return self.client.post("/api/config", json={"platform": "tiktok", "targets": ["demo"], "username": "tk-account", "password": "tk-secret", **options})

    def test_config_preserves_instagram_and_hides_both_secrets(self):
        self.assertEqual(self.save_tiktok().status_code, 200)
        saved = read_json(self.root / "config.json", {})
        self.assertEqual(saved["password"], "ig-secret")
        self.assertEqual(saved["targets"], ["demo"])
        self.assertEqual(saved["tiktok"]["password"], "tk-secret")
        self.assertEqual((self.root / "config.json").stat().st_mode & 0o777, 0o600)
        response = self.client.get("/api/state").json()
        self.assertTrue(response["config"]["tiktok"]["has_password"])
        self.assertNotIn("ig-secret", str(response))
        self.assertNotIn("tk-secret", str(response))
        self.client.post("/api/config", json={**self.ig, "password": ""})
        self.assertEqual(read_json(self.root / "config.json", {})["tiktok"]["password"], "tk-secret")

    def test_cookie_and_password_method_switch_keeps_credentials(self):
        self.assertEqual(self.save_tiktok().status_code, 200)
        self.assertEqual(self.save_tiktok(password="", login_method="cookie", cookie="sessionid=test-session; sessionid_ss=second").status_code, 200)
        config = read_json(self.root / "config.json", {})["tiktok"]
        self.assertEqual(config["password"], "tk-secret")
        self.assertTrue((self.root / "tiktok/reset-session.trigger").exists())
        state = self.client.get("/api/state").json()
        self.assertTrue(state["config"]["tiktok"]["has_cookie"])
        self.assertNotIn("test-session", str(state))
        self.assertEqual(self.save_tiktok(password="", login_method="password").status_code, 200)
        config = read_json(self.root / "config.json", {})["tiktok"]
        self.assertEqual(config["password"], "tk-secret")

    def test_public_mode_and_invalid_inputs(self):
        self.assertEqual(self.save_tiktok(username="", password="").status_code, 200)
        for payload in ({"targets": [".."]}, {"targets": ["."]}, {"targets": ["../demo"]},
                        {"targets": [123]}, {"login_method": "other"}, {"platform": "other"},
                        {"login_method": "cookie", "cookie": "bad"}, {"interval": "bad"}):
            self.assertEqual(self.save_tiktok(**payload).status_code, 400, payload)
        self.assertEqual(self.save_tiktok(username="name", password="").status_code, 400)
        self.assertEqual(target_list("@Demo, DEMO, other.name"), ["demo", "other.name"])
        with self.assertRaises(ValueError):
            parse_cookie("sessionid=test\nvalue")

    def test_library_and_deletion_isolate_same_username_and_post_id(self):
        for folder in (self.root, self.root / "tiktok"):
            directory = folder / "targets/demo/items/123"
            directory.mkdir(parents=True)
            (directory / "media-01.jpg").write_bytes(b"image")
            (directory / "media-02.mp4").write_bytes(b"video")
            (directory / "ignored.part").write_bytes(b"partial")
            write_json(directory / "metadata.json", {"captured_at": "2026-11-08T00:00:00Z"})
        library = self.client.get("/api/state").json()["library"]
        self.assertEqual([item["key"] for item in library], ["demo", "tiktok:demo"])
        self.assertTrue(library[1]["items"][0]["files"][0]["url"].startswith("/files/tiktok/"))
        self.assertEqual(len(library[1]["items"][0]["files"]), 2)
        self.assertEqual(self.client.delete("/api/targets/demo/items/123?platform=tiktok").status_code, 200)
        self.assertTrue((self.root / "targets/demo/items/123/media-01.jpg").exists())
        self.assertEqual(self.client.delete("/api/targets/demo?platform=tiktok").status_code, 200)
        self.assertTrue((self.root / "targets/demo").exists())
        self.assertEqual(self.client.delete("/api/targets/demo?platform=other").status_code, 404)
        self.assertEqual(self.client.delete("/api/targets/..%2Fdemo").status_code, 404)

    def test_verification_and_reset_are_platform_scoped(self):
        self.assertEqual(self.client.post("/api/verification?platform=tiktok", json={"code": "123456"}).status_code, 200)
        self.assertEqual(read_json(self.root / "tiktok/verification.json", {}), {"code": "123456"})
        self.assertFalse((self.root / "verification.json").exists())
        (self.root / "profile").mkdir()
        self.assertEqual(self.client.post("/api/reset-session?platform=tiktok").status_code, 200)
        self.assertTrue((self.root / "profile").exists())
        self.assertFalse((self.root / "reset-session.trigger").exists())
        self.assertFalse((self.root / "tiktok/verification.json").exists())

    def test_tiktok_runs_even_when_instagram_login_fails(self):
        self.save_tiktok()
        manager = MagicMock()
        with patch.object(app, "sync_playwright", return_value=manager), \
             patch.object(app, "run_cycle", side_effect=app.LoginError("invalid_credentials", "test login failure")), \
             patch.object(app, "run_tiktok_cycle", return_value={"state": "ready", "targets": []}) as run_tiktok, \
             patch.object(sys, "argv", ["app.py", "--once"]):
            app.main()
        run_tiktok.assert_called_once()
        status = read_json(self.root / "status.json", {})
        self.assertEqual(status["platforms"]["instagram"]["state"], "error")
        self.assertEqual(status["platforms"]["tiktok"]["state"], "ready")

    def test_config_trigger_arriving_during_a_cycle_is_not_lost(self):
        (self.root / "run.trigger").write_text("new settings")
        with patch.object(app.time, "sleep") as sleep:
            app.wait_for_trigger(300, marker=0)
        sleep.assert_not_called()

    def test_tiktok_hydration_and_media_groups(self):
        photo = {"id": "123", "imagePost": {"images": [
            {"imageURL": {"urlList": ["https://media.tiktokcdn.com/1.jpg"]}},
            {"imageURL": {"urlList": ["https://media.tiktokcdn.com/2.jpg"]}}]}}
        video = {"id": "124", "video": {"playAddr": "https://media.tiktokcdn.com/1.mp4", "downloadAddr": "https://media.tiktokcdn.com/2.mp4"}}
        self.assertEqual(tiktok.extract_items({"__DEFAULT_SCOPE__": {"webapp.video-detail": {"itemInfo": {"itemStruct": photo}}}}), [photo])
        self.assertEqual(tiktok.extract_items({"ItemModule": {"124": video}}), [video])
        self.assertEqual(tiktok.extract_items({"itemList": [photo, video, {"id": "../bad"}]}), [photo, video])
        self.assertEqual(len(tiktok.media_groups(photo)), 2)
        self.assertEqual(len(tiktok.media_groups(video)[0][1]), 2)
        self.assertEqual(tiktok.urls("http://127.0.0.1/"), [])

    def test_cookie_login_and_download_failures_do_not_fake_success(self):
        context = MagicMock()
        mode = tiktok.login(context, MagicMock(), {"login_method": "cookie", "cookie": "sessionid=test-session"}, self.root)
        self.assertEqual(mode, "cookie")
        self.assertEqual(context.add_cookies.call_args.args[0][0]["domain"], ".tiktok.com")
        bad = MagicMock(ok=False, headers={"content-type": "text/html"})
        context.request.get.return_value = bad
        with self.assertRaises(tiktok.TikTokError):
            tiktok.download(context, ["https://media.tiktokcdn.com/1.mp4"], "video", self.root, 1, "https://www.tiktok.com/@demo/video/123")
        self.assertFalse((self.root / "media-01.mp4").exists())
        good = MagicMock(ok=True, headers={"content-type": "video/mp4"})
        good.body.return_value = b"video contents"
        context.request.get.return_value = good
        self.assertEqual(tiktok.download(context, ["https://media.tiktokcdn.com/1.mp4"], "video", self.root, 1, "https://www.tiktok.com/@demo/video/123"), "media-01.mp4")
        self.assertEqual((self.root / "media-01.mp4").read_bytes(), b"video contents")

    def test_rate_limit_pauses_password_requests_but_allows_cookie(self):
        directory = self.root / "tiktok"
        write_json(directory / "login-paused.json", {"code": "rate_limited", "message": "paused"})
        context, page = MagicMock(), MagicMock()
        with self.assertRaises(tiktok.TikTokError):
            tiktok.login(context, page, {"username": "account", "password": "test-password"}, directory)
        page.goto.assert_not_called()
        self.assertEqual(tiktok.login(context, page, {"login_method": "cookie", "cookie": "sessionid=test"}, directory), "cookie")
        self.assertFalse((directory / "login-paused.json").exists())
        write_json(directory / "login-paused.json", {"code": "rate_limited"})
        self.assertEqual(self.save_tiktok().status_code, 200)
        self.assertFalse((directory / "login-paused.json").exists())


if __name__ == "__main__":
    unittest.main()
