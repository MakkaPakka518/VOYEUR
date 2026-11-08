import { imageGroupsMarkup, syncImageGroups, destroyImageGroups } from './gallery-carousels.js';

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
  postLimit: document.querySelector('#post-limit'),
  verificationPanel: document.querySelector('#verification-panel'),
  verificationCode: document.querySelector('#verification-code'),
  toast: document.querySelector('#toast'),
};

let hydrated = false;
let activeFilter = 'all';
let lastState;
let librarySignature = '';

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

function renderStatus(status = {}) {
  const errors = {
    invalid_credentials: ['账号或密码错误', '请在设置中修改 Instagram 账号或密码后重试'],
    verification_required: ['需要验证码', '输入 Instagram 发来的验证码以继续登录'],
    invalid_verification: ['验证码错误', '请输入新验证码后再次提交'],
    manual_verification: ['需要确认登录', '按登录截图提示完成 Instagram 安全确认'],
    login_page_changed: ['登录页面已变化', '查看登录截图确认 Instagram 当前页面'],
  };
  const labels = {
    not_configured: ['等待配置', '填写 Instagram 账号和关注用户后开始采集'],
    running: ['正在检查', '浏览器正在读取关注用户的最新内容'],
    ready: ['采集正常', '会话有效，等待下一次检查'],
    error: ['需要处理', status.error || '检查失败，请查看目标状态'],
  };
  const [title, detail] = errors[status.error_code] || labels[status.state] || labels.not_configured;
  elements.band.dataset.state = status.state || 'not_configured';
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
  elements.statusTime.textContent = formatDate(status.checked_at || status.started_at);
  elements.railState.textContent = title;
  elements.statusAction.hidden = !lastState?.login_screenshot;
  elements.statusAction.href = lastState?.login_screenshot || '#';
  elements.verificationPanel.hidden = !['verification_required', 'invalid_verification'].includes(status.error_code);
}

function previewFor(item) {
  return item.files.find(file => file.kind === 'video') || item.files.find(file => file.name.startsWith('media-')) || item.files[0];
}

function mediaCard(target, item, snapshot = false) {
  const preview = snapshot ? { name: '主页截图', kind: 'screenshot', url: item.latest } : previewFor(item);
  if (!preview) return '';
  const kind = snapshot ? 'screenshot' : preview.kind;
  const source = kind === 'video'
    ? `<video src="${escapeHtml(preview.url)}" controls preload="metadata"></video>`
    : `<img src="${escapeHtml(preview.url)}" alt="@${escapeHtml(target)} 的${kind === 'screenshot' ? '截图' : '图片'}" loading="lazy">`;
  const title = snapshot ? '主页快照' : item.id;
  const files = snapshot ? [{ name: 'latest.png', url: item.latest }] : item.files;
  const fileLinks = files.map(file => `
    <a href="${escapeHtml(file.url)}?download=1"><span>${escapeHtml(file.name)}</span><small>下载</small></a>`).join('');
  const deleteButton = snapshot ? '' : `<button class="delete-button" type="button" data-target="${escapeHtml(target)}" data-item="${escapeHtml(item.id)}">删除</button>`;
  return `
    <article class="media-card" data-kind="${kind}" data-media-key="${escapeHtml(target)}:video:${escapeHtml(item.id)}" data-signature="${escapeHtml(JSON.stringify(item))}">
      <div class="media-frame">${source}<span class="file-badge">${kind === 'video' ? '视频' : kind === 'screenshot' ? '截图' : '图片'}</span></div>
      <div class="media-body">
        <div class="media-title"><span>${escapeHtml(title)}</span><time>${snapshot ? '' : formatDate(item.captured_at)}</time></div>
        <p class="caption">${snapshot ? `@${escapeHtml(target)} 最近一次主页检查` : escapeHtml(item.caption || '已归档 Instagram 内容')}</p>
        <div class="media-actions">
          <a href="${escapeHtml(preview.url)}" target="_blank" rel="noreferrer">查看</a>
          ${!snapshot && item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">原帖</a>` : ''}
          ${deleteButton}
        </div>
        <details class="file-list"><summary>文件 ${files.length}</summary>${fileLinks}</details>
      </div>
    </article>`;
}

function renderLibrary(library) {
  const hasContent = library.some(target => target.latest || target.items.length);
  if (!hasContent) {
    elements.library.innerHTML = `
      <div class="empty-state"><div><h3>还没有收藏</h3><p>完成 Instagram 登录并添加关注用户，首次检查后内容会出现在这里。</p><a href="#settings">前往采集设置</a></div></div>`;
    syncImageGroups(elements.library);
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = library.map(target => {
    const photos = imageGroupsMarkup(target);
    const cards = target.items.filter(item => item.files.some(file => file.kind === 'video')).map(item => mediaCard(target.name, item)).join('');
    const state = target.status.error ? escapeHtml(targetState(target.status)) : `${target.items.length} 条归档`;
    return `<section class="target-block" data-target-key="${escapeHtml(target.name)}">
      <div class="target-heading"><h3>@${escapeHtml(target.name)} <span class="rail-state">${state}</span></h3><div class="target-actions"><a href="https://www.instagram.com/${encodeURIComponent(target.name)}/" target="_blank" rel="noreferrer">打开主页</a><button class="delete-button" type="button" data-target="${escapeHtml(target.name)}">删除此用户</button></div></div>
      <div class="media-grid">${photos}${cards}</div>
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
      const grid = section.querySelector('.media-grid');
      const oldCards = new Map([...grid.children].map(card => [card.dataset.mediaKey, card]));
      let nextCard = grid.firstElementChild;
      for (const card of [...desired.querySelector('.media-grid').children]) {
        const old = oldCards.get(card.dataset.mediaKey);
        const keep = old?.dataset.signature === card.dataset.signature ? old : card;
        if (keep !== nextCard) grid.insertBefore(keep, nextCard);
        nextCard = keep.nextElementSibling;
        oldCards.delete(card.dataset.mediaKey);
        if (old && keep !== old) old.remove();
        nextCard = keep.nextElementSibling;
      }
      oldCards.forEach(card => card.remove());
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
  document.querySelectorAll('.media-card').forEach(card => {
    card.hidden = activeFilter !== 'all' && card.dataset.kind !== activeFilter;
  });
}

function hydrateForm(config) {
  if (hydrated) return;
  elements.username.value = config.username || '';
  elements.targets.value = (config.targets || []).join(', ');
  elements.interval.value = String(config.interval || 300);
  elements.postLimit.value = String(config.post_limit || 12);
  elements.password.placeholder = config.has_password ? '已保存，留空保持不变' : '输入登录密码';
  elements.passwordNote.textContent = config.has_password ? '已安全保存，留空保持不变' : '用于建立 Instagram 浏览器会话';
  hydrated = true;
}

async function refresh(includeLibrary = true) {
  try {
    lastState = await api(`/api/state?library_data=${includeLibrary}`);
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
  applyFilter();
}));

document.querySelector('#run-now').addEventListener('click', event => runNow(event.currentTarget));
document.querySelector('#mobile-run').addEventListener('click', event => runNow(event.currentTarget));

elements.library.addEventListener('click', async event => {
  const button = event.target.closest('.delete-button');
  if (!button) return;
  const target = button.dataset.target;
  const item = button.dataset.item;
  const label = item ? '删除这条内容及其文件？' : `删除 @${target} 的全部截图和归档？`;
  if (!confirm(label)) return;
  button.disabled = true;
  try {
    await api(item ? `/api/targets/${target}/items/${item}` : `/api/targets/${target}`, { method: 'DELETE' });
    notify(item ? '内容已删除' : '用户记录已删除');
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
        username: elements.username.value,
        password: elements.password.value,
        targets: elements.targets.value,
        interval: Number(elements.interval.value),
        post_limit: Number(elements.postLimit.value),
      }),
    });
    elements.password.value = '';
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
    await api('/api/reset-session', { method: 'POST' });
    notify('旧会话将在下一轮清除');
  } catch (error) {
    notify(error.message);
  }
});

document.querySelector('#submit-verification').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/api/verification', {
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

document.querySelectorAll('.side-nav a, .bottom-nav a').forEach(link => link.addEventListener('click', () => {
  const destination = link.getAttribute('href');
  document.querySelectorAll('.side-nav a, .bottom-nav a').forEach(item => {
    const active = item.getAttribute('href') === destination;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
}));

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
refresh();
const statusTimer = setInterval(() => { if (!document.hidden) refresh(false); }, 5000);
const libraryTimer = setInterval(() => { if (!document.hidden) refresh(true); }, 30000);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  clearInterval(statusTimer);
  clearInterval(libraryTimer);
  destroyImageGroups();
});
