import { mountInkSpreadCarousel } from './components/ink-spread-carousel/InkSpreadCarouselEngine.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[c]);
const groups = new Map();
const instances = new Map();
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const record = instances.get(entry.target);
    if (!entry.isIntersecting || !record || record.controller) continue;
    const { group, host } = record;
    record.controller = mountInkSpreadCarousel(host, {
      images: group.photos.map(photo => ({ src: photo.url, alt: photo.alt })),
      onIndexChange: index => showDetails(entry.target, group, index),
    });
    observer.unobserve(entry.target);
  }
}, { rootMargin: '200px' });

function details(group, index) {
  const photo = group.photos[index];
  const title = photo.item ? photo.item.id : '主页快照';
  return `<div class="media-title"><span>${escapeHtml(title)}</span><span class="photo-count">${index + 1} / ${group.photos.length}</span></div>
    <p class="caption">${escapeHtml(photo.alt)}</p>
    <div class="media-actions">
      <a href="${escapeHtml(photo.url)}" target="_blank" rel="noreferrer">查看原图</a>
      <a href="${escapeHtml(photo.url)}${photo.url.includes('?') ? '&' : '?'}download=1">下载</a>
      ${photo.item?.source_url ? `<a href="${escapeHtml(photo.item.source_url)}" target="_blank" rel="noreferrer">原帖</a>` : ''}
      ${photo.item ? `<button class="delete-button" type="button" data-target="${escapeHtml(group.target)}" data-item="${escapeHtml(photo.item.id)}">删除此帖</button>` : ''}
    </div>`;
}

function showDetails(card, group, index) {
  card.querySelector('.media-body').innerHTML = details(group, index);
}

export function imageGroupsMarkup(target) {
  const photos = [], screenshots = [];
  if (target.latest) screenshots.push({
    url: `${target.latest}?v=${encodeURIComponent(target.status.checked_at || '')}`,
    alt: `@${target.name} 的最新主页截图`,
  });
  for (const item of target.items) {
    for (const file of item.files) {
      if (file.kind !== 'image') continue;
      const screenshot = file.name === 'page.png';
      (screenshot ? screenshots : photos).push({
        url: file.url, item,
        alt: screenshot ? `@${target.name} 的帖子 ${item.id} 截图` : item.caption || `@${target.name} 的归档图片 ${file.name}`,
      });
    }
  }
  let markup = '';
  for (const [kind, collection] of [['image', photos], ['screenshot', screenshots]]) {
    for (let offset = 0; offset < collection.length; offset += 12) {
      const key = `${target.name}:${kind}:${offset / 12}`;
      const group = { target: target.name, photos: collection.slice(offset, offset + 12) };
      groups.set(key, group);
      markup += `<article class="media-card photo-carousel-card" data-kind="${kind}" data-media-key="${escapeHtml(key)}" data-signature="${escapeHtml(JSON.stringify(group))}">
        <div class="photo-carousel-host"><img class="photo-placeholder" src="${escapeHtml(group.photos[0].url)}" alt="${escapeHtml(group.photos[0].alt)}" loading="lazy"></div>
        <div class="media-body">${details(group, 0)}</div>
      </article>`;
    }
  }
  return markup;
}

export function syncImageGroups(container) {
  for (const [card, record] of instances) {
    if (container.contains(card)) continue;
    observer.unobserve(card);
    record.controller?.destroy();
    instances.delete(card);
  }
  const liveKeys = new Set();
  for (const card of container.querySelectorAll('.photo-carousel-card')) {
    liveKeys.add(card.dataset.mediaKey);
    if (instances.has(card)) continue;
    const group = groups.get(card.dataset.mediaKey);
    const host = card.querySelector('.photo-carousel-host');
    instances.set(card, { group, host, controller: null });
    observer.observe(card);
  }
  for (const key of groups.keys()) if (!liveKeys.has(key)) groups.delete(key);
}

export function destroyImageGroups() {
  observer.disconnect();
  for (const record of instances.values()) record.controller?.destroy();
  instances.clear();
  groups.clear();
}
