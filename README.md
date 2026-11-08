# ig luv

Private web panel and Playwright collector for Instagram, TikTok, Douyin, Threads and X profiles visible to your account. It keeps persistent browser sessions, overwrites each target's latest profile screenshot, archives newly observed posts, and downloads their text, images and videos.

## Features

- Password-protected web panel for desktop and mobile.
- Instagram login with password-error and verification-code handling in the panel.
- TikTok account/password login, verification feedback, and Cookie import as a fallback.
- Douyin public collection and Cookie import.
- Threads public collection plus account/password and Cookie login fallbacks.
- X public collection plus account/password and Cookie login fallbacks.
- Platform-specific configuration, sessions, archives, status and deletion.
- Configurable targets, polling interval, and how many recent posts to check.
- Per-post screenshots plus original images and MP4 videos.
- Browse, open, download, and delete archived content from the panel.
- Ink-spread photo and screenshot carousels, with near-full-width photos on phones.
- Persistent Instagram session and collector state on disk.

## Requirements

- Docker and Docker Compose.
- A host with ports `80` and `8443` reachable, plus a domain pointing at it for automatic HTTPS.

## Run

```bash
cp .env.example .env
# edit .env: set PANEL_PASSWORD and PANEL_DOMAIN
docker compose up -d --build
docker compose logs -f
```

Open `https://<PANEL_DOMAIN>:8443`, sign in with `PANEL_PASSWORD`, then configure the Instagram account, targets, interval, and post limit in the panel.

## TikTok

In settings, choose **TikTok**, enter the target usernames, and select an authentication method:

- **Account/password:** enter your TikTok account and password. Leave both empty to try public profiles.
- **Cookie:** sign in to TikTok in your own browser, open Developer Tools → Network, select a request
  to `www.tiktok.com`, and copy the value of its `Cookie` request header. Paste only the value,
  such as `sessionid=...; sessionid_ss=...`, into the panel. Blank keeps a previously saved Cookie.

If TikTok requests a code, enter it in the panel. Captchas and manual challenges are shown as
requiring attention with a screenshot; switch to Cookie import if account/password login cannot complete.
When TikTok reports too many login attempts, password retries pause until you save updated settings,
reset the TikTok session, or switch to Cookie login.
Private profiles require a valid session with access to them. Expired Cookies and missing media are
reported as failures, and incomplete downloads are retried instead of being marked as archived.

All platforms use the same polling interval and per-user post limit. Their browser sessions are opened
sequentially to fit the VPS memory limit. Library pages separate Instagram, TikTok, Douyin, Threads, X and the combined view.

## Douyin

Choose **抖音** in settings and paste one or more full `https://www.douyin.com/user/...` profile
links. The panel extracts and preserves each case-sensitive `sec_user_id`; display names and Douyin IDs
are not accepted because they are ambiguous.

Public mode uses the profile page's own signed browser requests. If Douyin returns a login wall or risk
verification, sign in to `www.douyin.com` in your browser, copy the complete `Cookie` request-header
value, and switch to **Cookie** login. The Cookie commonly contains `sessionid`, `ttwid`, `odin_tt` and
`s_v_web_id`. Albums, videos and live-photo clips are archived under `data/douyin/`.

**QR code** login works without copying browser cookies. Save the protected QR preview from the panel,
then open Douyin's scanner on the same phone and choose the saved image from Photos. The server keeps
the browser session open for two minutes, stores the resulting session only in `data/douyin/profile/`,
and continues collection after confirmation.

## Threads

Choose **Threads** in settings and enter target usernames. Public profiles work without credentials;
account/password and Cookie modes are available for profiles that require a session. Threads uses its
own browser profile and archive under `data/threads/`, isolated from Instagram and TikTok.

Posts with photos or video use the existing carousel and native player. Pure text posts are not skipped:
the collector stores their full text in `metadata.json` and `content.txt`, keeps a page screenshot, and
shows them as downloadable cards under the **Text** media filter.

## X

Choose **X** in settings and enter target handles without `@`. Public profiles can be tried without
credentials, but X often limits signed-out or datacenter traffic. For reliable collection, sign in to
`x.com` in your browser, copy the complete `Cookie` request-header value from an X network request,
and use **Cookie** login. The Cookie should normally include `auth_token` and `ct0`.

X uses its own browser profile and archive under `data/x/`. Posts with multiple photos, MP4 video or
animated GIFs use the existing gallery and player. Text-only posts are stored in `content.txt` and shown
under the **Text** filter. Legacy `twitter.com/<handle>/status/<id>` links are recognized and normalized
to `x.com`.

## Data

Everything is stored under `data/`:

- `data/config.json`: collector settings and Instagram credentials, owner-only permissions.
- `data/profile/`: persistent Chromium profile and Instagram session.
- `data/status.json`: latest collector state.
- `data/targets/<username>/`: profile screenshot, per-target status, and archived items.
- `data/tiktok/`: TikTok browser profile, seen-post IDs, verification, screenshots and `targets/` archives.
- `data/douyin/`: Douyin browser profile, seen-post IDs, screenshots and `targets/` archives.
- `data/threads/`: Threads browser profile, seen-post IDs, verification, screenshots and `targets/` archives.
- `data/x/`: X browser profile, seen-post IDs, screenshots and `targets/` archives.
- `data/config.json` retains the original Instagram fields and adds separate `tiktok`, `douyin`, `threads` and `x` objects.

`data/` is ignored by git. Back it up if you want to keep the session and archive.

## Image viewer

The panel has separate, directly loadable pages: `/` for all platforms, `/instagram`, `/tiktok`,
`/douyin`, `/threads`, `/x`, and `/settings`. Desktop navigation includes all routes. The six-tab mobile
bar contains the five platforms and settings; tap the `ig luv` wordmark for the combined view.
The settings page groups platform/login, target users, and collection frequency into native
expandable sections, initially collapsed. Settings no longer appear below media.
Instagram, TikTok, Threads and X icons are included locally from Simple Icons (CC0-1.0); Douyin uses the local musical-note mark.

The header includes a compact [LeiBox Pixel Day–Night Toggle](https://leibox.pantoria.cn/docs/animations/pixel-toggle)
beside the refresh action. It keeps the original Canvas2D particles, drag/touch and keyboard behavior,
with audio disabled for the panel. The selected light or dark theme is stored only in the local browser,
synchronizes desktop/mobile switch instances, and updates browser theme colors. Component source and
its provenance notice are under `static/components/pixel-toggle/`.

Photos and screenshots are grouped in batches of up to 12. Click the left half of a photo
for the previous photo, or the right half for the next. The reveal starts at the press location.
Left/Right, Home and End also work; Enter or Space advances to the next photo.
The actions below each carousel apply to the current photo. Video items retain native playback controls.
Open original photos or videos in the in-page preview. Desktop uses a centered viewer and phones
use a fullscreen viewer. Close with the close button, Escape, or browser Back; playback and loading
are stopped on close and the original scroll position and focus are restored.
On phones, the viewer removes the surrounding scene whitespace so photos are nearly screen-width.

The viewer uses local WebGL shaders, falls back to a Canvas2D reveal, and respects reduced motion.
Complete source, notices and the embedded default demo atlas are under
`static/components/ink-spread-carousel/`. Runtime rendering does not depend on LeiBox or external assets.

## Viewer tests

Install Playwright and its Chromium browser for the isolated regression check:

```bash
npm install --no-save playwright
npx playwright install chromium
node test_carousel.mjs
python -m pip install httpx
python -m unittest -v test_platforms.py
```

The test uses local synthetic photos and an API fixture; it does not access or modify VPS data.
It checks reveal colors, rapid interruption, keyboard/touch, image failures, visibility pauses,
reduced motion, WebGL context recovery, teardown, gallery actions and 375/768/1440 layouts.
At 375px it also checks that photos are at least 350px wide, with large left/right touch regions.
Set `ARTIFACT_DIR` to choose where screenshots are saved.
The Python checks cover saved-credential privacy, configuration preservation, same-name target isolation,
platform-scoped deletion/verification/reset, TikTok media parsing and independent collector failures.

## Notes

- Log in once with your own account; the session is reused until Instagram invalidates it.
- If Instagram asks for a verification code, enter it in the panel settings.
- If Instagram asks for a challenge or manual confirmation, check the login screenshot shown in the panel.
- Use only for content you are authorized to access and at a polling interval allowed by Instagram.
