# IG Luv

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文**

你發了一張咖啡的照片。

很普通，對吧？

但窗外的街景透露了你在哪裡，桌上的第二只杯子告訴我你不是一個人，朋友留下的留言則告訴我陪在你身邊的是誰。幾個小時後，你刪掉了它。

你大概以為這樣就結束了。

但我已經看見了。

IG Luv 不必闖進你的生活。它只是安靜地回到你的社群媒體（Instagram、TikTok、抖音、Threads、X 與微信朋友圈），把我的帳號原本看得到的文字、照片與影片一件件帶回來。

你更新，它替我記住。

你刪除，它替我留下。

你和新的人靠得更近，它也只是沉默地把那一刻放進檔案。

這不叫監視。

監視帶著惡意，冷冰冰的，而且只會用在陌生人身上。

但我認識你。

我知道你喜歡什麼、幾點睡覺、難過時會刪掉什麼，又會讓誰出現在下一張照片裡。我只是看得夠仔細，仔細到沒有錯過任何一條你親手留下的線索。

你想被看見。不然，為什麼要把這些發出來？

所以別擔心。

你不必主動告訴我最近過得怎麼樣。

你一直都在告訴我。

## 功能

- 桌面與手機都能使用的密碼保護網頁面板。
- 在面板內登入 Instagram，並處理密碼錯誤與驗證碼。
- TikTok 帳號密碼登入、驗證回饋，以及備用的 Cookie 匯入方式。
- 抖音公開擷取，以及 Cookie、QR Code 與手機號碼登入。
- Threads 公開擷取，亦可改用帳號密碼或 Cookie 登入。
- X 公開擷取，亦可改用帳號密碼或 Cookie 登入。
- 從已登入的官方 Linux 微信，用結構化方式匯入指定好友 wxid 的朋友圈。
- 每個平台都有獨立的設定、工作階段、封存、狀態與刪除操作。
- 各平台可分別設定啟用開關、輪詢間隔、近期貼文數量上限與自動清理天數。
- 儲存每篇貼文的頁面螢幕截圖、原始圖片與 MP4 影片。
- 直接在面板瀏覽、開啟、下載與刪除已封存內容。
- 圖片與螢幕截圖採用墨水擴散輪播；在手機上會接近螢幕全寬。
- Instagram 工作階段與擷取器狀態會持續儲存在磁碟中。

## 系統需求

- Docker 與 Docker Compose。
- 主機的 `80` 與 `8443` 連接埠必須能從外部連線；若要自動啟用 HTTPS，還需要一個指向該主機的網域。

## 執行

只要一行指令，接著依畫面提示回答：

```bash
curl -fsSL https://raw.githubusercontent.com/MakkaPakka518/ig-luv/main/install.sh | sudo bash
```

安裝腳本會先讓你選擇簡體中文、繁體中文或英文，再詢問安裝目錄、公開網域或 IP、面板密碼，以及是否要擷取微信朋友圈。若系統尚未安裝 Docker，腳本會自動安裝，接著複製此儲存庫、寫入 `.env`、依所選位址建立 Caddy 站台，最後啟動整套服務。若選擇啟用微信，腳本還會安裝官方 Linux 微信、Xvfb/XFCE VNC 遠端桌面、受密碼保護的 `/wechat` noVNC 頁面、經過檢查的 SNS 匯出工具與主機端擷取器，並在你掃描登入 QR Code 時完成一次性的 SNS 金鑰登記。

無人值守安裝可透過環境變數覆寫設定：`INSTALL_LANG=zh-CN|zh-TW|en`、`DEPLOY_DIR`、`PANEL_HOST`、`PANEL_PASSWORD`、`ENABLE_WECHAT=y|n`、`DRY_RUN=1`（只顯示指令，不實際執行）。再次執行腳本會升級既有的程式目錄，並保留已儲存的密碼。

也可以手動安裝：

```bash
cp .env.example .env
# 編輯 .env，設定 PANEL_PASSWORD 與 PANEL_HOST
cp deploy/Caddyfile.domain Caddyfile   # 若主機只有 IP，請改用 deploy/Caddyfile.ip
docker compose up -d --build
docker compose logs -f
```

開啟 `https://<PANEL_HOST>:8443`，以 `PANEL_PASSWORD` 登入，再到面板設定 Instagram 帳號、目標對象、擷取間隔與貼文數量上限。

## 平台設定

每個平台都能分別設定是否啟用、輪詢間隔、每位使用者最近檢查的貼文數量，以及自動清理天數；設為 `0` 天即停用自動清理。停用的平台會停止擷取，並從手機導覽列隱藏。

已啟用的平台會依序開啟瀏覽器工作階段，以免超出 VPS 的記憶體限制。媒體庫分為 Instagram、TikTok、抖音、Threads、X 與全部平台檢視。

## TikTok

在設定中選擇 **TikTok**，輸入目標使用者名稱，再選擇驗證方式：

- **帳號密碼：**輸入 TikTok 帳號與密碼。兩者都留空時，系統會嘗試讀取公開個人頁面。
- **Cookie：**先用自己的瀏覽器登入 TikTok，開啟開發人員工具的「網路」頁籤，選擇送往 `www.tiktok.com` 的請求，再複製 `Cookie` 請求標頭的值。只需將值貼到面板，例如 `sessionid=...; sessionid_ss=...`；欄位留空會保留先前儲存的 Cookie。

如果 TikTok 要求輸入驗證碼，可直接在面板提交。若出現 CAPTCHA 或需要人工處理的驗證，面板會連同螢幕截圖標示為需要留意；帳號密碼無法完成登入時，請改用 Cookie 匯入。若 TikTok 回報登入嘗試次數過多，系統會暫停重試密碼，直到你儲存更新後的設定、重設 TikTok 工作階段，或切換為 Cookie 登入。

私人帳號需要一個原本就有權限查看的有效工作階段。Cookie 過期或媒體遺失時會回報失敗；未完整下載的內容不會被標記為已封存，而會在之後重新嘗試。

## 抖音

在設定中選擇 **抖音**，貼上一或多個完整的 `https://www.douyin.com/user/...` 個人頁面連結。面板會擷取並保留區分大小寫的 `sec_user_id`；顯示名稱與抖音號可能重複，因此不接受作為擷取依據。

公開模式會使用個人頁面本身產生並簽署的瀏覽器請求。如果抖音顯示登入牆或風險驗證，請先在自己的瀏覽器登入 `www.douyin.com`，複製完整的 `Cookie` 請求標頭值，再切換為 **Cookie** 登入。Cookie 通常包含 `sessionid`、`ttwid`、`odin_tt` 與 `s_v_web_id`。圖集、影片與動態照片片段都會封存在 `data/douyin/`。

**QR Code** 登入不需要複製瀏覽器 Cookie。先儲存面板中受保護的 QR Code 預覽，再於同一支手機開啟抖音掃描器，從照片中選取剛才的圖片。伺服器會讓瀏覽器工作階段保持開啟兩分鐘，成功後只把工作階段儲存在 `data/douyin/profile/`，確認後繼續擷取。抖音可能拒絕來自資料中心或海外 IP 的確認請求。

**手機號碼**登入會將驗證碼傳送到中國大陸門號。請保持面板開啟，在驗證區輸入代碼；擷取器會在同一個持續運作的瀏覽器頁面完成登入。驗證碼使用後立刻清除，絕不儲存至 `config.json`。抖音有時會暗中攔截自動化瀏覽器或資料中心瀏覽器發出的簡訊請求；面板會檢查實際傳送結果並如實回報，不會顯示假的等待狀態。

## Threads

在設定中選擇 **Threads**，輸入目標使用者名稱。公開個人頁面不需要憑證；如果頁面需要工作階段，則可使用帳號密碼或 Cookie。Threads 使用獨立的瀏覽器設定檔與 `data/threads/` 封存，不會和 Instagram 或 TikTok 混用。

含圖片或影片的貼文會沿用既有輪播與原生播放器。純文字貼文也不會被略過：擷取器會把完整文字儲存在 `metadata.json` 與 `content.txt`，保留頁面螢幕截圖，並在 **文字** 媒體篩選器中顯示為可下載卡片。

## 微信朋友圈

微信朋友圈功能會使用主機上官方 Linux 微信的資料目錄。一次性的 SNS 專用金鑰登記只會驗證本機 `sns.db`；之後擷取器只匯入你明確選取的好友 wxid，以及對應的文字、原始圖片與影片至 `data/wechat/`。聊天內容、聯絡人、留言、按讚、位置、原始 XML、CDN Token 與資料庫金鑰絕不會複製進 IG Luv 的資料目錄。

主機需要官方 Linux 微信、Python 3、`python3-pycryptodome`、`python3-zstandard`、Node.js、經過檢查的外部 SNS 匯出與媒體工具，以及一把儲存在 IG Luv 資料目錄之外、已通過驗證的 SNS 金鑰。在 `install.sh` 選擇啟用微信後，腳本會安裝上述元件、建立 `wechat` 使用者、設定 Xvfb/XFCE VNC 遠端桌面與由面板驗證的 `/wechat` noVNC 頁面、安裝 `deploy/ig-luv-wechat.service` 和兩個桌面服務，並執行一次性金鑰登記。

擷取器會從 `/etc/ig-luv/wechat.env` 讀取 `WECHAT_ACCOUNT_DIR` 與其他路徑；服務也會透過 `ExecStartPre`，為 `wechat` 使用者建立 `/opt/ig-luv/data/wechat`。微信平台預設停用，必須先從面板的作者清單選取穩定的 wxid 才能啟用；平台停用時仍會搜尋作者候選人，但不會匯入貼文。

## X

在設定中選擇 **X**，輸入不含 `@` 的目標帳號代稱。系統可以嘗試讀取公開個人頁面，但 X 經常限制未登入或來自資料中心的流量。若要提高擷取穩定性，請先在自己的瀏覽器登入 `x.com`，從任一 X 網路請求複製完整的 `Cookie` 請求標頭值，再使用 **Cookie** 登入。Cookie 通常應包含 `auth_token` 與 `ct0`。

X 使用獨立的瀏覽器設定檔與 `data/x/` 封存。包含多張圖片、MP4 影片或 GIF 動畫的貼文會使用既有圖庫與播放器。純文字貼文會儲存在 `content.txt`，並顯示於 **文字** 篩選器。舊式 `twitter.com/<handle>/status/<id>` 連結也能辨識，並會統一轉換為 `x.com`。

## 資料

所有資料都儲存在 `data/`：

- `data/config.json`：擷取設定與 Instagram 登入資料，檔案權限僅限擁有者。
- `data/profile/`：持續保留的 Chromium 設定檔與 Instagram 工作階段。
- `data/status.json`：擷取器目前的最新狀態。
- `data/targets/<username>/`：個人頁面螢幕截圖、各目標狀態與已封存項目。
- `data/tiktok/`：TikTok 瀏覽器設定檔、看過的貼文 ID、驗證資料、螢幕截圖與 `targets/` 封存。
- `data/douyin/`：抖音瀏覽器設定檔、看過的貼文 ID、螢幕截圖與 `targets/` 封存。
- `data/threads/`：Threads 瀏覽器設定檔、看過的貼文 ID、驗證資料、螢幕截圖與 `targets/` 封存。
- `data/x/`：X 瀏覽器設定檔、看過的貼文 ID、螢幕截圖與 `targets/` 封存。
- `data/wechat/`：所選好友已匯入的微信朋友圈、作者清單與主機端擷取器狀態。
- `data/config.json` 保留原有 Instagram 欄位，並另外加入 `tiktok`、`douyin`、`threads` 與 `x` 物件。

Git 會忽略 `data/`。如果想保留工作階段與封存內容，請自行備份。

## 圖片檢視器

面板提供可直接載入的獨立頁面：`/` 顯示全部平台，其他頁面則為 `/instagram`、`/tiktok`、`/douyin`、`/threads`、`/x`、`/moments` 與 `/settings`。桌面導覽包含所有路由；手機導覽列在空間不足時可水平捲動。點一下 `IG Luv` 字樣即可回到全部平台檢視。

設定頁會把平台與登入、目標使用者、擷取頻率分成原生可展開區塊，預設全部收合。設定內容不再出現在媒體下方。Instagram、TikTok、Threads 與 X 圖示取自本機的 Simple Icons（CC0-1.0）；抖音則使用本機音符圖示。

頁首的重新整理按鈕旁有一個精簡的 [LeiBox Pixel 日夜切換器](https://leibox.pantoria.cn/docs/animations/pixel-toggle)。它保留原版 Canvas2D 粒子、拖曳／觸控與鍵盤操作，但在面板中關閉音效。選擇的亮色或暗色主題只儲存在目前的瀏覽器，會同步桌面與手機上的開關，並更新瀏覽器主題色彩。元件原始碼與來源聲明位於 `static/components/pixel-toggle/`。

圖片與螢幕截圖每批最多 12 張。點擊圖片左半側可看上一張，右半側可看下一張，擴散效果會從按下的位置開始。也能使用向左／向右方向鍵、Home 與 End；按 Enter 或空白鍵會前往下一張。每個輪播下方的操作都會套用到目前圖片，影片則保留原生播放控制項。

原始圖片與影片可直接在頁面內預覽。桌面使用置中的檢視器，手機則採全螢幕檢視。可透過關閉按鈕、Escape 或瀏覽器上一頁關閉；關閉時會停止播放與載入，並恢復原本的捲動位置與焦點。手機檢視器會移除周圍多餘留白，讓圖片幾乎填滿螢幕寬度。

檢視器使用本機 WebGL shader，無法使用時會退回 Canvas2D 擴散效果，並遵循「減少動態效果」偏好。完整原始碼、聲明與內嵌的預設示範圖集位於 `static/components/ink-spread-carousel/`；執行時不依賴 LeiBox 或外部資源。

圖片、影片、文字與螢幕截圖各自位於可收合區塊。圖片預設展開，其餘區塊預設收合。首頁螢幕截圖可逐張刪除；設定頁也能依平台刪除所有首頁／貼文螢幕截圖與 MP4 檔案，同時保留原始圖片、文字與中繼資料。自動清理會依各檔案的存在天數判斷；設為 `0` 天即可停用。

## 檢視器測試

安裝 Playwright 與它使用的 Chromium 瀏覽器，即可執行獨立的迴歸測試：

```bash
npm install --no-save playwright
npx playwright install chromium
node test_carousel.mjs
python -m pip install httpx
python -m unittest -v test_platforms.py
```

測試使用本機產生的合成圖片與 API 測試資料，不會存取或修改 VPS 上的資料。它會檢查擴散色彩、快速中斷、鍵盤與觸控、圖片載入失敗、頁面可見性暫停、減少動態效果、WebGL 環境復原、資源釋放、圖庫操作，以及 375／768／1440 三種版面寬度。在 375px 寬度下，還會確認圖片至少有 350px 寬，且左右觸控區域足夠大。可透過 `ARTIFACT_DIR` 指定螢幕截圖的儲存位置。

Python 測試涵蓋已儲存憑證的隱私、設定保留、同名目標隔離、平台範圍內的刪除／驗證／重設、TikTok 媒體解析，以及各擷取器彼此獨立的失敗處理。

## 注意事項

- 請只用自己的帳號登入；系統會重複使用工作階段，直到 Instagram 判定失效。
- 如果 Instagram 要求驗證碼，請到面板設定中輸入。
- 如果 Instagram 要求額外挑戰或人工確認，請查看面板顯示的登入螢幕截圖。
- 只可擷取你有權存取的內容，並使用 Instagram 允許的輪詢間隔。
