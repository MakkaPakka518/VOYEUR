# ig luv

Private web panel and Playwright collector for Instagram and TikTok profiles visible to your account. It keeps persistent browser sessions, overwrites each target's latest profile screenshot, archives newly observed posts, and downloads their images and videos.

## Features

- Password-protected web panel for desktop and mobile.
- Instagram login with password-error and verification-code handling in the panel.
- TikTok account/password login, verification feedback, and Cookie import as a fallback.
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

Both platforms use the same polling interval and per-user post limit. Their browser sessions are opened
sequentially to fit the VPS memory limit. Library filters let you select Instagram, TikTok or both.

## Data

Everything is stored under `data/`:

- `data/config.json`: collector settings and Instagram credentials, owner-only permissions.
- `data/profile/`: persistent Chromium profile and Instagram session.
- `data/status.json`: latest collector state.
- `data/targets/<username>/`: profile screenshot, per-target status, and archived items.
- `data/tiktok/`: TikTok browser profile, seen-post IDs, verification, screenshots and `targets/` archives.
- `data/config.json` retains the original Instagram fields and adds a separate `tiktok` object.

`data/` is ignored by git. Back it up if you want to keep the session and archive.

## Image viewer

Photos and screenshots are grouped in batches of up to 12. Click the left half of a photo
for the previous photo, or the right half for the next. The reveal starts at the press location.
Left/Right, Home and End also work; Enter or Space advances to the next photo.
The actions below each carousel apply to the current photo. Video items retain native playback controls.
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
