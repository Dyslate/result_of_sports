// Launches Chromium with the unpacked extension and routes every external request to fixtures.js.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, respond } from './fixtures.js';

export const SHOTS = path.join(ROOT, 'test-results');
mkdirSync(SHOTS, { recursive: true });

/**
 * opts: { lang: 'fr' | 'en' (browser UI language), mode: fixtures mode, settings: chrome.storage.sync seed }
 * Returns { ctx, id, requests, setMode, popup(), page(), url(), errors, close() }.
 */
// Lets context.route() also intercept requests made by the extension's service worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export async function launch({ lang = 'fr', mode = 'ok', settings = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdj-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    locale: lang === 'fr' ? 'fr-FR' : 'en-GB',
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, `--lang=${lang === 'fr' ? 'fr-FR' : 'en-GB'}`],
  });
  const state = { mode };
  const requests = [];
  const errors = [];

  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (!/^https?:/.test(url)) return route.continue();
    requests.push(url);
    const r = respond(url, state.mode);
    if (!r) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: r.status, contentType: r.contentType, body: r.body, headers: { 'access-control-allow-origin': '*' } });
  });

  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  const id = new URL(sw.url()).host;

  if (settings) {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/page.html`);
    await p.evaluate((s) => chrome.storage.sync.set(s), settings);
    await p.close();
  }

  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    return p;
  };

  return {
    ctx,
    sw,
    id,
    requests,
    errors,
    setMode: (m) => (state.mode = m),
    url: (file) => `chrome-extension://${id}/${file}`,
    async popup() {
      const p = watch(await ctx.newPage());
      await p.setViewportSize({ width: 400, height: 590 });
      await p.goto(`chrome-extension://${id}/popup.html`);
      return p;
    },
    async page() {
      const p = watch(await ctx.newPage());
      await p.goto(`chrome-extension://${id}/page.html`);
      return p;
    },
    async close() {
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** ESPN football scoreboard requests seen so far, as { league, dates }. */
export function footRequests(requests) {
  return requests
    .filter((u) => u.includes('site.api.espn.com') && /\/soccer\/[^/]+\/scoreboard/.test(u))
    .map((u) => {
      const x = new URL(u);
      return { league: x.pathname.split('/').at(-2), dates: x.searchParams.get('dates') };
    });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
