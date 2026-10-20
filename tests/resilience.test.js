// Cache, error handling, ESPN throttling and the background service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, footRequests, sleep } from './helpers.js';

const espn = (reqs) => reqs.filter((u) => u.includes('site.api.espn.com'));

test('cache is shared: reloading the page or opening the popup makes no new request', async () => {
  const x = await launch();
  try {
    const p = await x.page();
    await p.waitForSelector('#foot .league-card');
    await p.waitForSelector('#f1 .gp-card');
    const first = footRequests(x.requests).length;
    assert.ok(first > 0);
    await p.reload();
    await p.waitForSelector('#foot .league-card');
    const pop = await x.popup();
    await pop.waitForSelector('.league-card');
    assert.equal(footRequests(x.requests).length, first, 'served from cache');
    // the refresh button bypasses the cache
    await p.click('#refresh');
    await p.waitForFunction(() => !document.querySelector('#refresh.spin'));
    await sleep(300);
    assert.ok(footRequests(x.requests).length > first, 'refresh refetches');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('one competition down: the others still show, with a warning', async () => {
  const x = await launch({ mode: 'fail-eng' });
  try {
    const pop = await x.popup();
    await pop.waitForSelector('.league-card');
    assert.match(await pop.textContent('.warn'), /1 compétition/);
    assert.ok(await pop.$('.match[data-id="1001"]'));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('ESPN 403: the extension pauses, explains it and stops calling ESPN', async () => {
  const x = await launch({ mode: 'throttle' });
  try {
    const p = await x.page();
    await p.waitForSelector('#foot .empty');
    const msg = await p.textContent('#foot .empty');
    assert.match(msg, /ESPN limite temporairement/);
    assert.match(msg, /\d{2}:\d{2}/, 'says when it will retry');
    await sleep(500);
    const n = espn(x.requests).length;
    assert.ok(n <= 6, `only the first wave reached ESPN (${n})`);
    await p.reload();
    await p.waitForSelector('#foot .empty');
    const pop = await x.popup();
    await pop.waitForSelector('.empty');
    assert.match(await pop.textContent('.empty'), /ESPN/);
    assert.equal(espn(x.requests).length, n, 'no ESPN request while paused');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('background: badge shows live events, goal and full-time notifications fire', async () => {
  const x = await launch({ settings: { notify: 'all' } });
  try {
    // ask the worker for a check now that the fake APIs are in place
    const page = await x.page();
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'refresh-badge' }));
    const badge = () => x.sw.evaluate(() => chrome.action.getBadgeText({}));
    for (let i = 0; i < 40 && (await badge()) !== '3'; i++) await sleep(250);
    assert.equal(await badge(), '3', '2 live matches + live F1 session');
    assert.match(await x.sw.evaluate(() => chrome.action.getTitle({})), /3 en direct/);
    // pretend the previous check saw PSG–Barça at 1–1 and Liverpool still playing
    await x.sw.evaluate(async () => {
      const { snap } = await chrome.storage.local.get('snap');
      snap['1001'] = { h: '1', a: '1', st: 'in' };
      snap['1003'] = { h: '3', a: '0', st: 'in' };
      await chrome.storage.local.set({ snap });
    });
    const p = await x.page();
    await p.evaluate(() => chrome.runtime.sendMessage({ type: 'refresh-badge' }));
    const ids = async () => Object.keys(await x.sw.evaluate(() => chrome.notifications.getAll()));
    for (let i = 0; i < 40 && (await ids()).length < 2; i++) await sleep(250);
    const got = await ids();
    assert.ok(got.includes('goal-1001-3'), `goal notification (${got})`);
    assert.ok(got.includes('ft-1003'), `full-time notification (${got})`);
    // polling adapts: something is live, so the next check is in about a minute
    const alarm = await x.sw.evaluate(() => chrome.alarms.get('refresh'));
    const inMin = (alarm.scheduledTime - Date.now()) / 60000;
    assert.ok(inMin > 0 && inMin <= 1.1, `next check in ${inMin.toFixed(2)} min`);
    // the YouTube referer rule is installed for the extension only
    const rules = await x.sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    assert.deepEqual(rules[0].condition.initiatorDomains, [x.id]);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('a browser in English gets the English interface automatically', async () => {
  const x = await launch({ lang: 'en' });
  try {
    const pop = await x.popup();
    await pop.waitForSelector('.league-card');
    assert.equal(await pop.textContent('.brand-name'), "Today's Scores");
    assert.equal(await pop.textContent('.match[data-id="1002"] .status'), 'Half‑time');
    const p = await x.page();
    await p.waitForSelector('.kpi');
    assert.equal(await p.textContent('h1'), "Today's Scores");
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
