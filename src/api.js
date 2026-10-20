// Data fetching and normalisation (ESPN for football/F1, TheSportsDB for GT3).

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60000;

/* ---------------------------------------------------------------- Network: limit, retry, dedupe */

// At most MAX_PARALLEL requests in flight per context: ESPN throttles bursts of requests.
const MAX_PARALLEL = 4;
let active = 0;
const queue = [];
async function withSlot(fn) {
  if (active >= MAX_PARALLEL) await new Promise((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function fetchOnce(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- ESPN back-off */

// When ESPN answers 403 / 429 it is throttling this IP. Every further request extends the
// block, so all contexts (popup, page, service worker) stop calling ESPN for a while:
// 2, 4, 8, 16 then 30 minutes on repeated blocks. Shared through chrome.storage.local.
const COOLDOWN_KEY = 'apiCooldown';
let cooldown = { until: 0, strikes: 0 };
let cooldownLoaded = false;

async function loadCooldown() {
  if (cooldownLoaded) return cooldown;
  try {
    const got = await globalThis.chrome?.storage?.local?.get(COOLDOWN_KEY);
    if (got?.[COOLDOWN_KEY]) cooldown = got[COOLDOWN_KEY];
  } catch {
    /* preview */
  }
  cooldownLoaded = true;
  return cooldown;
}

async function saveCooldown() {
  try {
    await globalThis.chrome?.storage?.local?.set({ [COOLDOWN_KEY]: cooldown });
  } catch {
    /* preview */
  }
}

try {
  // Keep every context in sync when another one records a block.
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[COOLDOWN_KEY]) cooldown = changes[COOLDOWN_KEY].newValue ?? { until: 0, strikes: 0 };
  });
} catch {
  /* preview */
}

/** Timestamp until which ESPN requests are paused (0 when not blocked). */
export async function getCooldown() {
  await loadCooldown();
  return cooldown.until > Date.now() ? cooldown.until : 0;
}

const isEspn = (url) => url.startsWith('https://site.api.espn.com/');

const inflight = new Map(); // url -> Promise, so identical concurrent calls share one request

/** GET JSON with a concurrency limit and up to 2 retries on network errors, 429 and 5xx. */
function getJSON(url, { timeoutMs = 12000 } = {}) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    if (isEspn(url)) {
      await loadCooldown();
      if (cooldown.until > Date.now()) {
        const err = new Error('ESPN cooldown');
        err.blockedUntil = cooldown.until;
        throw err;
      }
    }
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await withSlot(async () => {
          // Re-check once a slot frees up: a sibling request may have just been throttled.
          if (isEspn(url) && cooldown.until > Date.now()) {
            const err = new Error('ESPN cooldown');
            err.blockedUntil = cooldown.until;
            throw err;
          }
          try {
            return await fetchOnce(url, timeoutMs);
          } catch (e) {
            // Record the block before releasing the slot, so queued requests see it.
            if (isEspn(url) && (e.status === 403 || e.status === 429)) {
              if (cooldown.until <= Date.now()) {
                const strikes = (cooldown.strikes || 0) + 1;
                cooldown = { strikes, until: Date.now() + Math.min(30, 2 * 2 ** (strikes - 1)) * MIN };
                saveCooldown();
              }
              e.blockedUntil = cooldown.until;
            }
            throw e;
          }
        });
        if (isEspn(url) && cooldown.strikes) {
          cooldown = { until: 0, strikes: 0 };
          saveCooldown();
        }
        return data;
      } catch (e) {
        lastErr = e;
        // Throttled (this request or a sibling): back off for everyone instead of retrying.
        // Requests failing in the same wave count as one strike.
        if (e.blockedUntil) break;
        // Other 4xx won't get better by retrying.
        if (e.status && e.status < 500) break;
        await sleep(700 * (attempt + 1) + Math.random() * 300);
      }
    }
    throw lastErr;
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/* ---------------------------------------------------------------- Shared cache */

// Normalised results are cached in chrome.storage.session, which is shared by the popup,
// the full-screen page and the service worker, survives closing the popup and is wiped
// when the browser closes. A small in-memory layer avoids hitting storage on every call.
const PREFIX = 'c:';
const memory = new Map(); // key -> { t, ttl, data }
const session = () => globalThis.chrome?.storage?.session;

async function readEntry(key) {
  const m = memory.get(key);
  if (m) return m;
  try {
    const got = await session()?.get(key);
    const e = got?.[key];
    if (e) memory.set(key, e);
    return e ?? null;
  } catch {
    return null;
  }
}

async function writeEntry(key, entry) {
  memory.set(key, entry);
  const s = session();
  if (!s) return;
  try {
    await s.set({ [key]: entry });
  } catch {
    // Quota reached (10 MB): drop the oldest half of our entries and try once more.
    try {
      const all = await s.get(null);
      const mine = Object.entries(all).filter(([k]) => k.startsWith(PREFIX)).sort((x, y) => x[1].t - y[1].t);
      await s.remove(mine.slice(0, Math.ceil(mine.length / 2)).map(([k]) => k));
      await s.set({ [key]: entry });
    } catch {
      /* memory cache only */
    }
  }
}

/**
 * Returns the cached value for `key` if younger than `ttl` ms, otherwise runs `produce()`
 * and caches its result. On failure, serves the stale value when there is one.
 */
async function cached(key, ttl, produce) {
  key = PREFIX + key;
  const hit = await readEntry(key);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  try {
    const data = await produce();
    await writeEntry(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data;
    throw e;
  }
}

/** Empties the cache (manual refresh button). */
export async function clearCache() {
  memory.clear();
  try {
    const s = session();
    if (!s) return;
    const all = await s.get(null);
    await s.remove(Object.keys(all).filter((k) => k.startsWith(PREFIX)));
  } catch {
    /* nothing to clear */
  }
}

/** Cache lifetime for one day of football data (YYYYMMDD): short for today, long for the past. */
function dayTtl(day) {
  const today = ymd(new Date());
  if (day < today) return 6 * 60 * MIN; // finished matches don't change
  if (day > today) return 15 * MIN; // fixtures only
  return 30 * 1000; // live scores
}

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function isoDay(date) {
  const s = ymd(date);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
}

/* ---------------------------------------------------------------- Football */

function footStatus(status) {
  const t = status?.type ?? {};
  const name = t.name ?? '';
  const state = t.state ?? 'pre';
  // `code` is translated by the UI (see i18n.js, keys "st.*"); `clock` is the match minute.
  let code = '';
  let clock = '';
  if (state === 'pre') {
    if (name === 'STATUS_POSTPONED') code = 'postponed';
    else if (name === 'STATUS_CANCELED') code = 'canceled';
    else if (name === 'STATUS_DELAYED') code = 'delayed';
  } else if (state === 'in') {
    if (name === 'STATUS_HALFTIME') code = 'ht';
    else if (name === 'STATUS_SHOOTOUT') code = 'pens';
    else if (name === 'STATUS_END_OF_REGULATION') code = 'end90';
    else if (name === 'STATUS_END_OF_EXTRATIME') code = 'endet';
    else if (status?.displayClock && status.displayClock !== "0'") clock = status.displayClock;
    else code = 'live';
  } else {
    if (name === 'STATUS_FINAL_AET') code = 'aet';
    else if (name === 'STATUS_FINAL_PEN') code = 'pen';
    else if (name === 'STATUS_ABANDONED') code = 'abandoned';
    else if (name === 'STATUS_POSTPONED') code = 'postponed';
    else if (name === 'STATUS_CANCELED') code = 'canceled';
    else code = 'ft';
  }
  return { state, live: state === 'in', code, clock, name };
}

function footSide(c) {
  if (!c) return null;
  return {
    id: c.team?.id ?? c.id,
    name: c.team?.shortDisplayName || c.team?.displayName || '?',
    fullName: c.team?.displayName || '',
    logo: c.team?.logo || '',
    score: c.score ?? '',
    shootout: c.shootoutScore ?? null,
    winner: !!c.winner,
  };
}

function footDetails(comp) {
  const out = [];
  for (const d of comp?.details ?? []) {
    const type = d.type?.text ?? '';
    const isGoal = !!d.scoringPlay;
    const isRed = !!d.redCard;
    if (!isGoal && !isRed) continue;
    out.push({
      teamId: d.team?.id,
      minute: d.clock?.displayValue ?? '',
      player: d.athletesInvolved?.[0]?.shortName || d.athletesInvolved?.[0]?.displayName || '',
      kind: isRed ? 'red' : d.ownGoal ? 'og' : d.penaltyKick ? 'pen' : 'goal',
      type,
    });
  }
  return out;
}

function normalizeFootEvent(ev) {
  const comp = ev.competitions?.[0] ?? {};
  const cs = comp.competitors ?? [];
  const home = footSide(cs.find((c) => c.homeAway === 'home') ?? cs[0]);
  const away = footSide(cs.find((c) => c.homeAway === 'away') ?? cs[1]);
  const link =
    (ev.links ?? []).find((l) => (l.rel ?? []).includes('summary'))?.href ??
    ev.links?.[0]?.href ??
    '';
  return {
    id: ev.id,
    date: ev.date,
    status: footStatus(ev.status ?? comp.status),
    home,
    away,
    details: footDetails(comp),
    venue: comp.venue?.fullName ?? '',
    note: comp.notes?.[0]?.headline ?? '',
    link,
  };
}

/** Matches on a given date for a list of competitions. */
export async function fetchFootball(date, leagueIds) {
  return fetchFootballRange(date, date, leagueIds);
}

/** One competition on one ESPN day (YYYYMMDD), normalised and cached. */
function leagueDay(id, day) {
  return cached(`foot:${id}:${day}`, dayTtl(day), async () =>
    normalizeLeague(id, await getJSON(`${ESPN}/soccer/${id}/scoreboard?dates=${day}`))
  );
}

/**
 * Days with matches for a competition (Set of YYYYMMDD), from the scoreboard's calendar
 * whitelist, or null when ESPN doesn't provide one. Cached 12 h.
 */
async function leagueCalendar(id) {
  const days = await cached(`cal:${id}`, 12 * 60 * MIN, async () => {
    const lg = (await getJSON(`${ESPN}/soccer/${id}/scoreboard`))?.leagues?.[0];
    if (!lg?.calendarIsWhitelist || !Array.isArray(lg.calendar)) return null;
    return lg.calendar
      .map((c) => (typeof c === 'string' ? c : c?.startDate ?? c?.value ?? ''))
      .map((s) => s.slice(0, 10).replace(/-/g, ''))
      .filter((s) => /^\d{8}$/.test(s));
  });
  return days ? new Set(days) : null;
}

/**
 * Matches between two dates (inclusive) for a list of competitions.
 * ESPN's soccer API rejects date ranges, so a range is fetched day by day, but only on the
 * days each competition actually plays (its calendar), and every day is cached on its own.
 */
export async function fetchFootballRange(from, to, leagueIds) {
  const days = [];
  for (let d = new Date(from); ymd(d) <= ymd(to); d.setDate(d.getDate() + 1)) days.push(ymd(d));

  const results = await Promise.allSettled(
    leagueIds.map(async (id) => {
      let want = days;
      if (days.length > 1) {
        const cal = await leagueCalendar(id).catch((e) => {
          if (e.blockedUntil) throw e;
          return null;
        });
        if (cal) want = days.filter((d) => cal.has(d));
      }
      if (!want.length) return null;
      const parts = await Promise.allSettled(want.map((d) => leagueDay(id, d)));
      const ok = parts.filter((p) => p.status === 'fulfilled').map((p) => p.value);
      if (!ok.length) throw parts[0].reason;
      const found = ok.filter(Boolean);
      if (!found.length) return null;
      const seen = new Set();
      const events = found
        .flatMap((lg) => lg.events)
        .filter((e) => !seen.has(e.id) && seen.add(e.id))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      return { ...found[0], events };
    })
  );
  const leagues = [];
  const errors = [];
  let blockedUntil = 0;
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      errors.push(leagueIds[i]);
      blockedUntil = Math.max(blockedUntil, r.reason?.blockedUntil ?? 0);
    } else if (r.value) leagues.push(r.value);
  });
  return { leagues, errors, blockedUntil, failedAll: errors.length === leagueIds.length && leagueIds.length > 0 };
}

/** ESPN scoreboard → { id, name, logo, events } or null when there's no match. */
function normalizeLeague(id, data) {
  const events = [];
  // One malformed event must not take the whole competition down with it.
  for (const ev of data?.events ?? []) {
    try {
      const n = normalizeFootEvent(ev);
      if (n.home && n.away) events.push(n);
    } catch {
      /* skip this event */
    }
  }
  if (!events.length) return null;
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  const lg = data.leagues?.[0] ?? {};
  return { id, name: lg.name || lg.abbreviation || id, logo: lg.logos?.[0]?.href ?? '', events };
}

/* ---------------------------------------------------------------- F1 */

function f1Session(c) {
  const abbr = c.type?.abbreviation ?? c.type?.text ?? '';
  const st = c.status?.type ?? {};
  const drivers = (c.competitors ?? [])
    .map((d) => ({
      pos: d.order ?? 0,
      name: d.athlete?.displayName || d.athlete?.fullName || '?',
      short: d.athlete?.shortName || '',
      flag: d.athlete?.flag?.href || '',
      flagAlt: d.athlete?.flag?.alt || '',
      winner: !!d.winner,
    }))
    .sort((a, b) => a.pos - b.pos);
  return {
    id: c.id,
    abbr,
    date: c.date,
    state: st.state ?? 'pre',
    completed: !!st.completed,
    drivers,
  };
}

function normalizeF1Event(ev) {
  return {
    id: ev.id,
    name: ev.name ?? ev.shortName ?? 'Grand Prix',
    date: ev.date,
    endDate: ev.endDate ?? ev.date,
    circuit: ev.circuit?.fullName ?? ev.competitions?.[0]?.venue?.fullName ?? '',
    sessions: (ev.competitions ?? []).map(f1Session).sort((a, b) => new Date(a.date) - new Date(b.date)),
    link: ev.links?.[0]?.href ?? '',
  };
}

function eventIdFromRef(ref) {
  const m = /events\/(\d+)/.exec(ref ?? '');
  return m ? m[1] : null;
}

/** Current weekend (or last GP) + next GP. */
export function fetchF1(now = new Date()) {
  return cached('f1', 30 * 1000, () => fetchF1Live(now));
}

async function fetchF1Live(now) {
  const base = await getJSON(`${ESPN}/racing/f1/scoreboard`);
  const calendar = (base.leagues?.[0]?.calendar ?? []).map((c) => ({
    name: c.label,
    start: c.startDate,
    end: c.endDate,
    id: eventIdFromRef(c.event?.$ref),
  }));
  let current = base.events?.[0] ? normalizeF1Event(base.events[0]) : null;

  // If a GP is running today (± 1 day) and it isn't the one returned, load it explicitly.
  const DAY = 86400000;
  const live = calendar.find(
    (c) => new Date(c.start).getTime() - DAY <= now.getTime() && now.getTime() <= new Date(c.end).getTime() + DAY
  );
  if (live && (!current || (live.id && live.id !== current.id))) {
    try {
      const d = await getJSON(`${ESPN}/racing/f1/scoreboard?dates=${ymd(new Date(live.start))}`);
      const ev = (d.events ?? []).find((e) => !live.id || e.id === live.id) ?? d.events?.[0];
      if (ev) current = normalizeF1Event(ev);
    } catch {
      /* keep the previous one */
    }
  }

  const next = calendar.find((c) => new Date(c.start) > now && (!current || c.id !== current.id)) ?? null;
  const round = current ? calendar.findIndex((c) => c.id === current.id) + 1 : 0;
  return { current, next, round, total: calendar.length };
}

/* ---------------------------------------------------------------- Standings */

const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports';

function stat(entry, ...names) {
  for (const n of names) {
    const s = (entry.stats ?? []).find((x) => x.name === n || x.type === n);
    if (s) return s.displayValue ?? String(s.value ?? '');
  }
  return '';
}

function collectGroups(node, out = []) {
  if (node?.standings?.entries?.length) out.push({ name: node.name ?? '', entries: node.standings.entries });
  for (const c of node?.children ?? []) collectGroups(c, out);
  return out;
}

/** Football table for a competition (handles groups). */
export function fetchStandings(leagueId) {
  return cached(`stand:${leagueId}`, 10 * MIN, () => fetchStandingsLive(leagueId));
}

async function fetchStandingsLive(leagueId) {
  const data = await getJSON(`${ESPN_V2}/soccer/${leagueId}/standings`);
  const groups = collectGroups(data).map((g) => ({
    name: g.name,
    rows: g.entries
      .map((e) => ({
        rank: Number(stat(e, 'rank')) || 0,
        team: e.team?.shortDisplayName || e.team?.displayName || '?',
        fullName: e.team?.displayName || '',
        logo: e.team?.logos?.[0]?.href ?? '',
        played: stat(e, 'gamesPlayed'),
        win: stat(e, 'wins'),
        draw: stat(e, 'ties'),
        loss: stat(e, 'losses'),
        diff: stat(e, 'pointDifferential'),
        pts: stat(e, 'points'),
        zone: e.note?.color ?? '',
        zoneLabel: e.note?.description ?? '',
      }))
      .sort((a, b) => a.rank - b.rank),
  }));
  return { name: data.name ?? '', groups };
}

/** F1 championship: drivers (and constructors when provided). */
export function fetchF1Standings() {
  return cached('f1stand', 10 * MIN, fetchF1StandingsLive);
}

async function fetchF1StandingsLive() {
  const data = await getJSON(`${ESPN_V2}/racing/f1/standings`);
  return (data.children ?? []).map((c) => ({
    name: c.name ?? '',
    rows: (c.standings?.entries ?? [])
      .map((e) => ({
        rank: Number(stat(e, 'rank')) || 0,
        name: e.athlete?.displayName || e.team?.displayName || e.team?.name || '?',
        flag: e.athlete?.flag?.href ?? e.team?.logos?.[0]?.href ?? '',
        pts: stat(e, 'championshipPts', 'points'),
      }))
      .sort((a, b) => a.rank - b.rank),
  }));
}

/* ---------------------------------------------------------------- YouTube */

function collectVideos(node, out, max) {
  if (!node || typeof node !== 'object' || out.length >= max) return;
  if (Array.isArray(node)) {
    for (const n of node) collectVideos(n, out, max);
    return;
  }
  const v = node.videoRenderer;
  if (v?.videoId) {
    out.push({
      id: v.videoId,
      title: v.title?.runs?.map((r) => r.text).join('') ?? v.title?.simpleText ?? '',
      channel: v.ownerText?.runs?.[0]?.text ?? v.longBylineText?.runs?.[0]?.text ?? '',
      length: v.lengthText?.simpleText ?? '',
      published: v.publishedTimeText?.simpleText ?? '',
      views: v.shortViewCountText?.simpleText ?? v.viewCountText?.simpleText ?? '',
      thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    });
    return;
  }
  for (const k of Object.keys(node)) collectVideos(node[k], out, max);
}

/**
 * First videos of a YouTube search (no API key: parses ytInitialData from the results page).
 * Uses the user's YouTube cookies so the EU consent wall doesn't block the request.
 */
export function searchYouTube(query, { max = 5, hl = 'fr' } = {}) {
  return cached(`yt:${hl}:${query}`, 60 * MIN, () => searchYouTubeLive(query, max, hl));
}

async function searchYouTubeLive(query, max, hl) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=${hl}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const start = html.indexOf('ytInitialData = ');
  if (start < 0) throw new Error('no ytInitialData (consent page?)');
  const from = start + 'ytInitialData = '.length;
  const end = html.indexOf(';</script>', from);
  const data = JSON.parse(html.slice(from, end));
  const out = [];
  collectVideos(data?.contents ?? data, out, max);
  return out;
}

/* ---------------------------------------------------------------- GT3 */

function gtEvent(e) {
  if (!e) return null;
  return {
    id: e.idEvent,
    name: e.strEvent,
    date: e.dateEvent, // YYYY-MM-DD
    time: e.strTime && e.strTime !== '00:00:00' ? e.strTimestamp : null,
    venue: e.strVenue ?? '',
    country: e.strCountry ?? '',
    season: e.strSeason ?? '',
    league: e.strLeague ?? '',
    status: e.strStatus ?? '',
  };
}

/** Last and next event of each GT championship. */
export function fetchGT(leagues) {
  return cached(`gt:${leagues.map((l) => l.id).join(',')}`, 60 * MIN, async () => {
    const out = await fetchGTLive(leagues);
    // Don't cache a complete failure for an hour.
    if (out.length && out.every((c) => c.error)) throw new Error('GT unavailable');
    return out;
  });
}

async function fetchGTLive(leagues) {
  const out = await Promise.all(
    leagues.map(async (lg) => {
      const [past, next] = await Promise.allSettled([
        getJSON(`${TSDB}/eventspastleague.php?id=${lg.id}`),
        getJSON(`${TSDB}/eventsnextleague.php?id=${lg.id}`),
      ]);
      const pastEvents = past.status === 'fulfilled' ? past.value.events ?? [] : [];
      const nextEvents = next.status === 'fulfilled' ? next.value.events ?? [] : [];
      const last = pastEvents
        .map(gtEvent)
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
      const upcoming = nextEvents.map(gtEvent).sort((a, b) => (a.date > b.date ? 1 : -1));
      return {
        id: lg.id,
        name: last?.league || upcoming[0]?.league || lg.name,
        last,
        next: upcoming[0] ?? null,
        error: past.status === 'rejected' && next.status === 'rejected',
      };
    })
  );
  return out;
}
