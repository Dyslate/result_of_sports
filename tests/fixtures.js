// Fake API responses for the tests, built relative to today's date so the suite never goes stale.
// Every external request made by the extension goes through respond(); nothing reaches the network.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAY_HTML = readFileSync(path.join(ROOT, 'docs', 'player.html'), 'utf8');

const DAY = 86400000;
const MIN = 60000;
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const isoZ = (d) => d.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');

/** Local noon `offset` days from today, plus `hours`. */
export function at(offset, hours = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return new Date(d.getTime() + offset * DAY + hours * 3600000);
}

const LOGO = (id) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
const team = (id, name, short, score, extra = {}) => ({ id, name, short, score, ...extra });

/**
 * Match schedule. `when` is a Date, `state` is pre / in / post.
 * Today (offset 0) has a live match, a half-time match, a finished one and an upcoming one.
 */
export function schedule() {
  const now = Date.now();
  return [
    // Champions League
    { id: '1001', league: 'uefa.champions', when: new Date(now - 70 * MIN), state: 'in', status: 'STATUS_SECOND_HALF', clock: "67'",
      home: team('160', 'Paris Saint-Germain', 'PSG', 2), away: team('83', 'Barcelona', 'Barcelona', 1),
      details: [['160', "12'", 'O. Dembélé'], ['83', "33'", 'Lamine Yamal'], ['160', "58'", 'D. Doué', { penaltyKick: true }], ['83', "61'", 'P. Cubarsí', { red: true }]] },
    { id: '1002', league: 'uefa.champions', when: new Date(now - 50 * MIN), state: 'in', status: 'STATUS_HALFTIME', clock: "45'",
      home: team('382', 'Manchester City', 'Man City', 0), away: team('887', 'AEK Athens', 'AEK Athens', 0) },
    { id: '1003', league: 'uefa.champions', when: new Date(now - 4 * 3600000), state: 'post', status: 'STATUS_FULL_TIME',
      home: team('364', 'Liverpool', 'Liverpool', 3, { winner: true }), away: team('102', 'Villarreal', 'Villarreal', 0), details: [['364', "9'", 'M. Salah']] },
    { id: '1004', league: 'uefa.champions', when: new Date(now + 3 * 3600000), state: 'pre', status: 'STATUS_SCHEDULED',
      home: team('114', 'Napoli', 'Napoli', 0), away: team('8079', 'Bodo/Glimt', 'Bodo/Glimt', 0) },
    { id: '1005', league: 'uefa.champions', when: at(1, 9), state: 'pre', status: 'STATUS_SCHEDULED',
      home: team('86', 'Real Madrid', 'Real Madrid', 0), away: team('132', 'Juventus', 'Juventus', 0) },
    { id: '1006', league: 'uefa.champions', when: at(-1, 9), state: 'post', status: 'STATUS_FULL_TIME',
      home: team('124', 'Bayern Munich', 'Bayern', 1), away: team('359', 'Arsenal', 'Arsenal', 1) },
    // Ligue 1
    { id: '2001', league: 'fra.1', when: new Date(now - 5 * 3600000), state: 'post', status: 'STATUS_FINAL_PEN',
      home: team('176', 'Metz', 'Metz', 1, { winner: true, shootout: 5 }), away: team('167', 'Lyon', 'Lyon', 1, { shootout: 4 }) },
    { id: '2002', league: 'fra.1', when: new Date(now + 5 * 3600000), state: 'pre', status: 'STATUS_SCHEDULED',
      home: team('176b', 'Marseille', 'Marseille', 0), away: team('6997', 'Brest', 'Brest', 0) },
    { id: '2003', league: 'fra.1', when: at(3, 8), state: 'pre', status: 'STATUS_SCHEDULED',
      home: team('166', 'Monaco', 'Monaco', 0), away: team('166b', 'Lille', 'Lille', 0) },
    { id: '2004', league: 'fra.1', when: at(12, 8), state: 'pre', status: 'STATUS_SCHEDULED',
      home: team('160', 'Paris Saint-Germain', 'PSG', 0), away: team('176b', 'Marseille', 'Marseille', 0) },
    // Premier League: 2 days later only
    { id: '3001', league: 'eng.1', when: at(2, 3), state: 'pre', status: 'STATUS_SCHEDULED',
      home: team('359', 'Arsenal', 'Arsenal', 0), away: team('363', 'Chelsea', 'Chelsea', 0) },
  ];
}

function espnEvent(m) {
  const side = (t, homeAway) => ({
    homeAway, score: String(t.score), winner: !!t.winner,
    ...(t.shootout != null ? { shootoutScore: t.shootout } : {}),
    team: { id: t.id, displayName: t.name, shortDisplayName: t.short, logo: LOGO(t.id) },
  });
  const details = (m.details ?? []).map(([teamId, minute, player, opt = {}]) => ({
    scoringPlay: !opt.red, redCard: !!opt.red, penaltyKick: !!opt.penaltyKick,
    team: { id: teamId }, clock: { displayValue: minute },
    athletesInvolved: [{ displayName: player, shortName: player }],
  }));
  return {
    id: m.id,
    date: isoZ(m.when),
    status: { displayClock: m.clock ?? "0'", type: { name: m.status, state: m.state } },
    links: [{ rel: ['summary'], href: `https://www.espn.com/soccer/match/_/gameId/${m.id}` }],
    competitions: [{ competitors: [side(m.home, 'home'), side(m.away, 'away')], venue: { fullName: 'Stade de test' }, details }],
  };
}

const LEAGUE_NAMES = { 'uefa.champions': 'UEFA Champions League', 'fra.1': 'French Ligue 1', 'eng.1': 'English Premier League' };

function scoreboard(league, day) {
  const events = schedule()
    .filter((m) => m.league === league && (!day || ymd(m.when) === day))
    .map(espnEvent);
  const calendar = [...new Set(schedule().filter((m) => m.league === league).map((m) => ymd(m.when)))]
    .sort()
    .map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T07:00Z`);
  return {
    leagues: [{ name: LEAGUE_NAMES[league] ?? league, logos: [{ href: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png' }], calendarIsWhitelist: true, calendarType: 'day', calendar }],
    events: day ? events : [],
  };
}

function standings() {
  const names = ['Paris Saint-Germain', 'Marseille', 'Monaco', 'Lille', 'Nice', 'Lyon', 'Lens', 'Rennes', 'Strasbourg', 'Brest', 'Toulouse', 'Metz', 'Nantes', 'Auxerre', 'Angers', 'Le Havre', 'Lorient', 'Le Mans'];
  const zone = (i) => (i < 3 ? ['#81D6AC', 'Champions League'] : i < 5 ? ['#B5E4F7', 'Europa League'] : i >= 16 ? ['#FF7F84', 'Relegation'] : null);
  return {
    name: 'Ligue 1',
    children: [{ name: '2026-27', standings: { entries: names.map((n, i) => ({
      team: { displayName: n, shortDisplayName: n === 'Paris Saint-Germain' ? 'PSG' : n, logos: [{ href: LOGO(100 + i) }] },
      ...(zone(i) ? { note: { color: zone(i)[0], description: zone(i)[1] } } : {}),
      stats: [['rank', i + 1], ['gamesPlayed', 9], ['wins', 8 - Math.floor(i / 3)], ['ties', 1], ['losses', Math.floor(i / 3)], ['pointDifferential', 18 - i], ['points', 25 - i]]
        .map(([name, v]) => ({ name, displayValue: String(v) })),
    })) } }],
  };
}

const DRIVERS = [['Max Verstappen', 'ned'], ['Charles Leclerc', 'mon'], ['Lando Norris', 'gbr'], ['Oscar Piastri', 'aus'], ['George Russell', 'gbr'], ['Lewis Hamilton', 'gbr'],
  ['Kimi Antonelli', 'ita'], ['Pierre Gasly', 'fra'], ['Isack Hadjar', 'fra'], ['Fernando Alonso', 'esp'], ['Esteban Ocon', 'fra'], ['Carlos Sainz', 'esp']];
const flag = (c) => ({ href: `https://a.espncdn.com/i/teamlogos/countries/500/${c}.png`, alt: c });

function f1() {
  const start = at(-1, -2);
  const sess = (id, abbr, when, state) => ({
    id, type: { abbreviation: abbr }, date: isoZ(when), status: { type: { state, completed: state === 'post' } },
    competitors: state === 'pre' ? [] : DRIVERS.map(([n, c], i) => ({ order: i + 1, athlete: { displayName: n, flag: flag(c) } })),
  });
  const end = new Date(start.getTime() + 2 * DAY + 4 * 3600000);
  return {
    leagues: [{ calendar: [
      { label: 'Grand Prix du Mexique', startDate: isoZ(start), endDate: isoZ(end), event: { $ref: 'x/events/900' } },
      { label: 'Grand Prix du Brésil', startDate: isoZ(at(12)), endDate: isoZ(at(14)), event: { $ref: 'x/events/901' } },
    ] }],
    events: [{ id: '900', name: 'Grand Prix du Mexique', date: isoZ(start), endDate: isoZ(end), circuit: { fullName: 'Autódromo Hermanos Rodríguez' },
      links: [{ href: 'https://www.espn.com/f1/' }],
      competitions: [sess('a', 'FP1', start, 'post'), sess('b', 'FP2', new Date(start.getTime() + 4 * 3600000), 'post'),
        sess('c', 'FP3', new Date(Date.now() - 3 * 3600000), 'post'), sess('d', 'Qual', new Date(Date.now() - 20 * MIN), 'in'), sess('e', 'Race', at(1), 'pre')] }],
  };
}

const f1Standings = () => ({ children: [{ name: 'Driver Standings', standings: { entries: DRIVERS.map(([n, c], i) => ({
  athlete: { displayName: n, flag: flag(c) }, stats: [{ name: 'rank', displayValue: String(i + 1) }, { name: 'championshipPts', displayValue: String(320 - i * 23) }],
})) } }] });

const day = (o) => { const d = at(o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const gtEv = (id, name, offset, venue, country, league) => ({ idEvent: id, strEvent: name, dateEvent: day(offset), strTime: '00:00:00', strVenue: venue, strCountry: country, strSeason: '2026', strLeague: league });

/** Video whose owner forbids playback outside YouTube (like beIN SPORTS highlights). */
export const BLOCKED_VIDEO = 'vidAAAAAAA1';

export const YT_VIDEOS = [
  ['vidAAAAAAA1', 'Résumé : PSG renverse le Barça !', 'CANAL+ Sport', '14:42'],
  ['vidAAAAAAA2', 'PSG - Barcelone : les buts', 'RMC Sport', '6:10'],
  ['vidAAAAAAA3', 'Les réactions après le match', 'Téléfoot', '9:31'],
];
const ytData = () => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents:
  YT_VIDEOS.map(([videoId, title, ch, len]) => ({ videoRenderer: { videoId, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: ch }] }, lengthText: { simpleText: len }, publishedTimeText: { simpleText: '16 h' }, shortViewCountText: { simpleText: '31 k' } } })),
} }] } } } } });

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/**
 * Builds a response for `url`. `mode`: 'ok' | 'throttle' (ESPN answers 403) | 'fail-eng' (Premier League 500)
 * | 'all-blocked' (every YouTube video refuses to play outside YouTube).
 * Returns { status, contentType, body } or null to let the request through (local files).
 */
export function respond(url, mode = 'ok') {
  const u = new URL(url);
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (u.hostname.endsWith('espncdn.com') || u.hostname === 'i.ytimg.com') return { status: 200, contentType: 'image/png', body: PNG };

  if (u.hostname === 'site.api.espn.com') {
    if (mode === 'throttle') return { status: 403, contentType: 'text/html', body: 'Forbidden' };
    const dates = u.searchParams.get('dates');
    // ESPN rejects date ranges for soccer: the extension must never send one.
    if (dates && dates.includes('-')) return { status: 403, contentType: 'text/html', body: 'range not allowed' };
    let m;
    if ((m = u.pathname.match(/\/soccer\/([^/]+)\/scoreboard$/))) {
      if (mode === 'fail-eng' && m[1] === 'eng.1') return { status: 500, contentType: 'text/plain', body: 'boom' };
      return json(scoreboard(m[1], dates));
    }
    if (u.pathname.match(/\/soccer\/[^/]+\/standings$/)) return json(standings());
    if (u.pathname.endsWith('/racing/f1/scoreboard')) return json(f1());
    if (u.pathname.endsWith('/racing/f1/standings')) return json(f1Standings());
    return json({}, 404);
  }

  if (u.hostname === 'www.thesportsdb.com') {
    const id = u.searchParams.get('id');
    const past = u.pathname.includes('past');
    if (id === '4439') return json({ events: [past ? gtEv('1', '3 Hours of Portimão', -2, 'Algarve International Circuit', 'Portugal', 'GT World Challenge Europe') : gtEv('2', '6 Hours of Paul Ricard', 170, 'Circuit Paul Ricard', 'France', 'GT World Challenge Europe')] });
    if (id === '4410') return json({ events: [past ? gtEv('3', 'Brands Hatch Race 2', 0, 'Brands Hatch', 'United Kingdom', 'British GT Championship') : gtEv('4', 'Donington Race 1', 180, 'Donington Park', 'United Kingdom', 'British GT Championship')] });
    return json({ events: null });
  }

  if (u.hostname === 'www.youtube.com' && u.pathname === '/results') {
    return { status: 200, contentType: 'text/html', body: `<html><script>var ytInitialData = ${JSON.stringify(ytData())};</script></html>` };
  }
  if (u.hostname === 'dyslate.github.io') return { status: 200, contentType: 'text/html', body: RELAY_HTML };
  if (u.hostname.endsWith('youtube-nocookie.com') && u.pathname.startsWith('/embed/')) {
    // Fake player speaking YouTube's postMessage protocol. Like beIN SPORTS videos, the first
    // result refuses to play outside YouTube (error 150); in 'all-blocked' mode, every video does.
    const id = u.pathname.split('/').pop();
    const blocked = mode === 'all-blocked' || id === BLOCKED_VIDEO;
    const reply = JSON.stringify(blocked ? { event: 'onError', info: 150 } : { event: 'onReady' });
    return { status: 200, contentType: 'text/html', body: `<body style="background:#000;color:#fff">${blocked ? 'blocked' : 'playing'} ${id}<script>
      addEventListener('message', (e) => { try { if (JSON.parse(e.data).event === 'listening') e.source.postMessage(${JSON.stringify(reply)}, e.origin); } catch {} });
    </script></body>` };
  }
  if (u.hostname.endsWith('youtube-nocookie.com') || u.hostname === 'www.youtube.com') {
    return { status: 200, contentType: 'text/html', body: '<body style="background:#000;color:#fff">player</body>' };
  }
  if (u.hostname === 'calendar.google.com' || u.hostname === 'www.espn.com') return { status: 200, contentType: 'text/html', body: 'ok' };
  return null;
}
