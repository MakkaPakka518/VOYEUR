import { imageGroupsMarkup, syncImageGroups, destroyImageGroups } from './gallery-carousels.js';
import { createMediaPreview } from './media-preview.js';
import { createThemeToggle } from './theme-toggle.js';
import { formatDate, initI18n, locale, t } from './i18n.js';

initI18n();
document.querySelectorAll('#post-limit option').forEach(option => { option.textContent = t('settings.posts', { count: option.value }); });

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
const platformNames = { instagram: 'Instagram', tiktok: 'TikTok', douyin: t('nav.douyin'), threads: 'Threads', x: 'X', wechat: locale === 'en' ? 'WeChat' : '微信' };
const preview = createMediaPreview(document.querySelector('#media-preview'));
const themeToggle = createThemeToggle([...document.querySelectorAll('.theme-toggle')]);
const pages = {
  '/': { title: t('page.all'), platform: 'all' },
  '/instagram': { title: 'Instagram', platform: 'instagram' },
  '/tiktok': { title: 'TikTok', platform: 'tiktok' },
  '/threads': { title: 'Threads', platform: 'threads' },
  '/x': { title: 'X', platform: 'x' },
  '/douyin': { title: t('page.douyin'), platform: 'douyin' },
  '/moments': { title: t('page.moments'), platform: 'wechat' },
  '/settings': { title: t('page.settings'), platform: 'all' },
};
let currentPage = '';
const pageScroll = new Map(), pageFilters = new Map();

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);

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
    throw new Error(t('error.sessionExpired'));
  }
  const body = await response.json();
  if (!response.ok) throw new Error(locale === 'zh-CN' && body.detail || t('error.requestFailed'));
  return body;
}

function renderStatus(globalStatus = {}) {
  const settingStatus = globalStatus.platforms?.[selectedPlatform] || (selectedPlatform === 'instagram' ? globalStatus : {});
  let statusPlatform = currentPage === '/settings' ? selectedPlatform : activePlatform;
  if (statusPlatform === 'all' && globalStatus.state === 'error') {
    statusPlatform = Object.keys(globalStatus.platforms || {}).find(platform => globalStatus.platforms[platform].state === 'error') || selectedPlatform;
  }
  const status = statusPlatform === 'all' ? globalStatus : globalStatus.platforms?.[statusPlatform] || (statusPlatform === 'instagram' ? globalStatus : {});
  const brand = platformNames[statusPlatform] || t('status.allPlatforms');
  const serverDetail = locale === 'zh-CN' && status.error || '';
  const errors = {
    invalid_credentials: [t('status.invalidCredentials.title'), t('status.invalidCredentials.detail', { brand })],
    verification_required: [t('status.verificationRequired.title'), t('status.verificationRequired.detail', { brand })],
    invalid_verification: [t('status.invalidVerification.title'), t('status.invalidVerification.detail')],
    manual_verification: [t('status.manualVerification.title'), t(statusPlatform !== 'instagram' ? 'status.manualVerification.external' : 'status.manualVerification.instagram')],
    login_page_changed: [t('status.loginChanged.title'), t('status.loginChanged.detail', { brand })],
    tiktok_blocked: [t('status.blocked.title', { brand: 'TikTok' }), serverDetail || t('status.blocked.detail')],
    threads_blocked: [t('status.blocked.title', { brand: 'Threads' }), serverDetail || t('status.blocked.detail')],
    x_blocked: [t('status.blocked.title', { brand: 'X' }), serverDetail || t('status.blocked.detail')],
    douyin_blocked: [t('status.blocked.title', { brand: platformNames.douyin }), serverDetail || t('status.douyinBlocked.detail')],
    sms_send_failed: [t('status.smsFailed.title'), serverDetail || t('status.smsFailed.detail')],
    sms_login_required: [t('status.smsExpired.title'), t('status.smsExpired.detail')],
    wechat_capture_failed: [t('status.wechatFailed.title'), serverDetail || t('status.wechatFailed.detail')],
    rate_limited: [t('status.rateLimited.title', { brand }), serverDetail || t('status.rateLimited.detail')],
  };
  const labels = {
    not_configured: [t('status.notConfigured.title'), t('status.notConfigured.detail', { brand })],
    running: [t('status.running.title'), t('status.running.detail')],
    ready: [t('status.ready.title'), t('status.ready.detail')],
    disabled: [t('status.disabled.title'), t('status.disabled.detail')],
    error: [t('status.error.title'), serverDetail || t('status.error.detail')],
  };
  let [title, detail] = errors[status.error_code] || labels[status.state] || labels.not_configured;
  const screenshot = statusPlatform === 'instagram' ? lastState?.login_screenshot : lastState?.[`${statusPlatform}_login_screenshot`];
  if (statusPlatform === 'douyin' && lastState?.config?.douyin?.login_method === 'qrcode' && screenshot && status.state === 'running') {
    const qrState = lastState?.douyin_qr_state;
    const key = qrState === 'scanned' ? 'scanned' : qrState === 'confirming' ? 'confirming' : 'waiting';
    title = t(`status.qr.${key}.title`);
    detail = t(`status.qr.${key}.detail`);
  }
  if (statusPlatform === 'douyin' && lastState?.config?.douyin?.login_method === 'phone' && status.state === 'running') {
    const smsState = lastState?.douyin_sms_state;
    const key = ['sending', 'invalid', 'submitting'].includes(smsState) ? smsState : 'waiting';
    title = t(`status.sms.${key}.title`);
    detail = t(`status.sms.${key}.detail`);
  }
  elements.band.dataset.state = status.state || 'not_configured';
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
  elements.statusTime.textContent = formatDate(status.checked_at || status.started_at);
  elements.railState.textContent = title;
  elements.statusAction.hidden = !screenshot;
  elements.statusAction.href = screenshot || '#';
  elements.statusAction.textContent = t(statusPlatform === 'douyin' && lastState?.config?.douyin?.login_method === 'qrcode' ? 'status.viewQr' : 'status.viewLogin');
  document.querySelector('#verification-title').textContent = t('settings.verificationTitle', { brand: platformNames[selectedPlatform] });
  const smsWaiting = selectedPlatform === 'douyin' && elements.loginMethod.value === 'phone' && ['waiting', 'invalid'].includes(lastState?.douyin_sms_state);
  elements.verificationPanel.hidden = (!['verification_required', 'invalid_verification'].includes(settingStatus.error_code) && !smsWaiting)
    || (selectedPlatform !== 'instagram' && elements.loginMethod.value === 'cookie');
}

function previewFor(item) {
  return item.files.find(file => file.kind === 'video') || item.files.find(file => file.name.startsWith('media-')) || item.files[0];
}

function mediaCard(target, item, snapshot = false) {
  const name = target.name, key = target.key || name, platform = target.platform || 'instagram';
  const preview = snapshot ? { name: t('media.snapshotFile'), kind: 'screenshot', url: item.latest } : previewFor(item);
  if (!preview) return '';
  const kind = snapshot ? 'screenshot' : preview.kind;
  const source = kind === 'video'
    ? `<video src="${escapeHtml(preview.url)}" controls preload="metadata"></video>`
    : `<img src="${escapeHtml(preview.url)}" alt="${escapeHtml(t('media.imageAlt', { name, kind: t(`filter.${kind === 'screenshot' ? 'screenshot' : 'image'}`) }))}" loading="lazy">`;
  const title = snapshot ? t('media.snapshot') : item.id;
  const files = snapshot ? [{ name: 'latest.png', url: item.latest }] : item.files;
  const fileLinks = files.map(file => `
    <a href="${escapeHtml(file.url)}?download=1"><span>${escapeHtml(file.name)}</span><small>${t('media.download')}</small></a>`).join('');
  const deleteButton = snapshot ? `<button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(name)}" data-latest="1">${t('media.deleteScreenshot')}</button>` : `<button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(name)}" data-item="${escapeHtml(item.id)}">${t('media.delete')}</button>`;
  return `
    <article class="media-card" data-kind="${kind}" data-media-key="${escapeHtml(key)}:video:${escapeHtml(item.id)}" data-signature="${escapeHtml(JSON.stringify(item))}">
      <div class="media-frame">${source}<span class="file-badge">${t(`filter.${kind === 'video' ? 'video' : kind === 'screenshot' ? 'screenshot' : 'image'}`)}</span></div>
      <div class="media-body">
        <div class="media-title"><span>${escapeHtml(title)}</span><time>${snapshot ? '' : formatDate(item.captured_at)}</time></div>
        <p class="caption">${snapshot ? escapeHtml(t('media.latestCheck', { name })) : escapeHtml(item.caption || t('media.archived', { brand: platformNames[platform] }))}</p>
        <div class="media-actions">
          <a href="${escapeHtml(preview.url)}" data-preview="${kind === 'video' ? 'video' : 'image'}" data-preview-title="@${escapeHtml(name)} ${escapeHtml(title)}">${t(kind === 'video' ? 'media.viewVideo' : 'media.viewOriginal')}</a>
          ${!snapshot && item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">${t('media.originalPost')}</a>` : ''}
          ${deleteButton}
        </div>
        <details class="file-list"><summary>${t('media.files', { count: files.length })}</summary>${fileLinks}</details>
      </div>
    </article>`;
}

function textCard(target, item) {
  const platform = target.platform || 'instagram';
  const textFile = item.files.find(file => file.kind === 'text');
  return `<article class="media-card text-card" data-kind="text" data-media-key="${escapeHtml(target.key || target.name)}:text:${escapeHtml(item.id)}" data-signature="${escapeHtml(JSON.stringify(item))}">
    <div class="media-body">
      <div class="media-title"><span>${escapeHtml(item.id)}</span><time>${formatDate(item.captured_at)}</time></div>
      <p class="text-content">${escapeHtml(item.caption || t('media.textFallback'))}</p>
      <div class="media-actions">
        ${item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">${t('media.originalPost')}</a>` : ''}
        ${textFile ? `<a href="${escapeHtml(textFile.url)}?download=1">${t('media.downloadText')}</a>` : ''}
        <button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(target.name)}" data-item="${escapeHtml(item.id)}">${t('media.delete')}</button>
      </div>
    </div>
  </article>`;
}

function renderLibrary(library) {
  const hasContent = library.some(target => target.latest || target.items.length);
  if (!hasContent) {
    elements.library.innerHTML = `
      <div class="empty-state"><div><h3>${t('media.emptyTitle')}</h3><p>${t('media.emptyDetail')}</p><a href="/settings" data-route>${t('media.emptyAction')}</a></div></div>`;
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
    const state = target.status.error ? escapeHtml(targetState(target.status)) : target.status.failed_items?.length ? t('media.retryCount', { count: target.items.length, failed: target.status.failed_items.length }) : t('media.archivedCount', { count: target.items.length });
    return `<section class="target-block" data-target-key="${escapeHtml(key)}" data-platform="${platform}">
      <div class="target-heading"><h3><span class="platform-name"><svg class="platform-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="/static/icons/platforms.svg#${platform}"/></svg>${platformNames[platform]}</span>${wechat ? escapeHtml(target.display_name || (target.name === 'moments' ? t('media.myMoments') : target.name)) : `@${escapeHtml(target.name)}`} <span class="rail-state">${state}</span></h3><div class="target-actions">${profileUrl ? `<a href="${profileUrl}" target="_blank" rel="noreferrer">${t('media.openProfile')}</a>` : ''}<button class="delete-button" type="button" data-platform="${platform}" data-target="${escapeHtml(target.name)}">${t('media.deleteUser')}</button></div></div>
      <div class="media-groups">${mediaGroup('image', t('filter.image'), photos, true)}${mediaGroup('video', t('filter.video'), videos)}${mediaGroup('text', t('filter.text'), textCards)}${mediaGroup('screenshot', t('filter.screenshot'), screenshots)}</div>
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
  if (error.includes('target requires an authenticated Instagram session')) return t('error.instagramSession');
  if (error.includes('Instagram login requires attention')) return t('error.instagramAttention');
  return locale === 'zh-CN' ? error : t('status.error.detail');
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
  elements.password.placeholder = selected.has_password ? t('settings.savedPlaceholder') : t('settings.passwordPlaceholder');
  elements.passwordNote.textContent = selected.has_password ? t('settings.savedPlaceholder') : t('settings.passwordSession', { brand: platformNames[selectedPlatform] });
  elements.loginMethod.value = selectedPlatform === 'wechat' ? 'password' : selected.login_method || 'password';
  elements.cookie.placeholder = selected.has_cookie ? t('settings.savedPlaceholder') : 'sessionid=...; sessionid_ss=...';
  document.querySelector('#targets-summary').textContent = selected.targets?.length ? t('settings.users', { count: selected.targets.length }) : t('settings.notSet');
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
  document.querySelector('#login-method option[value="password"]').textContent = t(douyin ? 'settings.method.public' : 'settings.method.password');
  document.querySelector('#account-label').textContent = phone ? t('settings.phone') : t('settings.account', { brand: platformNames[selectedPlatform] });
  document.querySelector('#password-label').textContent = t('settings.password', { brand: platformNames[selectedPlatform] });
  document.querySelector('#login-method-field').hidden = !external || wechat;
  document.querySelector('#login-method-label').textContent = t('settings.loginMethod', { brand: platformNames[selectedPlatform] });
  document.querySelector('#cookie-field').hidden = !cookie;
  document.querySelector('#cookie-label').textContent = t('settings.cookie', { brand: platformNames[selectedPlatform] });
  document.querySelector('#cookie-note').textContent = t('settings.cookieHelp', { brand: platformNames[selectedPlatform] });
  document.querySelector('#public-note').hidden = (!external || cookie) && !wechat;
  document.querySelector('#public-note').textContent = wechat ? t('settings.wechatNote') : phone ? t('settings.phoneNote') : qrcode ? t('settings.qrNote') : douyin ? t('settings.douyinNote') : t('settings.externalNote', { brand: platformNames[selectedPlatform] });
  elements.username.closest('label').hidden = wechat || cookie || (douyin && !phone);
  elements.password.closest('label').hidden = wechat || cookie || douyin;
  elements.username.required = elements.enabled.checked && (!external || phone);
  elements.targets.required = elements.enabled.checked && !wechat;
  elements.username.placeholder = t(phone ? 'settings.phonePlaceholder' : selectedPlatform === 'x' ? 'settings.xUsername' : external ? 'settings.externalUsername' : 'settings.instagramUsername');
  elements.targets.placeholder = t(wechat ? 'settings.wechatTargetsPlaceholder' : douyin ? 'settings.douyinTargetsPlaceholder' : 'settings.targetsPlaceholder');
  document.querySelector('#targets-note').textContent = t(wechat ? 'settings.wechatTargetsHelp' : douyin ? 'settings.douyinTargetsHelp' : 'settings.targetsHelp');
  document.querySelector('#targets-settings').hidden = false;
  if (wechat) elements.targets.setAttribute('list', 'wechat-authors'); else elements.targets.removeAttribute('list');
  document.querySelector('#reset-session').hidden = wechat;
  document.querySelector('#reset-session').textContent = t('settings.reset', { brand: platformNames[selectedPlatform] });
  document.querySelector('#platform-summary').textContent = `${platformNames[selectedPlatform]}${elements.enabled.checked ? '' : t('settings.disabledSuffix')}`;
  document.querySelector('#schedule-summary').textContent = `${elements.interval.selectedOptions[0]?.textContent || ''}${locale === 'en' ? ', ' : '，'}${elements.postLimit.selectedOptions[0]?.textContent || ''}`;
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
    notify(t('toast.run'));
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
  const label = t(latest ? 'confirm.deleteLatest' : item ? 'confirm.deleteItem' : 'confirm.deleteUser', { target });
  if (!confirm(label)) return;
  button.disabled = true;
  try {
    const path = latest ? `/api/targets/${target}/latest` : item ? `/api/targets/${target}/items/${item}` : `/api/targets/${target}`;
    await api(`${path}?platform=${platform}`, { method: 'DELETE' });
    notify(t(latest ? 'toast.latestDeleted' : item ? 'toast.itemDeleted' : 'toast.userDeleted'));
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
    elements.password.placeholder = t('settings.savedPlaceholder');
    notify(t('toast.saved'));
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
    notify(t('toast.sessionReset'));
  } catch (error) {
    notify(error.message);
  }
});

document.querySelector('#cleanup-platform').addEventListener('click', async event => {
  if (!confirm(t('confirm.cleanup', { brand: platformNames[selectedPlatform] }))) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api(`/api/cleanup?platform=${selectedPlatform}`, { method: 'DELETE' });
    notify(t('toast.cleaned', { screenshots: result.screenshots, videos: result.videos }));
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
    notify(t('toast.verification'));
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
  document.querySelector('#page-description').textContent = t(settings ? 'page.settingsDescription' : 'page.libraryDescription');
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
