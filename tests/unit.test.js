// Unit tests: data layer and translations, run in plain Node with a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respond, at, ymd, schedule } from './fixtures.js';

let n = 0;
/** Fresh copy of src/api.js (separate cache and back-off state) with fetch routed to the fixtures. */
async function freshApi(mode = 'ok') {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const r = respond(String(url), typeof mode === 'function' ? mode(String(url)) : mode);
    const body = r ? (Buffer.isBuffer(r.body) ? r.body.toString() : r.body) : '';
    return new Response(body, { status: r?.status ?? 404, headers: { 'content-type': r?.contentType ?? 'text/plain' } });
  };
  const api = await import(`../src/api.js?fresh=${++n}`);
  return { api, calls };
}

test('i18n: French and English have the same keys and placeholders', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8'));
  const block = (lang) => src.slice(src.indexOf(`  ${lang}: {`), src.indexOf('\n  },', src.indexOf(`  ${lang}: {`)));
  const parse = (b) => Object.fromEntries([...b.matchAll(/^\s{4}'([^']+)':\s*([\s\S]*?),\n(?=\s{4}'|\s*$)/gm)].map((m) => [m[1], m[2]]));
  const fr = parse(block('fr'));
  const en = parse(block('en'));
  assert.ok(Object.keys(fr).length > 150, 'parsed the French table');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort(), 'same keys in both languages');
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(fr)) assert.equal(ph(en[k]), ph(fr[k]), `placeholders of ${k}`);
});

test('i18n: t() switches language and fills placeholders', async () => {
  const { t, setLang } = await import('../src/i18n.js');
  setLang('en');
  assert.equal(t('foot.liveN', { n: 3 }), '3 live');
  setLang('fr');
  assert.equal(t('foot.liveN', { n: 3 }), '3 en direct');
  assert.equal(t('missing.key'), 'missing.key');
});

test('football: one day = one request per competition, statuses normalised', async () => {
  const { api, calls } = await freshApi();
  const res = await api.fetchFootball(at(0), ['uefa.champions', 'fra.1', 'eng.1']);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((u) => !/dates=\d{8}-/.test(u)), 'no date range sent');
  const ucl = res.leagues.find((l) => l.id === 'uefa.champions');
  const byId = Object.fromEntries(ucl.events.map((e) => [e.id, e]));
  assert.equal(byId['1001'].status.live, true);
  assert.equal(byId['1001'].status.clock, "67'");
  assert.equal(byId['1002'].status.code, 'ht');
  assert.equal(byId['1003'].status.code, 'ft');
  assert.equal(byId['1004'].status.state, 'pre');
  assert.deepEqual(byId['1001'].details.map((d) => d.kind), ['goal', 'goal', 'pen', 'red']);
  const metz = res.leagues.find((l) => l.id === 'fra.1').events.find((e) => e.id === '2001');
  assert.equal(metz.status.code, 'pen');
  assert.equal(metz.home.shootout, 5);
  assert.ok(!res.leagues.some((l) => l.id === 'eng.1'), 'competition without match is omitted');
});

test('football range: never sends a date range, only fetches days with matches', async () => {
  const { api, calls } = await freshApi();
  const from = at(-1);
  const to = at(13);
  const res = await api.fetchFootballRange(from, to, ['uefa.champions', 'fra.1', 'eng.1', 'ger.1']);
  assert.ok(calls.every((u) => !/dates=\d{8}-\d{8}/.test(u)), 'no range query');
  const expected = new Set(schedule().filter((m) => ymd(m.when) >= ymd(from) && ymd(m.when) <= ymd(to)).map((m) => m.id));
  const got = new Set(res.leagues.flatMap((l) => l.events.map((e) => e.id)));
  assert.deepEqual([...got].sort(), [...expected].sort(), 'every match in the range, nothing else');
  // 4 calendar requests + one request per (competition, day with matches)
  const dayCalls = calls.filter((u) => /dates=\d{8}$/.test(u));
  const daysWithMatches = new Set(schedule().filter((m) => expected.has(m.id)).map((m) => `${m.league}:${ymd(m.when)}`));
  assert.equal(dayCalls.length, daysWithMatches.size, 'no request for days without matches');
  assert.equal(calls.length - dayCalls.length, 4, 'one calendar request per competition');
});

test('cache: second identical call makes no request', async () => {
  const { api, calls } = await freshApi();
  await api.fetchFootballRange(at(-1), at(6), ['uefa.champions', 'fra.1']);
  const first = calls.length;
  await api.fetchFootballRange(at(-1), at(6), ['uefa.champions', 'fra.1']);
  assert.equal(calls.length, first);
  await api.clearCache();
  await api.fetchFootball(at(0), ['fra.1']);
  assert.equal(calls.length, first + 1, 'clearCache forces a refetch');
});

test('one failing competition does not hide the others', async () => {
  const { api } = await freshApi('fail-eng');
  const res = await api.fetchFootballRange(at(0), at(3), ['uefa.champions', 'eng.1']);
  assert.deepEqual(res.errors, ['eng.1']);
  assert.equal(res.failedAll, false);
  assert.ok(res.leagues.some((l) => l.id === 'uefa.champions'));
});

test('malformed events are skipped, not fatal', async () => {
  const { api } = await freshApi();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ leagues: [{ name: 'X' }], events: [{ id: 'bad' }, null, { id: 'x', competitions: [{ competitors: [] }] }] }), { status: 200 });
  const res = await api.fetchFootball(at(0), ['ita.1']);
  assert.equal(res.failedAll, false);
  assert.equal(res.leagues.length, 0);
});

test('403 from ESPN pauses every request, then reports when it resumes', async () => {
  const { api, calls } = await freshApi('throttle');
  const res = await api.fetchFootball(at(0), ['uefa.champions', 'fra.1', 'eng.1', 'esp.1', 'ita.1', 'ger.1']);
  assert.equal(res.failedAll, true);
  assert.ok(res.blockedUntil > Date.now() + 60000, 'blocked for at least a minute');
  assert.ok(calls.length <= 4, `stopped after the first wave (${calls.length} requests)`);
  const before = calls.length;
  await assert.rejects(api.fetchF1(), (e) => e.blockedUntil > Date.now());
  assert.equal(calls.length, before, 'no request while paused');
  assert.ok((await api.getCooldown()) > Date.now());
});

test('F1: current weekend, sessions in order, next GP and round number', async () => {
  const { api } = await freshApi();
  const f1 = await api.fetchF1();
  assert.equal(f1.current.name, 'Grand Prix du Mexique');
  assert.deepEqual(f1.current.sessions.map((s) => s.abbr), ['FP1', 'FP2', 'FP3', 'Qual', 'Race']);
  assert.equal(f1.current.sessions.find((s) => s.abbr === 'Qual').state, 'in');
  assert.equal(f1.next.name, 'Grand Prix du Brésil');
  assert.equal(f1.round, 1);
  const st = await api.fetchF1Standings();
  assert.equal(st[0].rows[0].name, 'Max Verstappen');
  assert.equal(st[0].rows[0].pts, '320');
});

test('standings and GT calendar are parsed', async () => {
  const { api } = await freshApi();
  const s = await api.fetchStandings('fra.1');
  assert.equal(s.groups[0].rows.length, 18);
  assert.equal(s.groups[0].rows[0].team, 'PSG');
  assert.equal(s.groups[0].rows[0].zone, '#81D6AC');
  const gt = await api.fetchGT([{ id: '4439', name: 'GTWC' }, { id: '4410', name: 'BGT' }]);
  assert.equal(gt[0].last.name, '3 Hours of Portimão');
  assert.equal(gt[1].last.date, `${at(0).getFullYear()}-${String(at(0).getMonth() + 1).padStart(2, '0')}-${String(at(0).getDate()).padStart(2, '0')}`);
});

test('YouTube search: first videos parsed from the results page', async () => {
  const { api } = await freshApi();
  const v = await api.searchYouTube('PSG Barcelone résumé', { max: 2 });
  assert.equal(v.length, 2);
  assert.equal(v[0].id, 'vidAAAAAAA1');
  assert.equal(v[0].channel, 'CANAL+ Sport');
  assert.equal(v[0].length, '14:42');
});
