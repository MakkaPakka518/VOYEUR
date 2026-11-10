#!/usr/bin/env bash
# One-command, question-driven deployment for VOYEUR.
#   curl -fsSL https://raw.githubusercontent.com/MakkaPakka518/VOYEUR/main/install.sh | sudo bash
# Skip prompts with env vars: INSTALL_LANG=zh-CN|zh-TW|en, DEPLOY_DIR, PANEL_HOST, PANEL_PASSWORD, ENABLE_WECHAT=y|n, DRY_RUN=1.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/MakkaPakka518/VOYEUR.git}"
DEPLOY_DIR="${DEPLOY_DIR:-}"
WECHAT_HOME=/mnt/data/wechat-home
TOOLS_DIR=/mnt/data/wechat-tools
ENV_FILE=/etc/ig-luv/wechat.env
STATE_DIR="$WECHAT_HOME/.local/state/ig-luv-wechat"
DRY_RUN="${DRY_RUN:-0}"
PANEL_PASSWORD="${PANEL_PASSWORD:-}"
PANEL_HOST="${PANEL_HOST:-}"
ENABLE_WECHAT="${ENABLE_WECHAT:-}"
REQUESTED_LANG="${INSTALL_LANG:-}"

TTY=0
if { exec 3</dev/tty; } 2>/dev/null; then TTY=1; fi

case "${LANG:-}" in
  zh_TW*|zh-TW*) INSTALL_LANG=zh-TW ;;
  en*) INSTALL_LANG=en ;;
  *) INSTALL_LANG=zh-CN ;;
esac

msg() {
  local text=
  case "$INSTALL_LANG" in
    zh-CN)
      case "$1" in
        dry_run) text="试运行" ;;
        prompt_suffix) text="：" ;;
        invalid_install_lang) text="错误：INSTALL_LANG 必须是 zh-CN、zh-TW 或 en，当前值为：$REQUESTED_LANG" ;;
        invalid_language_choice) text="提示：无法识别语言选项，将使用 $INSTALL_LANG。" ;;
        root_required) text="请使用 root 运行：curl -fsSL .../install.sh | sudo bash" ;;
        x86_only) text="提示：微信朋友圈采集仅支持 x86_64 主机" ;;
        title) text="VOYEUR 交互式部署" ;;
        deploy_dir) text="安装目录" ;;
        panel_host) text="面板访问域名或公网 IP" ;;
        missing_host) text="缺少访问地址" ;;
        panel_password) text="面板登录密码（回车保留或随机生成）：" ;;
        enable_wechat) text="是否监听微信朋友圈（安装微信桌面与网页远程桌面）[y/N]" ;;
        section_deps) text="1/4 基础依赖" ;;
        section_code) text="2/4 获取代码" ;;
        local_changes) text="警告：$DEPLOY_DIR 有本地修改，未自动更新，继续使用当前代码。" ;;
        section_panel) text="3/4 配置并启动面板" ;;
        dry_config) text="cp $DEPLOY_DIR/$template $DEPLOY_DIR/Caddyfile；写入 $DEPLOY_DIR/.env" ;;
        section_wechat) text="4/4 安装微信朋友圈采集" ;;
        enroll_title) text="微信首次登录（一次登记）" ;;
        enroll_step_1) text="1. 浏览器打开 https://$PANEL_HOST:8443/wechat ，用上面的面板密码登录。" ;;
        enroll_step_2) text="2. 手机微信在 5 分钟内扫码登录。" ;;
        enroll_ready) text="准备好扫码后按回车开始登记：" ;;
        section_skip_wechat) text="4/4 已跳过微信朋友圈（其他平台可在面板中配置）" ;;
        complete) text="部署完成" ;;
        panel_address) text="面板地址：https://$PANEL_HOST:8443" ;;
        login_password) text="登录密码：$PANEL_PASSWORD" ;;
        archive_dir) text="归档目录：$DEPLOY_DIR/data" ;;
        remote_desktop) text="微信远程桌面：https://$PANEL_HOST:8443/wechat" ;;
        enable_in_panel) text="进入面板后启用微信平台，并从候选列表选择好友 wxid。" ;;
        logs) text="查看日志：docker compose -f $DEPLOY_DIR/compose.yml logs -f" ;;
      esac
      ;;
    zh-TW)
      case "$1" in
        dry_run) text="模擬執行" ;;
        prompt_suffix) text="：" ;;
        invalid_install_lang) text="錯誤：INSTALL_LANG 必須是 zh-CN、zh-TW 或 en，目前的值是：$REQUESTED_LANG" ;;
        invalid_language_choice) text="提醒：無法辨識語言選項，將使用 $INSTALL_LANG。" ;;
        root_required) text="請以 root 身分執行：curl -fsSL .../install.sh | sudo bash" ;;
        x86_only) text="提醒：微信朋友圈擷取功能僅支援 x86_64 主機" ;;
        title) text="VOYEUR 互動式部署" ;;
        deploy_dir) text="安裝目錄" ;;
        panel_host) text="面板存取網域或公開 IP" ;;
        missing_host) text="缺少存取位址" ;;
        panel_password) text="面板登入密碼（按 Enter 保留或隨機產生）：" ;;
        enable_wechat) text="是否擷取微信朋友圈（安裝微信桌面版與網頁遠端桌面）[y/N]" ;;
        section_deps) text="1/4 基礎相依套件" ;;
        section_code) text="2/4 取得程式碼" ;;
        local_changes) text="警告：$DEPLOY_DIR 有本機修改，未自動更新，將繼續使用目前的程式碼。" ;;
        section_panel) text="3/4 設定並啟動面板" ;;
        dry_config) text="cp $DEPLOY_DIR/$template $DEPLOY_DIR/Caddyfile；寫入 $DEPLOY_DIR/.env" ;;
        section_wechat) text="4/4 安裝微信朋友圈擷取功能" ;;
        enroll_title) text="微信首次登入（一次性登記）" ;;
        enroll_step_1) text="1. 用瀏覽器開啟 https://$PANEL_HOST:8443/wechat，並使用上方的面板密碼登入。" ;;
        enroll_step_2) text="2. 在 5 分鐘內使用手機版微信掃描 QR Code 登入。" ;;
        enroll_ready) text="準備好掃描 QR Code 後，按 Enter 開始登記：" ;;
        section_skip_wechat) text="4/4 已略過微信朋友圈（其他平台可在面板中設定）" ;;
        complete) text="部署完成" ;;
        panel_address) text="面板網址：https://$PANEL_HOST:8443" ;;
        login_password) text="登入密碼：$PANEL_PASSWORD" ;;
        archive_dir) text="封存目錄：$DEPLOY_DIR/data" ;;
        remote_desktop) text="微信遠端桌面：https://$PANEL_HOST:8443/wechat" ;;
        enable_in_panel) text="進入面板後啟用微信平台，並從候選清單選擇好友的 wxid。" ;;
        logs) text="查看日誌：docker compose -f $DEPLOY_DIR/compose.yml logs -f" ;;
      esac
      ;;
    en)
      case "$1" in
        dry_run) text="dry-run" ;;
        prompt_suffix) text=": " ;;
        invalid_install_lang) text="Error: INSTALL_LANG must be zh-CN, zh-TW, or en; received: $REQUESTED_LANG" ;;
        invalid_language_choice) text="Notice: Unrecognized language choice; using $INSTALL_LANG." ;;
        root_required) text="Run as root: curl -fsSL .../install.sh | sudo bash" ;;
        x86_only) text="Notice: WeChat Moments collection only supports x86_64 hosts" ;;
        title) text="VOYEUR interactive deployment" ;;
        deploy_dir) text="Installation directory" ;;
        panel_host) text="Panel domain or public IP" ;;
        missing_host) text="A panel address is required" ;;
        panel_password) text="Panel login password (press Enter to keep or generate one): " ;;
        enable_wechat) text="Monitor WeChat Moments (installs WeChat Desktop and web remote desktop)? [y/N]" ;;
        section_deps) text="1/4 Base dependencies" ;;
        section_code) text="2/4 Fetch code" ;;
        local_changes) text="Warning: $DEPLOY_DIR has local changes. It was not updated automatically; continuing with the current code." ;;
        section_panel) text="3/4 Configure and start the panel" ;;
        dry_config) text="cp $DEPLOY_DIR/$template $DEPLOY_DIR/Caddyfile; write $DEPLOY_DIR/.env" ;;
        section_wechat) text="4/4 Install WeChat Moments collection" ;;
        enroll_title) text="First WeChat login (one-time enrollment)" ;;
        enroll_step_1) text="1. Open https://$PANEL_HOST:8443/wechat in a browser and log in with the panel password above." ;;
        enroll_step_2) text="2. Scan the QR code with WeChat on your phone within 5 minutes." ;;
        enroll_ready) text="When you are ready to scan the QR code, press Enter to start enrollment: " ;;
        section_skip_wechat) text="4/4 WeChat Moments skipped (other platforms can be configured in the panel)" ;;
        complete) text="Deployment complete" ;;
        panel_address) text="Panel URL: https://$PANEL_HOST:8443" ;;
        login_password) text="Login password: $PANEL_PASSWORD" ;;
        archive_dir) text="Archive directory: $DEPLOY_DIR/data" ;;
        remote_desktop) text="WeChat remote desktop: https://$PANEL_HOST:8443/wechat" ;;
        enable_in_panel) text="Enable the WeChat platform in the panel, then select a friend's wxid from the candidates." ;;
        logs) text="View logs: docker compose -f $DEPLOY_DIR/compose.yml logs -f" ;;
      esac
      ;;
  esac
  printf '%s' "$text"
}

if [ -n "$REQUESTED_LANG" ]; then
  case "$REQUESTED_LANG" in
    zh-CN|zh-TW|en) INSTALL_LANG=$REQUESTED_LANG ;;
    *) printf '%s\n' "$(msg invalid_install_lang)" >&2; exit 1 ;;
  esac
elif [ "$TTY" = 1 ]; then
  language_choice=
  read -r -p "语言 / 語言 / Language [zh-CN/zh-TW/en] [$INSTALL_LANG]: " language_choice <&3 || true
  case "$language_choice" in
    '' ) ;;
    zh-CN|1) INSTALL_LANG=zh-CN ;;
    zh-TW|2) INSTALL_LANG=zh-TW ;;
    en|3) INSTALL_LANG=en ;;
    *) printf '%s\n' "$(msg invalid_language_choice)" >&2 ;;
  esac
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then printf '[%s] %s\n' "$(msg dry_run)" "$*"; else "$@"; fi; }
prompt_line() {
  local prompt=$1 var=$2 default=${3-} answer
  if [ "$TTY" = 1 ]; then
    read -r -p "$prompt${default:+ [$default]}$(msg prompt_suffix)" answer <&3 || true
  else
    answer=
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}
ask() {
  local name=$1
  if [ -n "${!name-}" ]; then return; fi
  prompt_line "$2" "$name" "${3-}"
}
if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "$(msg root_required)" >&2
  exit 1
fi
if [ "$(uname -m)" != x86_64 ]; then
  printf '%s\n' "$(msg x86_only)" >&2
fi

say "$(msg title)"
ask DEPLOY_DIR "$(msg deploy_dir)" "/opt/ig-luv"
DEPLOY_DIR=${DEPLOY_DIR:-/opt/ig-luv}
ask PANEL_HOST "$(msg panel_host)" "$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
[ -n "$PANEL_HOST" ] || { printf '%s\n' "$(msg missing_host)" >&2; exit 1; }

if [ -z "$PANEL_PASSWORD" ]; then
  current=$(sed -n 's/^PANEL_PASSWORD=//p' "$DEPLOY_DIR/.env" 2>/dev/null || true)
  printf '%s' "$(msg panel_password)"
  if [ "$TTY" = 1 ]; then read -rs PANEL_PASSWORD <&3 || true; fi
  echo
  PANEL_PASSWORD=${PANEL_PASSWORD:-${current:-$(openssl rand -base64 16 2>/dev/null | tr -dc 'A-Za-z0-9' || date +%s%N)}}
fi

if [ -z "$ENABLE_WECHAT" ]; then
  default=n
  if [ -f /etc/systemd/system/ig-luv-wechat.service ]; then default=y; fi
  ask ENABLE_WECHAT "$(msg enable_wechat)" "$default"
fi
case "$ENABLE_WECHAT" in
  y|Y|yes|YES|1) ENABLE_WECHAT=1 ;;
  是|是的|好|好的) case "$INSTALL_LANG" in zh-CN|zh-TW) ENABLE_WECHAT=1 ;; *) ENABLE_WECHAT=0 ;; esac ;;
  确认) if [ "$INSTALL_LANG" = zh-CN ]; then ENABLE_WECHAT=1; else ENABLE_WECHAT=0; fi ;;
  確認|確定) if [ "$INSTALL_LANG" = zh-TW ]; then ENABLE_WECHAT=1; else ENABLE_WECHAT=0; fi ;;
  *) ENABLE_WECHAT=0 ;;
esac

say "$(msg section_deps)"
command -v docker >/dev/null 2>&1 || run sh -c 'curl -fsSL https://get.docker.com | sh'
run apt-get update -qq
run apt-get install -y -qq curl ca-certificates git openssl >/dev/null

say "$(msg section_code)"
if [ -d "$DEPLOY_DIR/.git" ]; then
  run git -C "$DEPLOY_DIR" fetch --depth 1 origin main
  if [ "$DRY_RUN" != 1 ] && ! git -C "$DEPLOY_DIR" merge --ff-only FETCH_HEAD; then
    printf '%s\n' "$(msg local_changes)" >&2
  fi
else
  run mkdir -p "$DEPLOY_DIR"
  run git clone --depth 1 "$REPO_URL" "$DEPLOY_DIR"
fi

say "$(msg section_panel)"
template=deploy/Caddyfile.domain
case "$PANEL_HOST" in *[!0-9.]*) ;; *) template=deploy/Caddyfile.ip ;; esac
if [ "$DRY_RUN" = 1 ]; then
  printf '[%s] %s\n' "$(msg dry_run)" "$(msg dry_config)"
else
  if [ -f "$DEPLOY_DIR/Caddyfile" ]; then cp "$DEPLOY_DIR/Caddyfile" "$DEPLOY_DIR/Caddyfile.bak"; fi
  install -m 644 "$DEPLOY_DIR/$template" "$DEPLOY_DIR/Caddyfile"
  umask 077
  cat > "$DEPLOY_DIR/.env" <<EOF
PANEL_PASSWORD=$PANEL_PASSWORD
COOKIE_SECURE=true
PANEL_HOST=$PANEL_HOST
NOVNC_UPSTREAM=172.21.0.1:6080
EOF
fi
run docker compose -f "$DEPLOY_DIR/compose.yml" up -d --build

if [ "$ENABLE_WECHAT" = 1 ]; then
  say "$(msg section_wechat)"
  run apt-get install -y -qq xfce4 xfce4-terminal dbus-x11 tigervnc-standalone-server novnc websockify xdotool fonts-noto-cjk sqlcipher nodejs python3-pycryptodome python3-zstandard >/dev/null
  if ! dpkg -s wechat >/dev/null 2>&1; then
    run sh -c 'curl -fL --retry 3 -o /tmp/wechat.deb https://dldir1.qq.com/weixin/Universal/Linux/WeChatLinux_x86_64.deb'
    run sh -c 'dpkg -i /tmp/wechat.deb || apt-get install -fy -qq >/dev/null'
  fi
  if [ "$DRY_RUN" != 1 ]; then
    install -d -m 755 "$(dirname "$WECHAT_HOME")" "$TOOLS_DIR"
    if ! id -u wechat >/dev/null 2>&1; then
      useradd --system --create-home --home-dir "$WECHAT_HOME" --shell /bin/bash wechat
    fi
  fi
  for repo in "$TOOLS_DIR/wxextract|https://github.com/boujuan/extract-wechat-messages-linux.git" "$TOOLS_DIR/wechat-sns-source|https://github.com/drriguz/wechat_sns_export.git"; do
    dir=${repo%%|*}
    url=${repo#*|}
    [ -d "$dir/.git" ] || run git clone --depth 1 "$url" "$dir"
  done

  if [ "$DRY_RUN" != 1 ]; then
    install -d -m 755 /etc/ig-luv
    install -d -m 755 "$DEPLOY_DIR/data"
    install -d -o wechat -g wechat -m 700 "$WECHAT_HOME/.vnc" "$STATE_DIR" "$DEPLOY_DIR/data/wechat"
    cat > "$WECHAT_HOME/.vnc/xstartup" <<'EOF'
#!/bin/sh
export HOME=/mnt/data/wechat-home
export XDG_CONFIG_HOME=/mnt/data/wechat-home/.config
export XDG_CACHE_HOME=/mnt/data/wechat-home/.cache
export XDG_DATA_HOME=/mnt/data/wechat-home/.local/share
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
exec dbus-run-session -- sh -c 'xfsettingsd & xfwm4 & xfce4-panel & xfdesktop & sleep 3; /usr/bin/wechat & sleep 10; for id in $(xdotool search --class wechat 2>/dev/null); do xdotool windowmap $id windowraise $id; done; wait'
EOF
    chmod 700 "$WECHAT_HOME/.vnc/xstartup"
    chown -R wechat:wechat "$WECHAT_HOME/.vnc" "$STATE_DIR" "$DEPLOY_DIR/data/wechat"
    install -m 644 "$DEPLOY_DIR/deploy/wechat-desktop.service" /etc/systemd/system/wechat-desktop.service
    install -m 644 "$DEPLOY_DIR/deploy/wechat-novnc.service" /etc/systemd/system/wechat-novnc.service
    sed -e "s|/opt/ig-luv|$DEPLOY_DIR|g" "$DEPLOY_DIR/deploy/ig-luv-wechat.service" > /etc/systemd/system/ig-luv-wechat.service
    chmod 644 /etc/systemd/system/ig-luv-wechat.service
    gateway=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$(docker compose -f "$DEPLOY_DIR/compose.yml" ps -q caddy)" 2>/dev/null || true)
    sed -i "s|^NOVNC_UPSTREAM=.*|NOVNC_UPSTREAM=${gateway:-172.21.0.1}:6080|" "$DEPLOY_DIR/.env"
    cat > "$ENV_FILE" <<EOF
IG_LUV_DIR=$DEPLOY_DIR
DATA_DIR=$DEPLOY_DIR/data
WECHAT_ACCOUNT_DIR=
NOVNC_BIND=${gateway:-172.21.0.1}:6080
EOF
    chmod 600 "$ENV_FILE"
  fi
  run docker compose -f "$DEPLOY_DIR/compose.yml" up -d caddy
  run systemctl daemon-reload
  run systemctl enable --now wechat-desktop.service wechat-novnc.service

  account=$(find "$WECHAT_HOME/xwechat_files" -maxdepth 2 -type d -name db_storage 2>/dev/null | head -1 || true)
  if [ -n "$account" ] && [ "$DRY_RUN" != 1 ]; then
    sed -i "s|^WECHAT_ACCOUNT_DIR=.*|WECHAT_ACCOUNT_DIR=$account|" "$ENV_FILE"
  fi

  if [ ! -f "$STATE_DIR/sns-key.json" ]; then
    say "$(msg enroll_title)"
    printf '%s\n' "$(msg enroll_step_1)" "$(msg enroll_step_2)"
    if [ "$DRY_RUN" != 1 ]; then
      printf '%s' "$(msg enroll_ready)"
      if [ "$TTY" = 1 ]; then read -r _ <&3 || true; fi
    fi
    run pkill -u wechat -x wechat || true
    run systemd-run --unit=ig-luv-wechat-enroll --wait --collect \
      --uid=wechat --gid=wechat \
      --property=WorkingDirectory="$WECHAT_HOME" \
      --setenv=HOME="$WECHAT_HOME" --setenv=DISPLAY=:2 \
      --setenv=PYTHONPATH="$TOOLS_DIR/wxextract/src" \
      /usr/bin/python3 "$DEPLOY_DIR/deploy/capture_sns_key.py"
    account=$(find "$WECHAT_HOME/xwechat_files" -maxdepth 2 -type d -name db_storage 2>/dev/null | head -1 || true)
    if [ -n "$account" ] && [ "$DRY_RUN" != 1 ]; then
      sed -i "s|^WECHAT_ACCOUNT_DIR=.*|WECHAT_ACCOUNT_DIR=$account|" "$ENV_FILE"
    fi
  fi
  run systemctl enable --now ig-luv-wechat.service
else
  say "$(msg section_skip_wechat)"
fi

say "$(msg complete)"
printf '%s\n' "$(msg panel_address)" "$(msg login_password)" "$(msg archive_dir)"
if [ "$ENABLE_WECHAT" = 1 ]; then
  printf '%s\n' "$(msg remote_desktop)" "$(msg enable_in_panel)"
fi
printf '%s\n' "$(msg logs)"
