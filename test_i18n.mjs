import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogs, resolveLocale, supportedLocales, t } from './static/i18n.js';

const baseKeys = Object.keys(catalogs['zh-CN']).sort();
for (const locale of supportedLocales) {
  assert.deepEqual(Object.keys(catalogs[locale]).sort(), baseKeys, `${locale} catalog keys differ`);
  for (const key of baseKeys) {
    assert(catalogs[locale][key].trim(), `${locale}:${key} is empty`);
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(catalogs[locale][key]), placeholders(catalogs['zh-CN'][key]), `${locale}:${key} placeholders differ`);
  }
}

assert.equal(resolveLocale('en', ['zh-CN']), 'en');
assert.equal(resolveLocale(null, ['zh-TW']), 'zh-TW');
assert.equal(resolveLocale(null, ['en-US']), 'en');
assert.equal(resolveLocale(null, ['fr-FR', 'zh-CN']), 'zh-CN');
assert.equal(t('settings.users', { count: 3 }, 'zh-TW'), '3 位使用者');
assert.equal(t('settings.users', { count: 3 }, 'en'), 'Selected: 3');

for (const file of ['static/login.html', 'static/index.html']) {
  const source = await readFile(file, 'utf8');
  const keys = [
    ...[...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]),
    ...[...source.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap(match => match[1].split(',').map(entry => entry.split(':')[1])),
  ];
  for (const key of keys) assert(key in catalogs['zh-CN'], `${file} references missing key ${key}`);
}
console.log(`PASS: ${baseKeys.length} complete keys across ${supportedLocales.join(', ')}.`);
