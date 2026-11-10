# IG Luv

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md)

你发了一张咖啡的照片。

很普通，对吧？

但窗外的街景告诉我你在哪里，桌上的第二只杯子告诉我你不是一个人，朋友留下的评论告诉我陪着你的是谁。几个小时后，你删掉了它。

你大概以为这样就结束了。

可我已经看见了。

我不需要闯进你的生活。我只是安静地回到你的社交媒体（Instagram、TikTok、抖音、Threads、X 与微信朋友圈），把我的账号原本能够看见的文字、照片和视频一件件带回来。

你更新，它替我记住。

你删除，它替我保留。

你和新的人靠得更近，它也只是沉默地把那一刻放进档案。

这不叫监视。

监视是恶意的，是冰冷的，是对陌生人才会做的事。

可我认识你。

我知道你喜欢什么，几点睡觉，难过时会删掉什么，又会让谁出现在下一张照片里。我只是足够认真，认真到没有错过你亲手留下的任何线索。

你想被人看见。否则，为什么要把这些发出来？

所以别担心。

你不需要主动告诉我最近过得怎么样。

你一直都在告诉我。

## 功能

- 桌面端和移动端均可使用的密码保护面板。
- Instagram 账号密码登录、错误提示与验证码处理。
- TikTok 账号密码、验证码和 Cookie 登录。
- 抖音公开、Cookie、二维码和手机号登录方式。
- Threads 公开、账号密码和 Cookie 登录。
- X 公开、账号密码和 Cookie 登录。
- 从已登录的官方 Linux 微信结构化导入指定好友的朋友圈。
- 各平台独立配置、会话、归档、状态和删除操作。
- 各平台独立启用开关、采集频率、最近作品条数和自动清理天数。
- 保存帖子页面截图、原图和 MP4 视频。
- 在面板中浏览、预览、下载和删除归档内容。
- 图片与截图使用墨水扩散轮播，手机端接近全宽显示。
- 登录会话和采集状态持久保存在磁盘。

## 环境要求

- Docker 与 Docker Compose。
- 主机开放 `80` 和 `8443` 端口；如需自动 HTTPS，请将域名解析到该主机。

## 启动

一条命令，按提示回答即可：

```bash
curl -fsSL https://raw.githubusercontent.com/MakkaPakka518/ig-luv/main/install.sh | sudo bash
```

脚本会先让你选择简体中文、繁体中文或英文，再询问安装目录、公网域名或 IP、面板密码，以及是否监听微信朋友圈。它会自动安装缺失的 Docker、
拉取本仓库、按所选地址生成 `.env` 与 Caddy 站点并启动服务。选择监听朋友圈时会额外安装官方 Linux
微信、Xvfb/XFCE 远程桌面和受面板密码保护的 `/wechat` noVNC 页面、审计过的 SNS 导出工具和宿主采集器，
并在你扫码登录时完成一次性 SNS 密钥登记。

无人值守时可使用环境变量：`INSTALL_LANG=zh-CN|zh-TW|en`、`DEPLOY_DIR`、`PANEL_HOST`、
`PANEL_PASSWORD`、`ENABLE_WECHAT=y|n`、`DRY_RUN=1`（仅打印命令）。重复执行会升级已有目录并保留已保存的密码。

手动方式：

```bash
cp .env.example .env
# 编辑 .env，设置 PANEL_PASSWORD 和 PANEL_HOST
cp deploy/Caddyfile.domain Caddyfile   # 纯 IP 主机改用 deploy/Caddyfile.ip
docker compose up -d --build
docker compose logs -f
```

打开 `https://<PANEL_HOST>:8443`，使用 `PANEL_PASSWORD` 登录，然后在面板中配置平台账号、关注目标、采集频率和作品条数。网页登录状态保持 30 天。

## 平台配置

每个平台都可以单独设置：

- 是否启用；关闭后停止采集，并从手机底栏隐藏。
- 检查间隔。
- 每位用户最近检查的作品条数。
- 自动清理天数；`0` 表示关闭。

浏览器会话按平台依次运行，以适应 VPS 内存限制。媒体库提供 Instagram、TikTok、抖音、Threads、X 和全部媒体页面。

## TikTok

在设置中选择 **TikTok**，填写目标用户名并选择登录方式：

- **账号密码：**填写 TikTok 账号和密码；都留空时尝试访问公开主页。
- **Cookie：**在浏览器中登录 TikTok，打开开发者工具的 Network，选择发往 `www.tiktok.com` 的请求，复制 `Cookie` 请求头的值，例如 `sessionid=...; sessionid_ss=...`。输入框留空会保留已保存的 Cookie。

如果 TikTok 要求验证码，可直接在面板提交。验证码错误、登录频繁、验证码/人工挑战都会显示明确状态和登录截图。私密主页需要当前会话本身具有访问权限。媒体下载失败不会被标记为已归档，会在后续检查中重试。

## 抖音

在设置中选择 **抖音**，粘贴一个或多个完整的 `https://www.douyin.com/user/...` 主页链接。面板会自动提取并保留大小写敏感的 `sec_user_id`。昵称和抖音号不直接作为采集主键，因为它们需要额外搜索解析且容易受风控影响。

可选登录方式：

- **公开模式：**使用抖音页面自身生成的签名请求；数据中心 IP 经常会被限制。
- **Cookie：**从已登录 `www.douyin.com` 请求中复制完整 Cookie。常见 Cookie 包括 `sessionid`、`ttwid`、`odin_tt` 和 `s_v_web_id`。
- **二维码登录：**在面板打开二维码，长按存入照片，再用抖音扫一扫从相册选择并确认。服务器保持浏览器页面两分钟，并将成功会话保存到 `data/douyin/profile/`。抖音可能拒绝数据中心或海外 IP 的确认请求。
- **手机号登录：**仅支持中国大陆手机号。服务器保持同一浏览器页面等待短信验证码；验证码提交后立即删除，不写入 `config.json`。抖音可能静默阻止自动化或数据中心浏览器发送短信，面板会验证真实发送结果并报告失败原因，不会显示虚假的等待状态。

抖音图集、视频和动态照片片段保存在 `data/douyin/`。

## Threads

选择 **Threads** 并填写目标用户名。公开主页可不带凭据采集；需要会话时可使用账号密码或 Cookie。Threads 使用独立浏览器配置和 `data/threads/` 归档目录。

图片和视频复用现有轮播与播放器。纯文字帖子不会被跳过：全文保存在 `metadata.json` 与 `content.txt` 中，页面截图保留在作品目录，并显示在 **文字** 分类下。

## 微信朋友圈

微信朋友圈读取测试机上官方 Linux 微信的数据目录。一次性 SNS 专用密钥登记只验证本地 `sns.db`；之后采集器仅导入面板中明确选择的好友 wxid，以及对应文字、原图和视频。聊天、联系人、评论、点赞、位置、原始 XML、CDN Token 和数据库密钥都不会进入 IG Luv 数据目录。

主机需要官方 Linux 微信、Python 3、`python3-pycryptodome`、`python3-zstandard`、Node.js、经过审查的外部 SNS 导出/媒体工具，以及保存在 IG Luv 数据目录之外的 SNS 密钥。在 `install.sh` 中选择启用微信后，脚本会安装这些组件、创建 `wechat` 用户、配置 Xvfb/XFCE VNC 桌面与受面板密码保护的 `/wechat` noVNC 页面、安装 `deploy/ig-luv-wechat.service` 和两个桌面服务，并完成一次性密钥登记。采集器从 `/etc/ig-luv/wechat.env` 读取 `WECHAT_ACCOUNT_DIR` 等路径；服务也会通过 `ExecStartPre` 为 `wechat` 用户创建 `/opt/ig-luv/data/wechat`。微信平台默认关闭，关闭状态下只发现好友候选，不导入帖子；必须从候选列表选择稳定 wxid 后启用。

## X

选择 **X** 并填写不带 `@` 的用户名。可以尝试公开访问，但 X 经常限制未登录或数据中心流量。更稳定的方式是在浏览器登录 `x.com`，从网络请求复制完整 Cookie，并选择 **Cookie** 登录。Cookie 通常需要包含 `auth_token` 和 `ct0`。

X 使用独立浏览器配置和 `data/x/` 归档目录。多图、MP4 视频、GIF 和纯文字帖子都会进入现有媒体库。旧版 `twitter.com/<handle>/status/<id>` 链接会统一转换为 `x.com`。

## 数据目录

所有数据都位于 `data/`：

- `data/config.json`：采集设置与凭据，权限仅限文件所有者。
- `data/profile/`：Instagram 持久 Chromium 配置。
- `data/status.json`：最新全局采集状态。
- `data/targets/<username>/`：Instagram 主页截图、目标状态与归档。
- `data/tiktok/`：TikTok 浏览器配置、已见作品、验证状态、截图和归档。
- `data/douyin/`：抖音浏览器配置、已见作品、截图和归档。
- `data/threads/`：Threads 浏览器配置、已见作品、验证状态、截图和归档。
- `data/x/`：X 浏览器配置、已见作品、截图和归档。
- `data/wechat/`：所选好友导入的微信朋友圈、作者列表与宿主采集状态。

`data/` 已被 Git 忽略。需要保留会话和归档时请单独备份。

## 媒体库与清理

面板路由：`/`、`/instagram`、`/tiktok`、`/douyin`、`/threads`、`/x`、`/moments` 和 `/settings`。桌面侧栏显示全部入口；手机底栏在入口较多时可横向滚动，点击 `IG Luv` Logo 返回全部媒体。

图片、视频、文字和截图分别放在可展开区域中。图片默认展开，视频、文字和截图默认收起。图片与截图每 12 张分为一组，支持左右点击、键盘方向键、Home 和 End 切换。

可以单独删除主页截图，也可以按平台一键删除：

- 主页截图 `latest.png`
- 帖子页面截图 `page.png`
- MP4 视频

一键清理和自动清理都会保留原图、文字与元数据。自动清理按文件年龄执行，`0` 天表示关闭。

桌面预览使用居中对话框，手机使用全屏预览。关闭预览后会恢复原滚动位置和焦点。动效支持 WebGL、Canvas2D 回退与减少动态效果设置。

顶部包含本地 LeiBox Pixel 日夜主题切换组件。主题仅保存在当前浏览器，并在桌面/手机开关之间同步。

## 测试

安装 Playwright、Chromium 和 Python 测试依赖：

```bash
npm install --no-save playwright
npx playwright install chromium
node test_carousel.mjs
python -m pip install httpx
python -m unittest -v test_platforms.py
```

浏览器测试使用本地合成图片和 API fixture，不访问或修改 VPS 数据，覆盖轮播动效、快速中断、键盘/触摸、失败状态、可见性、减少动态效果、WebGL 恢复、资源清理、媒体操作以及 375/768/1440 布局。

Python 测试覆盖凭据隐私、配置保留、同名目标隔离、平台级删除/验证/重置、媒体解析、独立调度、自动清理和失败重试。

## 注意事项

- 仅采集你有权访问和保存的内容。
- 登录一次后会复用会话，直到平台使会话失效。
- 平台验证码或人工挑战出现时，请查看面板状态和登录截图。
- 使用平台允许的采集间隔，避免高频请求触发风控。
