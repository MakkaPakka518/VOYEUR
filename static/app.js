import { imageGroupsMarkup, syncImageGroups, destroyImageGroups } from './gallery-carousels.js';
import { createMediaPreview } from './media-preview.js';
import { createThemeToggle } from './theme-toggle.js';

const elements = {
  band: document.querySelector('#status-band'),
  statusTitle: document.querySelector('#status-title'),
  statusDetail: document.querySelector('#status-detail'),
  statusTime: document.querySelector('#status-time'),
  statusAction: document.querySelector('#status-action'),
  railState: document.querySelector('#rail-state'),
  library: document.querySelector('#library-content'),
  form: document.querySelector('#settings-form'),
  username: document.querySelector('#ig-username'),
  password: document.querySelector('#ig-password'),
  passwordNote: document.querySelector('#password-note'),
  targets: document.querySelector('#ig-targets'),
  interval: document.querySelector('#interval'),
  enabled: document.querySelector('#platform-enabled'),
  postLimit: document.querySelector('#post-limit'),
  cleanupDays: document.querySelector('#cleanup-days'),
  verificationPanel: document.querySelector('#verification-panel'),
  verificationCode: document.querySelector('#verification-code'),
  toast: document.querySelector('#toast'),
  platform: document.querySelector('#settings-platform'),
  loginMethod: document.querySelector('#login-method'),
  cookie: document.querySelector('#tiktok-cookie'),
};

let hydrated = false;
let activeFilter = 'all';
let lastState;
let librarySignature = '';
let selectedPlatform = 'instagram';
let activePlatform = 'all';
const platformNames = { instagram: 'Instagram', tiktok: 'TikTok', douyin: '抖音', threads: 'Threads', x: 'X', wechat: '微信' };
const preview = createMediaPreview(document.querySelector('#media-preview'));
const themeToggle = createThemeToggle([...document.querySelectorAll('.theme-toggle')]);
const pages = {
  '/': { title: '全部媒体', platform: 'all' },
  '/instagram': { title: 'Instagram', platform: 'instagram' },
  '/tiktok': { title: 'TikTok', platform: 'tiktok' },
  '/threads': { title: 'Threads', platform: 'threads' },
  '/x': { title: 'X', platform: 'x' },
  '/douyin': { title: '抖音', platform: 'douyin' },
  '/moments': { title: '微信朋友圈', platform: 'wechat' },
  '/settings': { title: '设置', platform: 'all' },
};
let currentPage = '';
const pageScroll = new Map(), pageFilters = new Map();

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function notify(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    location.href = '/login';
    throw new Error('登录已失效');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || '请求失败');
  return body;
}

function renderStatus(globalStatus = {}) {
  const settingStatus = globalStatus.platforms?.[selectedPlatform] || (selectedPlatform === 'instagram' ? globalStatus : {});
  let statusPlatform = currentPage === '/settings' ? selectedPlatform : activePlatform;
  if (statusPlatform === 'all' && globalStatus.state === 'error') {
    statusPlatform = Object.keys(globalStatus.platforms || {}).find(platform => globalStatus.platforms[platform].state === 'error') || selectedPlatform;
  }
  const status = statusPlatform === 'all' ? globalStatus : globalStatus.platforms?.[statusPlatform] || (statusPlatform === 'instagram' ? globalStatus : {});
  const brand = platformNames[statusPlatform] || '全部平台';
  const errors = {
    invalid_credentials: ['账号或密码错误', `请在设置中修改 ${brand} 账号或密码后重试`],
    verification_required: ['需要验证码', `输入 ${brand} 发来的验证码以继续登录`],
    invalid_verification: ['验证码错误', '请输入新验证码后再次提交'],
    manual_verification: ['需要确认登录', statusPlatform !== 'instagram' ? '查看登录截图完成验证，或切换 Cookie 登录' : '按登录截图提示完成 Instagram 安全确认'],
    login_page_changed: ['登录页面已变化', `查看登录截图确认 ${brand} 当前页面`],
    tiktok_blocked: ['TikTok 需要处理', status.error || '请完成登录或更新 Cookie'],
    threads_blocked: ['Threads 需要处理', status.error || '请完成登录或更新 Cookie'],
    x_blocked: ['X 需要处理', status.error || '请完成登录或更新 Cookie'],
    douyin_blocked: ['抖音需要处理', status.error || '请更新 Cookie 或完成验证'],
    sms_send_failed: ['短信发送失败', status.error || '请检查手机号后重试'],
    sms_login_required: ['验证码已超时', '重新保存手机号以发送新的验证码'],
    wechat_capture_failed: ['朋友圈采集失败', status.error || '请确认 Linux 微信已登录并可打开朋友圈'],
    rate_limited: [`${brand} 请求过于频繁`, status.error || '请稍后重试或更新 Cookie'],
  };
  const labels = {
    not_configured: ['等待配置', `填写 ${brand} 关注用户后开始采集`],
    running: ['正在检查', '浏览器正在读取关注用户的最新内容'],
    ready: ['采集正常', '会话有效，等待下一次检查'],
    disabled: ['平台已关闭', '不会执行采集，也不会显示在手机底栏'],
    error: ['需要处理', status.error || '检查失败，请查看目标状态'],
  };
  let [title, detail] = errors[status.error_code] || labels[status.state] || labels.not_configured;
  const screenshot = statusPlatform === 'instagram' ? lastState?.login_screenshot : lastState?.[`${statusPlatform}_login_screenshot`];
  if (statusPlatform === 'douyin' && lastState?.config?.douyin?.login_method === 'qrcode' && screenshot && status.state === 'running') {
    const qrState = lastState?.douyin_qr_state;
    title = qrState === 'scanned' ? '已扫码' : qrState === 'confirming' ? '正在完成登录' : '等待扫码';
    detail = qrState === 'scanned' ? '请在抖音 App 中确认登录' : qrState === 'confirming' ? '正在写入登录会话，请稍候' : '长按二维码存入照片，再在抖音扫一扫中从相册选择';
  }
  if (statusPlatform === 'douyin' && lastState?.config?.douyin?.login_method === 'phone' && status.state === 'running') {
    const smsState = lastState?.douyin_sms_state;
    title = smsState === 'sending' ? '正在发送短信' : smsState === 'invalid' ? '验证码错误' : smsState === 'submitting' ? '正在验证' : '等待短信验证码';
    detail = smsState === 'sending' ? '正在等待抖音确认发送结果' : smsState === 'invalid' ? '请输入短信中的新验证码' : smsState === 'submitting' ? '正在完成抖音登录，请稍候' : '验证码已发送，请在设置中输入';
  }
  elements.band.dataset.state = status.state || 'not_configured';
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
  elements.statusTime.textContent = formatDate(status.checked_at || status.started_at);
  elements.railState.textContent = title;
  elements.statusAction.hidden = !screenshot;
  elements.statusAction.href = screenshot || '#';
  elements.statusAction.textContent = statusPlatform === 'douyin' && lastState?.config?.douyin?.login_method === 'qrcode' ? '查看扫码二维码' : '查看登录页面';
  document.querySelector('#verification-title').textContent = `输入 ${platformNames[selectedPlatform]} 验证码`;
  const smsWaiting = selectedPlatform === 'douyin' && elements.loginMethod.value === 'phone' && ['waiting', 'invalid'].includes(lastState?.douyin_sms_state);
  elements.verificationPanel.hidden = (!['verification_required', 'invalid_verification'].includes(settingStatus.error_code) && !smsWaiting)
    || (selectedPlatform !== 'instagram' && elements.loginMethod.value === 'cookie');
}

function previewFor(item) {
  return item.files.find(file => file.kind === 'video') || item.files.find(file => file.name.startsWith('media-')) || item.files[0];
}

function mediaCard(target, item, snapshot = false) {
  const name = target.name, key = target.key || name, platform = target.platform || 'instagram';
  const preview = snapshot ? { name: '主页截图', kind: 'screenshot', url: item.latest } : previewFor(item);
  if (!preview) return '';
  const kind = snapshot ? 'screenshot' : preview.kind;
  const source = kind === 'video'
    ? `<video src="${escapeHtml(preview.url)}" controls preload="metadata"></video>`
    : `<img src="${escapeHtml(preview.url)}" alt="@${escapeHtml(name)} 的${kind === 'screenshot' ? '截图' : '图片'}" loading="lazy">`;
  const title = snapshot ? '主页快照' : item.id;
  const files = snapshot ? [{ name: 'latest.png', url: item.latest }] : item.files;
  const fileLinks = files.map(file => `
    <a href="${escapeHtml(file.url)}?download=1"><span>${escapeHtml(file.name)}</span><small>下载</small></a>`).join('');
  const deleteButton = snapshot ? `<button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(name)}" data-latest="1">删除截图</button>` : `<button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(name)}" data-item="${escapeHtml(item.id)}">删除</button>`;
  return `
    <article class="media-card" data-kind="${kind}" data-media-key="${escapeHtml(key)}:video:${escapeHtml(item.id)}" data-signature="${escapeHtml(JSON.stringify(item))}">
      <div class="media-frame">${source}<span class="file-badge">${kind === 'video' ? '视频' : kind === 'screenshot' ? '截图' : '图片'}</span></div>
      <div class="media-body">
        <div class="media-title"><span>${escapeHtml(title)}</span><time>${snapshot ? '' : formatDate(item.captured_at)}</time></div>
        <p class="caption">${snapshot ? `@${escapeHtml(name)} 最近一次主页检查` : escapeHtml(item.caption || `已归档 ${platformNames[platform]} 内容`)}</p>
        <div class="media-actions">
          <a href="${escapeHtml(preview.url)}" data-preview="${kind === 'video' ? 'video' : 'image'}" data-preview-title="@${escapeHtml(name)} ${escapeHtml(title)}">${kind === 'video' ? '查看视频' : '查看原图'}</a>
          ${!snapshot && item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">原帖</a>` : ''}
          ${deleteButton}
        </div>
        <details class="file-list"><summary>文件 ${files.length}</summary>${fileLinks}</details>
      </div>
    </article>`;
}

function textCard(target, item) {
  const platform = target.platform || 'instagram';
  const textFile = item.files.find(file => file.kind === 'text');
  return `<article class="media-card text-card" data-kind="text" data-media-key="${escapeHtml(target.key || target.name)}:text:${escapeHtml(item.id)}" data-signature="${escapeHtml(JSON.stringify(item))}">
    <div class="media-body">
      <div class="media-title"><span>${escapeHtml(item.id)}</span><time>${formatDate(item.captured_at)}</time></div>
      <p class="text-content">${escapeHtml(item.caption || '纯文字贴文')}</p>
      <div class="media-actions">
        ${item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">原帖</a>` : ''}
        ${textFile ? `<a href="${escapeHtml(textFile.url)}?download=1">下载文字</a>` : ''}
        <button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(target.name)}" data-item="${escapeHtml(item.id)}">删除</button>
      </div>
    </div>
  </article>`;
}

function renderLibrary(library) {
  const hasContent = library.some(target => target.latest || target.items.length);
  if (!hasContent) {
    elements.library.innerHTML = `
      <div class="empty-state"><div><h3>还没有收藏</h3><p>配置 Instagram、TikTok、抖音、Threads、X 或微信，首次检查后内容会出现在这里。</p><a href="/settings" data-route>前往采集设置</a></div></div>`;
    syncImageGroups(elements.library);
    return;
  }
  const template = document.createElement('template');
  const mediaGroup = (kind, label, cards, open = false) => cards ? `<details class="media-kind-group" data-media-group="${kind}"${open ? ' open' : ''}><summary>${label}</summary><div class="media-grid">${cards}</div></details>` : '';
  template.innerHTML = library.map(target => {
    const platform = target.platform || 'instagram', key = target.key || target.name;
    const wechat = platform === 'wechat';
    const profileUrl = platform === 'tiktok' ? `https://www.tiktok.com/@${encodeURIComponent(target.name)}` : platform === 'douyin' ? `https://www.douyin.com/user/${encodeURIComponent(target.name)}` : platform === 'threads' ? `https://www.threads.com/@${encodeURIComponent(target.name)}` : platform === 'x' ? `https://x.com/${encodeURIComponent(target.name)}` : platform === 'instagram' ? `https://www.instagram.com/${encodeURIComponent(target.name)}/` : '';
    const photos = imageGroupsMarkup(target, 'image');
    const screenshots = imageGroupsMarkup(target, 'screenshot');
    const videos = target.items.filter(item => item.files.some(file => file.kind === 'video')).map(item => mediaCard(target, item)).join('');
    const textCards = target.items.filter(item => item.files.some(file => file.kind === 'text') && !item.files.some(file => file.kind === 'video' || (file.kind === 'image' && file.name !== 'page.png'))).map(item => textCard(target, item)).join('');
    const state = target.status.error ? escapeHtml(targetState(target.status)) : target.status.failed_items?.length ? `${target.items.length} 条归档，${target.status.failed_items.length} 条待重试` : `${target.items.length} 条归档`;
    return `<section class="target-block" data-target-key="${escapeHtml(key)}" data-platform="${platform}">
      <div class="target-heading"><h3><span class="platform-name"><svg class="platform-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="/static/icons/platforms.svg#${platform}"/></svg>${platformNames[platform]}</span>${wechat ? escapeHtml(target.display_name || (target.name === 'moments' ? '我的朋友圈' : target.name)) : `@${escapeHtml(target.name)}`} <span class="rail-state">${state}</span></h3><div class="target-actions">${profileUrl ? `<a href="${profileUrl}" target="_blank" rel="noreferrer">打开主页</a>` : ''}<button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(target.name)}">删除此用户</button></div></div>
      <div class="media-groups">${mediaGroup('image', '图片', photos, true)}${mediaGroup('video', '视频', videos)}${mediaGroup('text', '文字', textCards)}${mediaGroup('screenshot', '截图', screenshots)}</div>
    </section>`;
  }).join('');
  // Keep live canvases, focus and video playback intact during status polling.
  const existing = new Map([...elements.library.querySelectorAll('.target-block')].map(node => [node.dataset.targetKey, node]));
  let cursor = elements.library.firstElementChild;
  for (const desired of [...template.content.children]) {
    const section = existing.get(desired.dataset.targetKey) || desired;
    if (section !== desired) {
      const heading = section.querySelector('.target-heading');
      const newHeading = desired.querySelector('.target-heading');
      if (heading.innerHTML !== newHeading.innerHTML) heading.replaceChildren(...newHeading.childNodes);
      const groups = section.querySelector('.media-groups');
      const oldGroups = new Map([...groups.children].map(group => [group.dataset.mediaGroup, group]));
      let nextGroup = groups.firstElementChild;
      for (const wanted of [...desired.querySelector('.media-groups').children]) {
        const group = oldGroups.get(wanted.dataset.mediaGroup) || wanted;
        if (group !== wanted) {
          const grid = group.querySelector('.media-grid');
          const oldCards = new Map([...grid.children].map(card => [card.dataset.mediaKey, card]));
          let nextCard = grid.firstElementChild;
          for (const card of [...wanted.querySelector('.media-grid').children]) {
            const old = oldCards.get(card.dataset.mediaKey);
            const keep = old?.dataset.signature === card.dataset.signature ? old : card;
            if (keep !== nextCard) grid.insertBefore(keep, nextCard);
            nextCard = keep.nextElementSibling;
            oldCards.delete(card.dataset.mediaKey);
            if (old && keep !== old) old.remove();
          }
          oldCards.forEach(card => card.remove());
        }
        if (group !== nextGroup) groups.insertBefore(group, nextGroup);
        nextGroup = group.nextElementSibling;
        oldGroups.delete(wanted.dataset.mediaGroup);
      }
      oldGroups.forEach(group => group.remove());
    }
    if (section !== cursor) elements.library.insertBefore(section, cursor);
    cursor = section.nextElementSibling;
    existing.delete(desired.dataset.targetKey);
  }
  existing.forEach(section => section.remove());
  elements.library.querySelectorAll(':scope > .empty-state, :scope > .loading-grid').forEach(node => node.remove());
  syncImageGroups(elements.library);
  applyFilter();
}

function targetState(status = {}) {
  const error = status.error || '';
  if (error.includes('target requires an authenticated Instagram session')) return '需要有效的 Instagram 登录会话';
  if (error.includes('Instagram login requires attention')) return 'Instagram 登录需要验证';
  return error;
}

function applyFilter() {
  document.querySelectorAll('.target-block').forEach(section => {
    section.hidden = activePlatform !== 'all' && section.dataset.platform !== activePlatform;
  });
  document.querySelectorAll('.media-card').forEach(card => {
    card.hidden = activeFilter !== 'all' && card.dataset.kind !== activeFilter;
  });
  document.querySelectorAll('.media-kind-group').forEach(group => {
    group.hidden = activeFilter !== 'all' && group.dataset.mediaGroup !== activeFilter;
  });
}

function hydrateForm(config) {
  if (hydrated) return;
  const selected = selectedPlatform === 'instagram' ? config : config[selectedPlatform] || {};
  elements.username.value = selected.username || '';
  elements.targets.value = (selected.targets || []).join(', ');
  elements.enabled.checked = selected.enabled !== false;
  elements.interval.value = String(selected.interval || config.interval || 300);
  elements.postLimit.value = String(config.post_limit || 12);
  elements.postLimit.value = String(selected.post_limit || config.post_limit || 12);
  elements.cleanupDays.value = String(selected.cleanup_days || 0);
  elements.password.placeholder = selected.has_password ? '已保存，留空保持不变' : '输入登录密码';
  elements.passwordNote.textContent = selected.has_password ? '已保存，留空保持不变' : `用于建立 ${platformNames[selectedPlatform]} 浏览器会话`;
  elements.loginMethod.value = selectedPlatform === 'wechat' ? 'password' : selected.login_method || 'password';
  elements.cookie.placeholder = selected.has_cookie ? '已保存，留空保持不变' : 'sessionid=...; sessionid_ss=...';
  document.querySelector('#targets-summary').textContent = selected.targets?.length ? `${selected.targets.length} 位用户` : '未设置';
  updateLoginFields();
  hydrated = true;
}

function updateLoginFields() {
  const external = selectedPlatform !== 'instagram', douyin = selectedPlatform === 'douyin', wechat = selectedPlatform === 'wechat';
  const qrOption = document.querySelector('#login-method option[value="qrcode"]');
  const phoneOption = document.querySelector('#login-method option[value="phone"]');
  qrOption.hidden = qrOption.disabled = !douyin;
  phoneOption.hidden = phoneOption.disabled = !douyin;
  if (!douyin && ['qrcode', 'phone'].includes(elements.loginMethod.value)) elements.loginMethod.value = 'password';
  const cookie = external && elements.loginMethod.value === 'cookie', qrcode = douyin && elements.loginMethod.value === 'qrcode', phone = douyin && elements.loginMethod.value === 'phone';
  document.querySelector('#login-method option[value="password"]').textContent = douyin ? '公开模式' : '账号密码';
  document.querySelector('#account-label').textContent = phone ? '中国大陆手机号' : `${platformNames[selectedPlatform]} 账号`;
  document.querySelector('#password-label').textContent = `${platformNames[selectedPlatform]} 密码`;
  document.querySelector('#login-method-field').hidden = !external || wechat;
  document.querySelector('#login-method-label').textContent = `${platformNames[selectedPlatform]} 登录方式`;
  document.querySelector('#cookie-field').hidden = !cookie;
  document.querySelector('#cookie-label').textContent = `${platformNames[selectedPlatform]} Cookie`;
  document.querySelector('#cookie-note').textContent = `从已登录 ${platformNames[selectedPlatform]} 的浏览器网络请求中复制 Cookie 请求头的值。`;
  document.querySelector('#public-note').hidden = (!external || cookie) && !wechat;
  document.querySelector('#public-note').textContent = wechat ? '从加密的 SNS 数据库中仅导入所选好友的文字、原图和视频，不读取聊天内容。' : phone ? '保存设置后会发送短信验证码，并在当前浏览器会话中等待输入。' : qrcode ? '打开二维码后长按图片并“存储到照片”，再用抖音扫一扫从相册选择。二维码有效期约 2 分钟。' : douyin ? '公开访问受限时，请使用手机号、二维码或已登录浏览器的 Cookie。' : `采集公开 ${platformNames[selectedPlatform]} 账号时，账号和密码可以都留空。`;
  elements.username.closest('label').hidden = wechat || cookie || (douyin && !phone);
  elements.password.closest('label').hidden = wechat || cookie || douyin;
  elements.username.required = elements.enabled.checked && (!external || phone);
  elements.targets.required = elements.enabled.checked && !wechat;
  elements.username.placeholder = phone ? '输入 11 位手机号' : selectedPlatform === 'x' ? 'X 用户名' : external ? '邮箱或用户名' : '手机号、邮箱或用户名';
  elements.targets.placeholder = wechat ? '微信昵称或 wxid，多个用逗号分隔' : douyin ? '抖音主页链接或 sec_user_id' : '例如 instagram, natgeo';
  document.querySelector('#targets-note').textContent = wechat ? '从候选列表选择好友 wxid；多个 wxid 用逗号分隔' : douyin ? '粘贴 www.douyin.com/user/... 主页链接，多个用逗号分隔' : '多个用户名用逗号分隔，不需要输入 @';
  document.querySelector('#targets-settings').hidden = false;
  if (wechat) elements.targets.setAttribute('list', 'wechat-authors'); else elements.targets.removeAttribute('list');
  document.querySelector('#reset-session').hidden = wechat;
  document.querySelector('#reset-session').textContent = `重置 ${platformNames[selectedPlatform]} 会话`;
  document.querySelector('#platform-summary').textContent = `${platformNames[selectedPlatform]}${elements.enabled.checked ? '' : '（已关闭）'}`;
  document.querySelector('#schedule-summary').textContent = `${elements.interval.selectedOptions[0]?.textContent || ''}，${elements.postLimit.selectedOptions[0]?.textContent || ''}`;
  renderStatus(lastState?.status || {});
}

function syncPlatformNavigation(config) {
  document.querySelectorAll('.bottom-nav a[data-route]').forEach(link => {
    const platform = pages[link.getAttribute('href')]?.platform;
    const selected = platform === 'instagram' ? config : config[platform];
    link.hidden = platform && platform !== 'all' && selected?.enabled === false;
  });
}

function syncWechatAuthors(authors = []) {
  document.querySelector('#wechat-authors').innerHTML = authors.map(author => `<option value="${escapeHtml(author.id)}">${escapeHtml(author.name || author.id)}</option>`).join('');
}

elements.platform.addEventListener('change', () => {
  selectedPlatform = elements.platform.value;
  hydrated = false;
  elements.password.value = elements.cookie.value = '';
  if (lastState?.config) hydrateForm(lastState.config);
  else updateLoginFields();
  renderStatus(lastState?.status || {});
});
elements.loginMethod.addEventListener('change', updateLoginFields);
elements.enabled.addEventListener('change', updateLoginFields);
elements.interval.addEventListener('change', updateLoginFields);
elements.postLimit.addEventListener('change', updateLoginFields);
elements.form.addEventListener('invalid', event => {
  const group = event.target.closest('details');
  if (group) group.open = true;
}, true);

async function refresh(includeLibrary = true) {
  try {
    lastState = await api(`/api/state?library_data=${includeLibrary}`);
    syncPlatformNavigation(lastState.config);
    syncWechatAuthors(lastState.wechat_authors);
    renderStatus(lastState.status);
    if (lastState.library) {
      const signature = JSON.stringify(lastState.library);
      if (signature !== librarySignature) {
        librarySignature = signature;
        renderLibrary(lastState.library);
      }
    }
    hydrateForm(lastState.config);
  } catch (error) {
    notify(error.message);
  }
}

async function runNow(button) {
  button.disabled = true;
  try {
    await api('/api/run', { method: 'POST' });
    notify('已安排立即检查');
    setTimeout(refresh, 900);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(item => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
  activeFilter = button.dataset.filter;
  pageFilters.set(currentPage, activeFilter);
  if (activeFilter !== 'all') document.querySelectorAll(`.media-kind-group[data-media-group="${activeFilter}"]`).forEach(group => group.open = true);
  applyFilter();
}));

document.querySelector('#run-now').addEventListener('click', event => runNow(event.currentTarget));
document.querySelector('#mobile-run').addEventListener('click', event => runNow(event.currentTarget));

elements.library.addEventListener('click', async event => {
  const button = event.target.closest('.delete-button');
  if (!button) return;
  const target = button.dataset.target;
  const item = button.dataset.item;
  const latest = button.dataset.latest;
  const platform = button.dataset.platform || 'instagram';
  const label = latest ? `删除 @${target} 的主页截图？` : item ? '删除这条内容及其文件？' : `删除 @${target} 的全部截图和归档？`;
  if (!confirm(label)) return;
  button.disabled = true;
  try {
    const path = latest ? `/api/targets/${target}/latest` : item ? `/api/targets/${target}/items/${item}` : `/api/targets/${target}`;
    await api(`${path}?platform=${platform}`, { method: 'DELETE' });
    notify(latest ? '主页截图已删除' : item ? '内容已删除' : '用户记录已删除');
    hydrated = false;
    librarySignature = '';
    await refresh(true);
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
});

elements.form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = elements.form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: selectedPlatform,
        enabled: elements.enabled.checked,
        login_method: elements.loginMethod.value,
        cookie: elements.cookie.value,
        username: selectedPlatform === 'wechat' ? '' : elements.username.value,
        password: elements.password.value,
        targets: elements.targets.value,
        interval: Number(elements.interval.value),
        post_limit: Number(elements.postLimit.value),
        cleanup_days: Number(elements.cleanupDays.value),
      }),
    });
    elements.password.value = elements.cookie.value = '';
    hydrated = false;
    elements.password.placeholder = '已保存，留空保持不变';
    notify('设置已保存，正在连接');
    setTimeout(refresh, 900);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#reset-session').addEventListener('click', async () => {
  try {
    await api(`/api/reset-session?platform=${selectedPlatform}`, { method: 'POST' });
    notify('旧会话将在下一轮清除');
  } catch (error) {
    notify(error.message);
  }
});

document.querySelector('#cleanup-platform').addEventListener('click', async event => {
  if (!confirm(`清理 ${platformNames[selectedPlatform]} 的主页截图、帖子截图和全部视频？原图与文字会保留。`)) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api(`/api/cleanup?platform=${selectedPlatform}`, { method: 'DELETE' });
    notify(`已清理 ${result.screenshots} 张截图、${result.videos} 个视频`);
    librarySignature = '';
    await refresh(true);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#submit-verification').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/api/verification?platform=${selectedPlatform}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: elements.verificationCode.value }),
    });
    elements.verificationCode.value = '';
    notify('验证码已提交，正在继续登录');
    setTimeout(() => refresh(false), 900);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('input, select').forEach(control => control.addEventListener('focus', () => {
  if (innerWidth <= 860) setTimeout(() => control.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260);
}));

function showPage(path, focus = false) {
  path = path in pages ? path : '/';
  if (path === currentPage) return;
  if (currentPage) pageScroll.set(currentPage, window.scrollY);
  preview.close(true);
  document.querySelectorAll('video').forEach(video => video.pause());
  currentPage = path;
  const page = pages[path], settings = path === '/settings';
  activePlatform = page.platform;
  activeFilter = pageFilters.get(path) || 'all';
  document.querySelector('#settings').hidden = !settings;
  document.querySelector('#library').hidden = settings;
  document.querySelector('#page-title').textContent = page.title;
  document.title = `${page.title} — IG Luv`;
  document.querySelector('#page-description').textContent = settings ? '凭据只保存在这台 VPS。成功登录后会复用浏览器会话。' : '关注的动态、截图和原始媒体。';
  const icon = document.querySelector('#page-brand');
  icon.hidden = page.platform === 'all';
  icon.querySelector('use').setAttribute('href', `/static/icons/platforms.svg#${page.platform}`);
  document.querySelectorAll('.side-nav a[data-route], .bottom-nav a[data-route], .mobile-header .wordmark[data-route]').forEach(link => {
    const active = link.getAttribute('href') === path;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  if (innerWidth <= 860) document.querySelector('.bottom-nav a.active:not([hidden])')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  document.querySelectorAll('.filter').forEach(button => {
    const active = button.dataset.filter === activeFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  applyFilter();
  renderStatus(lastState?.status || {});
  window.scrollTo({ top: pageScroll.get(path) || 0, behavior: 'instant' });
  if (focus) document.querySelector('#page-title').focus({ preventScroll: true });
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-route], a[data-preview]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (link.hasAttribute('data-preview')) {
    preview.open({ url: link.getAttribute('href'), kind: link.dataset.preview, title: link.dataset.previewTitle || link.textContent }, link);
  } else {
    const path = new URL(link.href).pathname;
    if (path !== currentPage) {
      window.history.pushState({ page: path }, '', path);
      showPage(path, true);
    }
  }
});
window.addEventListener('popstate', event => {
  if (preview.isOpen) preview.close(true);
  showPage(window.location.pathname);
  if (event.state?.preview) preview.open(event.state.preview, null, false);
});

window.history.scrollRestoration = 'manual';
const initialPath = window.location.hash === '#settings' ? '/settings' : window.location.pathname;
window.history.replaceState({ page: initialPath }, '', initialPath);
showPage(initialPath);

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
refresh();
const statusTimer = setInterval(() => { if (!document.hidden) refresh(false); }, 5000);
const libraryTimer = setInterval(() => { if (!document.hidden) refresh(true); }, 30000);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  clearInterval(statusTimer);
  clearInterval(libraryTimer);
  preview.destroy();
  themeToggle.destroy();
  destroyImageGroups();
});
