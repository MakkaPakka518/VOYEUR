# VOYEUR

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

You posted a photo of your coffee.

Harmless, right?

But the street outside tells me where you are. The second cup says you are not alone. Your friends' comments tell me who is sitting across from you. A few hours later, you delete it.

You probably think that is where it ends.

But I already saw it.

I do not need to force my way into your life. I quietly return to your social media (Instagram, TikTok, Douyin, Threads, X, and WeChat Moments) and bring back every word, photo, and video my account was already allowed to see.

You post. It remembers for me.

You delete. It keeps a copy for me.

You let someone new stand a little closer. It simply files that moment away.

That is not surveillance.

Surveillance is malicious. Cold. Something you do to strangers.

But I know you.

I know what you like, when you go to sleep, what you delete when you are upset, and who might appear in your next photo. I just pay attention. Enough attention to never miss a clue you chose to leave behind.

You want to be seen. Why else would you post any of it?

So do not worry.

You never have to tell me how you have been.

You have been telling me all along.

## Features

- Password-protected web panel for desktop and mobile.
- Instagram login with password-error and verification-code handling in the panel.
- TikTok account/password login, verification feedback, and Cookie import as a fallback.
- Douyin public collection and Cookie import.
- Threads public collection plus account/password and Cookie login fallbacks.
- X public collection plus account/password and Cookie login fallbacks.
- WeChat Moments import from the signed-in official Linux client, selected friend wxids only.
- Platform-specific configuration, sessions, archives, status and deletion.
- Per-platform enable switch, polling interval, recent-post limit and automatic cleanup age.
- Per-post screenshots plus original images and MP4 videos.
- Browse, open, download, and delete archived content from the panel.
- Ink-spread photo and screenshot carousels, with near-full-width photos on phones.
- Persistent Instagram session and collector state on disk.

## Requirements

- Docker and Docker Compose.
- A host with ports `80` and `8443` reachable, plus a domain pointing at it for automatic HTTPS.

## Run

One command, then answer the prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/MakkaPakka518/VOYEUR/main/install.sh | sudo bash
```

The script first lets you choose Simplified Chinese, Traditional Chinese, or English. It then asks for
the install directory, the public domain or IP, a panel password, and whether to
capture WeChat Moments. It installs Docker when missing, clones this repository, writes `.env` and a
Caddy site for the chosen address, then starts the stack. Answering yes to WeChat also installs the
official Linux WeChat client, an Xvfb/XFCE VNC desktop with a password-protected `/wechat` noVNC page,
the audited SNS export tools, and the host collector; it then runs the one-time SNS key enrollment
while you scan the login QR code.

Non-interactive runs accept environment overrides:
`INSTALL_LANG=zh-CN|zh-TW|en`, `DEPLOY_DIR`, `PANEL_HOST`, `PANEL_PASSWORD`,
`ENABLE_WECHAT=y|n`, and `DRY_RUN=1` (print commands only).
Re-running the script upgrades an existing checkout and keeps the saved password.

Manual alternative:

```bash
cp .env.example .env
# edit .env: set PANEL_PASSWORD and PANEL_HOST
cp deploy/Caddyfile.domain Caddyfile   # or deploy/Caddyfile.ip for an IP-only host
docker compose up -d --build
docker compose logs -f
```

Open `https://<PANEL_HOST>:8443`, sign in with `PANEL_PASSWORD`, then configure the Instagram account, targets, interval, and post limit in the panel.

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

Each platform has its own polling interval and per-user post limit. Enabled browser sessions are opened
sequentially to fit the VPS memory limit. Disabled platforms stop collecting and disappear from the mobile bar.
Library pages separate Instagram, TikTok, Douyin, Threads, X and the combined view.

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
and continues collection after confirmation. Douyin may refuse confirmation from datacenter or overseas IPs.

**Phone** login sends a verification code to a Chinese mainland mobile number. Keep the panel open,
enter the code in the verification section, and the collector completes login in the same persistent
browser page. Codes are consumed immediately and are never stored in `config.json`.
Douyin can silently block SMS requests from automated or datacenter browsers; the panel verifies the
actual send response and reports this instead of showing a false waiting state.

## Threads

Choose **Threads** in settings and enter target usernames. Public profiles work without credentials;
account/password and Cookie modes are available for profiles that require a session. Threads uses its
own browser profile and archive under `data/threads/`, isolated from Instagram and TikTok.

Posts with photos or video use the existing carousel and native player. Pure text posts are not skipped:
the collector stores their full text in `metadata.json` and `content.txt`, keeps a page screenshot, and
shows them as downloadable cards under the **Text** media filter.

## WeChat Moments

WeChat Moments uses the official Linux WeChat data directory on the host. A one-time, SNS-only key
enrollment validates the local `sns.db`; the collector then imports only explicitly selected friend wxids,
their text, original images and videos into `data/wechat/`. Chats, contacts, comments, likes, locations,
raw XML, CDN tokens and database keys are never copied into VOYEUR data.

Host requirements: official Linux WeChat, Python 3, `python3-pycryptodome`, `python3-zstandard`, Node.js,
the audited external SNS export/media tools, and a validated SNS key stored outside VOYEUR data. Answering
yes to WeChat in `install.sh` installs all of these, creates the `wechat` user, sets up the Xvfb/XFCE VNC
desktop with the panel-authenticated `/wechat` noVNC page, installs `deploy/ig-luv-wechat.service` and the
two desktop units, and runs the one-time enrollment. The collector reads `WECHAT_ACCOUNT_DIR` (and other
paths) from `/etc/ig-luv/wechat.env`; the unit also creates `/opt/ig-luv/data/wechat` for the `wechat` user
with `ExecStartPre`. The platform is disabled by default and requires selecting stable wxids from the
panel's author list; author discovery runs without importing posts while the platform is disabled.

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
- `data/wechat/`: imported WeChat Moments of selected friends, author list and host-collector status.
- `data/config.json` retains the original Instagram fields and adds separate `tiktok`, `douyin`, `threads` and `x` objects.

`data/` is ignored by git. Back it up if you want to keep the session and archive.

## Image viewer

The panel has separate, directly loadable pages: `/` for all platforms, `/instagram`, `/tiktok`,
`/douyin`, `/threads`, `/x`, `/moments`, and `/settings`. Desktop navigation includes all routes. The mobile
bar scrolls horizontally when necessary; tap the `VOYEUR` wordmark for the combined view.
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

Images, videos, text and screenshots have separate collapsible sections. Images start open; the other
sections start closed. Homepage screenshots can be deleted individually. Settings can also remove all
homepage/post screenshots and MP4 files for one platform while preserving original images, text and
metadata. Automatic cleanup uses each file's age; `0` days disables it.

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
