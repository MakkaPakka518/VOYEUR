# ig luv

Private web panel and Playwright collector for Instagram profiles visible to your account. It keeps a persistent browser session, overwrites each target's latest profile screenshot, archives newly observed posts and reels, and downloads their images and videos.

## Features

- Password-protected web panel for desktop and mobile.
- Instagram login with password-error and verification-code handling in the panel.
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

## Data

Everything is stored under `data/`:

- `data/config.json`: collector settings and Instagram credentials, owner-only permissions.
- `data/profile/`: persistent Chromium profile and Instagram session.
- `data/status.json`: latest collector state.
- `data/targets/<username>/`: profile screenshot, per-target status, and archived items.

`data/` is ignored by git. Back it up if you want to keep the session and archive.

## Image viewer

Photos and screenshots are grouped in batches of up to 12. Click the photo or the arrows
to reveal the next photo from the press location; Left/Right, Home and End also work.
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
```

The test uses local synthetic photos and an API fixture; it does not access or modify VPS data.
It checks reveal colors, rapid interruption, keyboard/touch, image failures, visibility pauses,
reduced motion, WebGL context recovery, teardown, gallery actions and 375/768/1440 layouts.
At 375px it also checks that photos are at least 350px wide and arrow buttons at least 48px wide.
Set `ARTIFACT_DIR` to choose where screenshots are saved.

## Notes

- Log in once with your own account; the session is reused until Instagram invalidates it.
- If Instagram asks for a verification code, enter it in the panel settings.
- If Instagram asks for a challenge or manual confirmation, check the login screenshot shown in the panel.
- Use only for content you are authorized to access and at a polling interval allowed by Instagram.
