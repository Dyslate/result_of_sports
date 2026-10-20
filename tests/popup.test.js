// End-to-end tests of the toolbar popup, in the real extension with fake APIs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, footRequests, SHOTS } from './helpers.js';
import { at, ymd } from './fixtures.js';

let x;
before(async () => {
  x = await launch({ lang: 'fr' });
});
after(async () => {
  assert.deepEqual(x.errors, [], 'no JavaScript error in any page');
  await x.close();
});

/** Opens the popup on the football tab (the popup reopens on the last tab used). */
async function freshPopup() {
  const p = await x.popup();
  await p.waitForSelector('.tab[aria-selected="true"]');
  if ((await p.getAttribute('.tab[data-tab="foot"]', 'aria-selected')) !== 'true') await p.click('.tab[data-tab="foot"]');
  await p.waitForSelector('.league-card');
  return p;
}

test('football tab: competitions, live counter, statuses', async () => {
  const p = await freshPopup();
  assert.equal(await p.textContent('.brand-name'), 'Scores du jour');
  assert.equal((await p.textContent('.tab[data-tab="foot"] .count')).trim(), '2', '2 live matches');
  const names = await p.$$eval('.league-card .card-head > span:first-of-type', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['Ligue des champions', 'Ligue 1']);
  assert.equal(await p.textContent('.match[data-id="1001"] .status'), "67'");
  assert.equal(await p.textContent('.match[data-id="1002"] .status'), 'Mi‑temps');
  assert.match(await p.textContent('.match[data-id="2001"] .status'), /t\.a\.b/);
  assert.match(await p.textContent('.match[data-id="2001"] .scores'), /1\s*\(5\)/);
  await p.screenshot({ path: path.join(SHOTS, 'popup-foot.png') });
  await p.close();
});

test('expanding a match shows scorers, red card and a YouTube link', async () => {
  const p = await freshPopup();
  await p.click('.match[data-id="1001"] .match-main');
  const extra = await p.textContent('.match[data-id="1001"] .match-extra');
  for (const s of ['O. Dembélé', 'Lamine Yamal', 'D. Doué', 'P. Cubarsí', '🟥']) assert.ok(extra.includes(s), `shows ${s}`);
  const yt = await p.getAttribute('.match[data-id="1001"] a.yt', 'href');
  assert.match(decodeURIComponent(yt), /youtube\.com\/results\?search_query=.*Paris Saint-Germain.*Barcelona/);
  // upcoming match: calendar link instead of highlights
  await p.click('.match[data-id="1004"] .match-main');
  assert.equal(await p.$('.match[data-id="1004"] a.yt'), null);
  assert.match(await p.getAttribute('.match[data-id="1004"] a[href*="calendar.google.com"]', 'href'), /action=TEMPLATE/);
  await p.close();
});

test('day navigation requests the right date', async () => {
  const p = await freshPopup();
  const before = x.requests.length;
  await p.click('#day-next');
  await p.waitForFunction(() => document.querySelector('#day-label').textContent === 'Demain');
  await p.waitForSelector('.match[data-id="1005"]');
  const sent = footRequests(x.requests.slice(before));
  assert.ok(sent.some((r) => r.dates === ymd(at(1))), 'asked ESPN for tomorrow');
  assert.ok(sent.every((r) => !r.dates?.includes('-')), 'never a date range');
  await p.click('#day-label');
  await p.waitForFunction(() => document.querySelector('#day-label').textContent === "Aujourd'hui");
  await p.close();
});

test('search and live filter', async () => {
  const p = await freshPopup();
  await p.fill('#search', 'barc');
  await p.waitForFunction(() => document.querySelectorAll('.match').length === 1);
  assert.ok(await p.$('.match[data-id="1001"]'));
  await p.fill('#search', 'zzzz');
  await p.waitForSelector('.empty');
  await p.fill('#search', '');
  await p.click('#live-only');
  await p.waitForFunction(() => document.querySelectorAll('.match').length === 2);
  const ids = await p.$$eval('.match', (els) => els.map((e) => e.dataset.id).sort());
  assert.deepEqual(ids, ['1001', '1002']);
  await p.close();
});

test('F1 tab: live session, full classification, session switch', async () => {
  const p = await freshPopup();
  await p.click('.tab[data-tab="f1"]');
  await p.waitForSelector('.gp-card');
  assert.match(await p.textContent('.gp-title'), /Grand Prix du Mexique/);
  assert.ok(await p.$('.gp-title .pill.live'), 'live pill');
  assert.equal(await p.getAttribute('[data-sess="d"]', 'aria-pressed'), 'true', 'live qualifying selected');
  assert.equal(await p.$$eval('.gp-card .res', (e) => e.length), 10);
  await p.click('[data-toggle="f1ShowAll"]');
  await p.waitForFunction(() => document.querySelectorAll('.gp-card .res').length === 12);
  await p.click('[data-sess="e"]');
  await p.waitForSelector('.gp-card .note-pad');
  assert.match(await p.textContent('.gp-card .note-pad'), /Résultats disponibles/);
  assert.match(await p.textContent('#content'), /Prochain Grand Prix[\s\S]*Brésil/);
  assert.match(await p.textContent('#content'), /Championnat pilotes[\s\S]*Max Verstappen/);
  await p.screenshot({ path: path.join(SHOTS, 'popup-f1.png') });
  await p.close();
});

test('GT3 tab: race of the day and calendar', async () => {
  const p = await freshPopup();
  await p.click('.tab[data-tab="gt"]');
  await p.waitForSelector('.gt-ev');
  const text = await p.textContent('#content');
  for (const s of ['3 Hours of Portimão', '6 Hours of Paul Ricard', 'Brands Hatch Race 2', 'Course du jour']) assert.ok(text.includes(s), s);
  assert.equal((await p.textContent('.tab[data-tab="gt"] .count')).trim(), '1');
  await p.click('.tab[data-tab="foot"]');
  await p.close();
});

test('standings panel', async () => {
  const p = await freshPopup();
  await p.click('[data-standings="fra.1"]');
  await p.waitForSelector('#standings .table tbody tr');
  assert.equal(await p.$$eval('#standings .table tbody tr', (r) => r.length), 18);
  assert.match(await p.textContent('#standings .legend'), /Champions League/);
  await p.keyboard.press('Escape');
  assert.equal(await p.isHidden('#standings'), true);
  await p.close();
});

test('language flag switches to English and is remembered', async () => {
  const p = await freshPopup();
  await p.click('#lang-btn');
  await p.waitForFunction(() => document.querySelector('.brand-name').textContent === "Today's Scores");
  assert.equal((await p.textContent('#open-page')).trim(), 'Open web page');
  assert.equal(await p.textContent('.tab[data-tab="foot"] span'), 'Football');
  assert.equal(await p.evaluate(() => document.documentElement.lang), 'en');
  await p.close();
  const p2 = await freshPopup();
  assert.equal(await p2.textContent('.brand-name'), "Today's Scores");
  await p2.click('#lang-btn');
  await p2.waitForFunction(() => document.querySelector('.brand-name').textContent === 'Scores du jour');
  await p2.close();
});

test('themes: mode cycle, preset palette and custom colours', async () => {
  const p = await freshPopup();
  await p.keyboard.press('t');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
  await p.keyboard.press('t');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await p.click('#settings-btn');
  await p.click('[data-palette="neon"]');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.palette), 'neon');
  await p.click('[data-palette="custom"]');
  await p.waitForSelector('#custom-editor:not([hidden])');
  await p.$eval('[data-color="accent"]', (el) => {
    el.value = '#ff00aa';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#ff00aa');
  await p.click('[data-size="large"]');
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()), '14.5px');
  await p.screenshot({ path: path.join(SHOTS, 'popup-theme-editor.png') });
  // back to defaults for the other tests
  await p.click('[data-palette="pelouse"]');
  await p.click('[data-theme-val="auto"]');
  await p.click('[data-size="normal"]');
  await p.close();
});

test('following a team puts a star and remembers it', async () => {
  const p = await freshPopup();
  await p.click('.match[data-id="1003"] .match-main');
  await p.click('.match[data-id="1003"] [data-follow="Liverpool"]');
  await p.waitForSelector('.match[data-id="1003"] .star');
  const favs = await p.evaluate(() => chrome.storage.sync.get('favorites').then((s) => s.favorites));
  assert.deepEqual(favs, ['Liverpool']);
  await p.click('.match[data-id="1003"] [data-follow="Liverpool"]');
  await p.waitForFunction(() => !document.querySelector('.match[data-id="1003"] .star'));
  await p.close();
});

test('"Open web page" opens the full-screen page in a new tab', async () => {
  const p = await freshPopup();
  const [tab] = await Promise.all([x.ctx.waitForEvent('page'), p.click('#open-page')]);
  await tab.waitForLoadState();
  assert.equal(tab.url(), x.url('page.html'));
  await tab.waitForSelector('.kpi');
  await tab.close();
});

test('settings: automatic refresh choice is saved', async () => {
  const p = await freshPopup();
  await p.click('#settings-btn');
  assert.equal(await p.getAttribute('#set-refresh [data-refresh="normal"]', 'aria-checked'), 'true', 'normal by default');
  await p.click('#set-refresh [data-refresh="slow"]');
  assert.equal(await p.evaluate(() => chrome.storage.sync.get('refresh').then((s) => s.refresh)), 'slow');
  assert.match(await p.textContent('#settings'), /Actualisation automatique/);
  await p.click('#set-refresh [data-refresh="normal"]');
  await p.close();
});
