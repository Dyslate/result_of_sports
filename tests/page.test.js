// End-to-end tests of the full-screen page (page.html), in the real extension with fake APIs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, footRequests, SHOTS, sleep } from './helpers.js';
import { at, ymd, schedule } from './fixtures.js';

let x;
before(async () => {
  x = await launch({ lang: 'fr' });
});
after(async () => {
  assert.deepEqual(x.errors, [], 'no JavaScript error in any page');
  await x.close();
});

async function freshPage() {
  const p = await x.page();
  await p.waitForSelector('#foot .league-card');
  await p.waitForSelector('#f1 .gp-card');
  return p;
}

/** Waits until the football column has finished loading for the current period. */
async function settled(p) {
  await p.waitForFunction(() => !document.querySelector('#foot .skel') && !document.querySelector('#refresh.spin'));
}

const idsOnPage = (p) => p.$$eval('#foot .match', (els) => els.map((e) => e.dataset.id).sort());
const expectedIds = (from, to) =>
  schedule()
    .filter((m) => ymd(m.when) >= ymd(from) && ymd(m.when) <= ymd(to))
    .map((m) => m.id)
    .sort();

function weekBounds(d) {
  const from = new Date(d);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return [from, to];
}

test('page: summary tiles, football, F1 and GT3 columns', async () => {
  const p = await freshPage();
  const tiles = await p.$$eval('.kpi', (k) => k.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(tiles.length, 4);
  assert.match(tiles[0], /EN DIRECT|En direct/i);
  assert.match(tiles[0], /3/, '2 live matches + live F1 session');
  assert.match(tiles[2], /Qualifications/);
  assert.match(tiles[3], /1/);
  assert.deepEqual(await idsOnPage(p), expectedIds(at(0), at(0)));
  assert.ok(await p.$('#gt .gt-ev.today'), 'GT race of the day highlighted');
  await p.screenshot({ path: path.join(SHOTS, 'page-day.png'), fullPage: true });
  await p.close();
});

test('week view: grouped by day, only real match days requested, no range query', async () => {
  const p = await freshPage();
  const before = x.requests.length;
  await p.click('[data-range="week"]');
  await p.waitForSelector('#foot .day-block');
  await settled(p);
  const [from, to] = weekBounds(at(0));
  assert.deepEqual(await idsOnPage(p), expectedIds(from, to));
  assert.equal(await p.textContent('#day-label'), 'Cette semaine');
  const days = await p.$$eval('.day-block', (b) => b.map((e) => e.id));
  assert.deepEqual(days, [...days].sort(), 'days in chronological order');
  assert.ok(await p.$('.day-block.is-today'), 'today is marked');
  const sent = footRequests(x.requests.slice(before));
  assert.ok(sent.every((r) => !r.dates?.includes('-')), 'never a date range');
  const playing = new Set(schedule().filter((m) => ymd(m.when) >= ymd(from) && ymd(m.when) <= ymd(to)).map((m) => `${m.league}:${ymd(m.when)}`));
  for (const r of sent.filter((r) => r.dates)) assert.ok(playing.has(`${r.league}:${r.dates}`), `only days with matches (${r.league} ${r.dates})`);
  await p.screenshot({ path: path.join(SHOTS, 'page-week.png'), fullPage: true });

  await p.click('#day-next');
  await settled(p);
  const [f2, t2] = weekBounds(at(7));
  assert.deepEqual(await idsOnPage(p), expectedIds(f2, t2), 'next week');
  await p.close();
});

test('month view and month navigation', async () => {
  const p = await freshPage();
  await p.click('[data-range="month"]');
  await settled(p);
  const now = at(0);
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
  assert.deepEqual(await idsOnPage(p), expectedIds(from, to));
  const label = await p.textContent('#day-label');
  assert.match(label, new RegExp(String(now.getFullYear())));
  await p.click('#day-prev');
  await settled(p);
  assert.notEqual(await p.textContent('#day-label'), label);
  assert.ok(!(await p.$('#foot .empty strong'))?.textContent?.includes?.('Impossible'), 'no error');
  await p.close();
});

test('custom range: validation and results', async () => {
  const p = await freshPage();
  await p.click('[data-range="custom"]');
  await p.waitForSelector('#custom-range:not([hidden])');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // end before start
  await p.fill('#range-from', iso(at(5)));
  await p.fill('#range-to', iso(at(1)));
  await p.click('#custom-range .btn');
  assert.match(await p.textContent('#range-err'), /fin/);
  // too long
  await p.fill('#range-from', iso(at(-40)));
  await p.fill('#range-to', iso(at(40)));
  await p.click('#custom-range .btn');
  assert.match(await p.textContent('#range-err'), /62/);
  // valid
  await p.fill('#range-from', iso(at(-1)));
  await p.fill('#range-to', iso(at(3)));
  await p.click('#custom-range .btn');
  await settled(p);
  assert.equal(await p.textContent('#range-err'), '');
  assert.deepEqual(await idsOnPage(p), expectedIds(at(-1), at(3)));
  await p.close();
});

test('switching Day / Week / Month / Range quickly never breaks the page', async () => {
  const p = await freshPage();
  for (const mode of ['week', 'month', 'custom', 'day', 'month', 'week', 'day', 'week']) {
    await p.click(`[data-range="${mode}"]`);
    await sleep(40);
  }
  await settled(p);
  await sleep(800);
  await settled(p);
  const [from, to] = weekBounds(at(0));
  assert.equal(await p.textContent('#day-label'), 'Cette semaine');
  assert.deepEqual(await idsOnPage(p), expectedIds(from, to), 'shows the last selected period');
  assert.equal(await p.$('#foot .empty'), null, 'no error box');
  // keyboard shortcuts
  await p.keyboard.press('d');
  await settled(p);
  assert.equal(await p.textContent('#day-label'), "Aujourd'hui");
  await p.keyboard.press('m');
  await settled(p);
  assert.equal(await p.getAttribute('[data-range="month"]', 'aria-checked'), 'true');
  await p.close();
});

test('highlights: a choice first, nothing loads before "Play here"', async () => {
  const p = await freshPage();
  await p.click('#foot .match[data-id="1003"] .match-main');
  const before = x.requests.length;
  await p.click('#foot .match[data-id="1003"] [data-yt]');
  await p.waitForSelector('#dlg-video[open] .player.preview');
  assert.equal(await p.$('#dlg-video iframe'), null, 'no player yet');
  assert.ok(await p.$('#dlg-video .player.preview img[src*="i.ytimg.com/vi/vidAAAAAAA1/"]'), 'thumbnail shown');
  assert.equal(await p.getAttribute('#dlg-video .player.preview a.yt', 'href'), 'https://www.youtube.com/watch?v=vidAAAAAAA1');
  assert.equal(await p.getAttribute('#dlg-video .player.preview a.yt', 'target'), '_blank');
  assert.match(await p.textContent('#dlg-video .player.preview'), /publicité/);
  const loaded = x.requests.slice(before).filter((u) => /dyslate\.github\.io|youtube-nocookie\.com/.test(u));
  assert.deepEqual(loaded, [], 'neither the relay nor YouTube player requested');
  await p.screenshot({ path: path.join(SHOTS, 'page-video-choice.png') });
  // another video from the list also starts with the choice
  await p.click('#dlg-video .vid-alt[data-vid="1"]');
  await p.waitForSelector('#dlg-video .player.preview img[src*="vidAAAAAAA2"]');
  assert.equal(await p.$('#dlg-video iframe'), null);
  await p.click('#dlg-video .dlg-close');
  await p.close();
});

test('highlights: "Play here" runs the video inside the page through the relay', async () => {
  const p = await freshPage();
  await p.click('#foot .match[data-id="1003"] .match-main');
  await p.click('#foot .match[data-id="1003"] [data-yt]');
  await p.waitForSelector('#dlg-video[open] .vid-alt');
  await p.click('#dlg-video .vid-alt[data-vid="1"]');
  await p.click('#dlg-video .play-btn');
  await p.waitForSelector('#dlg-video .player iframe');
  assert.equal(await p.getAttribute('#dlg-video .player iframe', 'src'), 'https://dyslate.github.io/result_of_sports/player.html?v=vidAAAAAAA2');
  await sleep(1500);
  const relay = p.frames().find((f) => f.url() === 'https://dyslate.github.io/result_of_sports/player.html?v=vidAAAAAAA2');
  assert.ok(relay, 'relay frame loaded');
  assert.match(await relay.evaluate(() => document.querySelector('iframe').src), /youtube-nocookie\.com\/embed\/vidAAAAAAA2\?.*autoplay=1.*enablejsapi=1/);
  await sleep(6000);
  assert.ok(await p.$('#dlg-video .player iframe'), 'still playing, nothing replaced it');
  await p.screenshot({ path: path.join(SHOTS, 'page-video.png') });
  await p.click('#dlg-video .dlg-close');
  // the dialog's close event fires asynchronously, then the player is removed (sound stops)
  await p.waitForFunction(() => document.querySelector('#video-body').innerHTML === '', null, { timeout: 3000 });
  await p.close();
});

test('highlights: a YouTube-only video shows one-click buttons, no automatic skip', async () => {
  const p = await freshPage();
  await p.click('#foot .match[data-id="1003"] .match-main');
  await p.click('#foot .match[data-id="1003"] [data-yt]');
  await p.waitForSelector('#dlg-video .player.preview');
  await p.click('#dlg-video .preview-actions [data-play]');
  // the first result is YouTube-only (like beIN SPORTS)
  await p.waitForSelector('#dlg-video .player.blocked', { timeout: 15000 });
  assert.match(await p.textContent('#dlg-video .player.blocked'), /uniquement sur YouTube[\s\S]*CANAL\+ Sport/);
  assert.equal(await p.getAttribute('#dlg-video .player.blocked a.btn', 'href'), 'https://www.youtube.com/watch?v=vidAAAAAAA1');
  await sleep(1500);
  assert.match(await p.textContent('#dlg-video .vid-title'), /PSG renverse/, 'no automatic jump to another video');
  assert.ok(await p.$('#dlg-video .vid-alt[data-vid="1"]'), 'other videos still offered');
  await p.screenshot({ path: path.join(SHOTS, 'page-video-blocked.png') });
  // pop-out button: check the window request (the test browser has no access to youtube.com)
  await p.evaluate(() => {
    const create = chrome.windows.create.bind(chrome.windows);
    window.__popout = null;
    chrome.windows.create = (o) => ((window.__popout = o), create({ ...o, url: 'about:blank' }));
  });
  await p.click('#dlg-video .player.blocked [data-popout]');
  const opened = await p.evaluate(() => window.__popout);
  assert.equal(opened.url, 'https://www.youtube.com/watch?v=vidAAAAAAA1');
  assert.equal(opened.type, 'popup');
  assert.equal(await p.$('#dlg-video[open]'), null, 'dialog closed');
  await p.close();
});

test('relay page: rejects invalid ids', async () => {
  const p = await x.ctx.newPage();
  await p.goto('https://dyslate.github.io/result_of_sports/player.html?v=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
  assert.equal(await p.$('iframe'), null);
  assert.equal(await p.textContent('#msg'), 'Invalid video id');
  assert.equal(await p.$('iframe'), null);
  await p.close();
});

test('standings dialog and language switch on the page', async () => {
  const p = await freshPage();
  await p.click('#foot [data-standings="uefa.champions"]');
  await p.waitForSelector('#dlg-stand[open] tbody tr');
  assert.equal(await p.$$eval('#dlg-stand tbody tr', (r) => r.length), 18);
  await p.keyboard.press('Escape');
  await p.click('.lang-seg [data-lang="en"]');
  await p.waitForFunction(() => document.querySelector('h1').textContent === "Today's Scores");
  assert.equal(await p.textContent('[data-range="week"]'), 'Week');
  assert.match(await p.textContent('.kpi'), /LIVE NOW|Live now/i);
  // the popup follows the page's choice
  const pop = await x.popup();
  await pop.waitForFunction(() => document.querySelector('.brand-name').textContent === "Today's Scores");
  await pop.close();
  await p.click('.lang-seg [data-lang="fr"]');
  await p.waitForFunction(() => document.querySelector('h1').textContent === 'Scores du jour');
  await p.close();
});

test('phone width: no horizontal scroll', async () => {
  const p = await freshPage();
  await p.setViewportSize({ width: 390, height: 800 });
  await sleep(200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no horizontal overflow (${overflow}px)`);
  await p.screenshot({ path: path.join(SHOTS, 'page-mobile.png') });
  await p.close();
});
