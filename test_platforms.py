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
import threads
import x as x_platform
import douyin
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

    def save_threads(self, **options):
        return self.client.post("/api/config", json={"platform": "threads", "targets": ["demo"], "username": "th-account", "password": "th-secret", **options})

    def save_x(self, **options):
        return self.client.post("/api/config", json={"platform": "x", "targets": ["demo"], "username": "xaccount", "password": "x-secret", **options})

    def save_douyin(self, **options):
        return self.client.post("/api/config", json={"platform": "douyin", "targets": ["https://www.douyin.com/user/MS4wLjAB_Test-ID"], "username": "", "password": "", **options})

    def test_config_preserves_instagram_and_hides_both_secrets(self):
        self.assertEqual(self.save_tiktok().status_code, 200)
        self.assertEqual(self.save_threads().status_code, 200)
        self.assertEqual(self.save_x().status_code, 200)
        self.assertEqual(self.save_douyin().status_code, 200)
        saved = read_json(self.root / "config.json", {})
        self.assertEqual(saved["password"], "ig-secret")
        self.assertEqual(saved["targets"], ["demo"])
        self.assertEqual(saved["tiktok"]["password"], "tk-secret")
        self.assertEqual(saved["threads"]["password"], "th-secret")
        self.assertEqual(saved["x"]["password"], "x-secret")
        self.assertEqual((self.root / "config.json").stat().st_mode & 0o777, 0o600)
        response = self.client.get("/api/state").json()
        self.assertTrue(response["config"]["tiktok"]["has_password"])
        self.assertNotIn("ig-secret", str(response))
        self.assertNotIn("tk-secret", str(response))
        self.assertNotIn("th-secret", str(response))
        self.assertNotIn("x-secret", str(response))
        self.assertEqual(response["config"]["douyin"]["targets"], ["MS4wLjAB_Test-ID"])
        self.client.post("/api/config", json={**self.ig, "password": ""})
        self.assertEqual(read_json(self.root / "config.json", {})["tiktok"]["password"], "tk-secret")

    def test_separate_pages_are_authenticated_and_directly_loadable(self):
        for path in ("/", "/instagram", "/tiktok", "/threads", "/x", "/douyin", "/settings"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("text/html", response.headers["content-type"])
        with TestClient(web.app) as guest:
            response = guest.get("/settings", follow_redirects=False)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/login")

    def test_cookie_and_password_method_switch_keeps_credentials(self):
        self.assertEqual(self.save_tiktok().status_code, 200)
        self.assertEqual(self.save_tiktok(password="", login_method="cookie", cookie="sessionid=test-session; sessionid_ss=second").status_code, 200)
        config = read_json(self.root / "config.json", {})["tiktok"]
        self.assertEqual(config["password"], "tk-secret")
        self.assertEqual(self.save_threads(login_method="cookie", cookie="sessionid=threads-session").status_code, 200)
        self.assertEqual(self.save_x(login_method="cookie", cookie="auth_token=x-session; ct0=csrf").status_code, 200)
        self.assertEqual(self.save_douyin(login_method="cookie", cookie="sessionid=douyin-session; ttwid=device").status_code, 200)
        state = self.client.get("/api/state").json()
        self.assertTrue(state["config"]["threads"]["has_cookie"])
        self.assertNotIn("threads-session", str(state))
        self.assertTrue(state["config"]["x"]["has_cookie"])
        self.assertNotIn("x-session", str(state))
        self.assertTrue(state["config"]["douyin"]["has_cookie"])
        self.assertNotIn("douyin-session", str(state))
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
        self.assertEqual(target_list("https://www.douyin.com/user/MS4wLjAB_Test-ID?from=web", "douyin"), ["MS4wLjAB_Test-ID"])
        with self.assertRaises(ValueError):
            parse_cookie("sessionid=test\nvalue")
        self.assertEqual(self.save_x(targets=["not.valid"]).status_code, 400)
        self.assertEqual(self.save_x(username="mail@example.com", password="secret").status_code, 400)
        self.assertEqual(self.save_douyin(targets=["https://evil.example/user/test"]).status_code, 400)
        self.assertEqual(self.save_douyin(username="account", password="secret").status_code, 400)

    def test_library_and_deletion_isolate_same_username_and_post_id(self):
        for folder in (self.root, self.root / "tiktok", self.root / "threads", self.root / "x", self.root / "douyin"):
            directory = folder / "targets/demo/items/123"
            directory.mkdir(parents=True)
            (directory / "media-01.jpg").write_bytes(b"image")
            (directory / "media-02.mp4").write_bytes(b"video")
            (directory / "ignored.part").write_bytes(b"partial")
            write_json(directory / "metadata.json", {"captured_at": "2026-11-08T00:00:00Z"})
        incomplete = self.root / "douyin/targets/demo/items/incomplete"
        incomplete.mkdir(parents=True)
        (incomplete / "page.png").write_bytes(b"partial")
        library = self.client.get("/api/state").json()["library"]
        self.assertEqual([item["key"] for item in library], ["demo", "tiktok:demo", "threads:demo", "x:demo", "douyin:demo"])
        self.assertTrue(library[1]["items"][0]["files"][0]["url"].startswith("/files/tiktok/"))
        self.assertEqual(len(library[1]["items"][0]["files"]), 2)
        self.assertEqual([item["id"] for item in library[-1]["items"]], ["123"])
        self.assertEqual(self.client.delete("/api/targets/demo/items/123?platform=tiktok").status_code, 200)
        self.assertTrue((self.root / "targets/demo/items/123/media-01.jpg").exists())
        self.assertEqual(self.client.delete("/api/targets/demo?platform=tiktok").status_code, 200)
        self.assertTrue((self.root / "targets/demo").exists())
        self.assertTrue((self.root / "threads/targets/demo").exists())
        self.assertEqual(self.client.delete("/api/targets/demo/items/123?platform=threads").status_code, 200)
        self.assertTrue((self.root / "targets/demo/items/123/media-01.jpg").exists())
        self.assertEqual(self.client.delete("/api/targets/demo?platform=other").status_code, 404)
        self.assertEqual(self.client.delete("/api/targets/..%2Fdemo").status_code, 404)

        case_target = "MS4wLjAB_Test-ID"
        case_item = self.root / f"douyin/targets/{case_target}/items/456"
        lower_item = self.root / "douyin/targets/ms4wljab_test-id/items/456"
        case_item.mkdir(parents=True)
        lower_item.mkdir(parents=True)
        self.assertEqual(self.client.delete(f"/api/targets/{case_target}/items/456?platform=douyin").status_code, 200)
        self.assertTrue(lower_item.exists())
        self.assertEqual(self.client.delete(f"/api/targets/{case_target}?platform=douyin").status_code, 200)
        self.assertTrue(lower_item.exists())

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
        self.save_threads()
        self.save_x()
        self.save_douyin()
        manager = MagicMock()
        with patch.object(app, "sync_playwright", return_value=manager), \
             patch.object(app, "run_cycle", side_effect=app.LoginError("invalid_credentials", "test login failure")), \
              patch.object(app, "run_tiktok_cycle", return_value={"state": "ready", "targets": []}) as run_tiktok, \
              patch.object(app, "run_threads_cycle", return_value={"state": "ready", "targets": []}) as run_threads, \
              patch.object(app, "run_x_cycle", return_value={"state": "ready", "targets": []}) as run_x, \
              patch.object(app, "run_douyin_cycle", return_value={"state": "ready", "targets": []}) as run_douyin, \
             patch.object(sys, "argv", ["app.py", "--once"]):
            app.main()
        run_tiktok.assert_called_once()
        run_threads.assert_called_once()
        run_x.assert_called_once()
        run_douyin.assert_called_once()
        status = read_json(self.root / "status.json", {})
        self.assertEqual(status["platforms"]["instagram"]["state"], "error")
        self.assertEqual(status["platforms"]["tiktok"]["state"], "ready")
        self.assertEqual(status["platforms"]["threads"]["state"], "ready")
        self.assertEqual(status["platforms"]["x"]["state"], "ready")
        self.assertEqual(status["platforms"]["douyin"]["state"], "ready")

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

    def test_threads_parses_media_and_persists_text_only_posts(self):
        photo = {"code": "photo1", "permalink": "https://www.threads.com/@demo/post/photo1", "user": {"username": "demo"}, "media_type": 1, "image_versions2": {"candidates": [{"url": "https://cdninstagram.com/1.jpg"}]}, "caption": {"text": "photo"}}
        video = {"code": "video1", "permalink": "https://www.threads.com/@demo/post/video1", "user": {"username": "demo"}, "media_type": 2, "video_versions": [{"url": "https://cdninstagram.com/1.mp4"}], "caption": {"text": "video"}}
        text = {"code": "text1", "permalink": "https://www.threads.com/@demo/post/text1", "user": {"username": "demo"}, "media_type": 19, "caption": {"text": "纯文字贴文"}}
        other = {"code": "other1", "permalink": "https://www.threads.com/@other/post/other1", "user": {"username": "other"}}
        data = {"payload": [{"thread_items": [{"post": photo}, {"post": video}, {"post": text}, {"post": other}]}]}
        self.assertEqual(set(threads.extract_posts(data, "demo")), {"photo1", "video1", "text1"})
        self.assertEqual(threads.media_groups(photo)[0][0], "image")
        self.assertEqual(threads.media_groups(video)[0][0], "video")
        self.assertEqual(threads.media_groups(text), [])
        page = MagicMock()
        page.locator.return_value.get_attribute.return_value = None
        with patch.object(threads, "page_data", return_value=[data]):
            result = threads.archive_post(MagicMock(), page, self.root / "threads", "demo", "text1", text)
        directory = self.root / "threads/targets/demo/items/text1"
        self.assertEqual(result["media"], [])
        self.assertEqual((directory / "content.txt").read_text(), "纯文字贴文")
        self.assertEqual(read_json(directory / "metadata.json", {})["caption"], "纯文字贴文")

    def test_threads_cookie_and_download(self):
        context = MagicMock()
        mode = threads.login(context, MagicMock(), {"login_method": "cookie", "cookie": "sessionid=threads-session"}, self.root)
        self.assertEqual(mode, "cookie")
        self.assertEqual(context.add_cookies.call_args.args[0][0]["domain"], ".threads.com")
        response = MagicMock(ok=True, headers={"content-type": "image/webp"})
        response.body.return_value = b"image contents"
        context.request.get.return_value = response
        self.assertEqual(threads.download(context, ["https://cdninstagram.com/1.webp"], "image", self.root, 1, "https://www.threads.com/@demo/post/photo1"), "media-01.webp")
        self.assertEqual((self.root / "media-01.webp").read_bytes(), b"image contents")

    def test_x_parses_posts_and_persists_text_only_posts(self):
        tweet = {
            "rest_id": "123",
            "core": {"user_results": {"result": {"legacy": {"screen_name": "Demo"}}}},
            "legacy": {"id_str": "123", "full_text": "X 纯文字贴文", "extended_entities": {"media": [
                {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/photo"},
                {"type": "video", "video_info": {"variants": [
                    {"content_type": "video/mp4", "bitrate": 256000, "url": "https://video.twimg.com/low.mp4"},
                    {"content_type": "video/mp4", "bitrate": 832000, "url": "https://video.twimg.com/high.mp4"},
                ]}},
            ]}},
        }
        other = {"rest_id": "124", "core": {"user_results": {"result": {"legacy": {"screen_name": "Other"}}}}, "legacy": {"full_text": "other"}}
        self.assertEqual(set(x_platform.extract_tweets({"items": [tweet, other]}, "demo")), {"123"})
        quoted = {**tweet, "rest_id": "125", "legacy": {"id_str": "125", "full_text": "quoted"}}
        timeline = {"entries": [{"entryId": "tweet-123", "content": {"tweet": tweet, "quoted": quoted}}]}
        self.assertEqual(set(x_platform.extract_timeline_tweets(timeline, "demo")), {"123"})
        groups = x_platform.media_groups(tweet)
        self.assertEqual([group[0] for group in groups], ["image", "video"])
        self.assertEqual(groups[1][1][0], "https://video.twimg.com/high.mp4")
        self.assertEqual(x_platform.canonical_post("https://twitter.com/Demo/status/123?s=20", "demo"), "https://x.com/demo/status/123")
        self.assertEqual(x_platform.canonical_post("/Demo/status/123", "demo"), "https://x.com/demo/status/123")
        self.assertIsNone(x_platform.canonical_post("https://x.com/other/status/123", "demo"))
        long_tweet = {**tweet, "note_tweet": {"note_tweet_results": {"result": {"text": "完整的 X 长文"}}}}
        self.assertEqual(x_platform.tweet_text(long_tweet), "完整的 X 长文")

        text_tweet = {**tweet, "legacy": {"id_str": "123", "full_text": "X 纯文字贴文"}}
        page, article = MagicMock(), MagicMock()
        article.count.return_value = 0
        page.locator.return_value = article
        with patch.object(x_platform, "page_data", return_value=[{"tweet": text_tweet}]):
            result = x_platform.archive_post(MagicMock(), page, self.root / "x", "demo", "123", text_tweet)
        directory = self.root / "x/targets/demo/items/123"
        self.assertEqual(result["media"], [])
        self.assertEqual((directory / "content.txt").read_text(), "X 纯文字贴文")
        self.assertEqual(read_json(directory / "metadata.json", {})["platform"], "x")

        unavailable_page, no_articles = MagicMock(), MagicMock()
        no_articles.count.return_value = 0
        unavailable_page.locator.return_value = no_articles
        with patch.object(x_platform, "page_data", return_value=[]), self.assertRaises(x_platform.XError):
            x_platform.archive_post(MagicMock(), unavailable_page, self.root / "x", "demo", "999")
        self.assertFalse((self.root / "x/targets/demo/items/999/metadata.json").exists())

    def test_x_cookie_and_download(self):
        context = MagicMock()
        mode = x_platform.login(context, MagicMock(), {"login_method": "cookie", "cookie": "auth_token=x-session; ct0=csrf"}, self.root)
        self.assertEqual(mode, "cookie")
        self.assertEqual(context.add_cookies.call_args.args[0][0]["domain"], ".x.com")
        response = MagicMock(ok=True, headers={"content-type": "video/mp4"})
        response.body.return_value = b"video contents"
        context.request.get.return_value = response
        self.assertEqual(x_platform.download(context, ["https://video.twimg.com/high.mp4"], "video", self.root, 1, "https://x.com/demo/status/123"), "media-01.mp4")
        self.assertEqual((self.root / "media-01.mp4").read_bytes(), b"video contents")

    def test_douyin_parses_media_cookie_and_download(self):
        photo = {"aweme_id": "7666666666666666666", "desc": "图文", "author": {"sec_uid": "MS4wLjAB_Test-ID"}, "images": [
            {"url_list": ["https://p3.douyinpic.com/preview.jpg", "https://p3.douyinpic.com/original.jpg"]},
            {"url_list": ["https://p3.douyinpic.com/second.jpg"]},
        ]}
        video = {"aweme_id": "7677873898611989236", "desc": "视频", "author": {"sec_uid": "MS4wLjAB_Test-ID"}, "video": {
            "play_addr_h264": {"uri": "v0200test", "url_list": ["https://v3.douyinvod.com/video.mp4"]},
            "bit_rate": [
                {"bit_rate": 800000, "is_h265": 0, "play_addr": {"url_list": ["https://v3.douyinvod.com/hd.mp4"]}},
                {"bit_rate": 1200000, "is_h265": 1, "play_addr": {"url_list": ["https://v3.douyinvod.com/h265.mp4"]}},
            ],
        }}
        data = {"aweme_list": [photo, video, {**video, "aweme_id": "7688888888888888888", "author": {"sec_uid": "other"}}, {**video, "aweme_id": "7699999999999999999", "author": {}}]}
        self.assertEqual(set(douyin.extract_items(data, "MS4wLjAB_Test-ID")), {"7666666666666666666", "7677873898611989236"})
        self.assertEqual(douyin.media_groups(photo)[0], ("image", ["https://p3.douyinpic.com/original.jpg", "https://p3.douyinpic.com/preview.jpg"]))
        video_urls = douyin.media_groups(video)[0][1]
        self.assertEqual(video_urls[0], "https://v3.douyinvod.com/hd.mp4")
        self.assertFalse(any("h265" in url for url in video_urls))
        self.assertTrue(any("video_id=v0200test" in url for url in video_urls))

        context = MagicMock()
        self.assertEqual(douyin.login(context, {"login_method": "cookie", "cookie": "sessionid=douyin-session; ttwid=device"}), "cookie")
        self.assertEqual(context.add_cookies.call_args.args[0][0]["domain"], ".douyin.com")
        response = MagicMock(ok=True, headers={"content-type": "image/jpeg"})
        response.body.return_value = b"image contents"
        context.request.get.return_value = response
        self.assertEqual(douyin.download(context, ["https://p3.douyinpic.com/original.jpg"], "image", self.root, 1, "https://www.douyin.com/note/7666666666666666666"), "media-01.jpg")
        self.assertEqual((self.root / "media-01.jpg").read_bytes(), b"image contents")
        self.assertEqual(context.request.get.call_args.kwargs["headers"]["Referer"], "https://www.douyin.com/note/7666666666666666666")

        script_page = MagicMock()
        script_page.locator.return_value.all_text_contents.return_value = ['{"aweme_id":"7666666666666666666","desc":"Fish &quot; Chips","author":{"sec_uid":"MS4wLjAB_Test-ID"},"images":[{"url_list":["https://p3.douyinpic.com/a.jpg"]}]}']
        self.assertEqual(douyin.page_data(script_page)[0]["desc"], "Fish &quot; Chips")

    def test_douyin_retries_persisted_failures_outside_current_limit(self):
        root = self.root / "douyin"
        target = "MS4wLjAB_Test-ID"
        old_id, current_id = "7555555555555555555", "7666666666666666666"
        old_url = f"https://www.douyin.com/video/{old_id}"
        write_json(root / "pending.json", {target: {old_id: old_url}})
        current = {"aweme_id": current_id, "author": {"sec_uid": target}, "video": {"play_addr": {"url_list": ["https://v3.douyinvod.com/current.mp4"]}}}
        page = MagicMock()
        page.locator.return_value.evaluate_all.return_value = []
        page.locator.return_value.inner_text.return_value = ""
        attempts = []

        def archive(*args):
            post_id = args[4]
            attempts.append(post_id)
            if post_id == old_id:
                raise douyin.DouyinError("media_unavailable", "retry")
            return {"id": post_id, "url": args[6], "media": ["media-01.mp4"]}

        with patch.object(douyin, "page_data", return_value=[{"aweme_list": [current]}]), patch.object(douyin, "archive_post", side_effect=archive):
            result = douyin.collect_target(MagicMock(), page, root, target, {}, 1)
        self.assertEqual(attempts, [old_id, current_id])
        self.assertEqual(result["failed_items"][0]["id"], old_id)
        self.assertEqual(read_json(root / "pending.json", {})[target], {old_id: old_url})


if __name__ == "__main__":
    unittest.main()
