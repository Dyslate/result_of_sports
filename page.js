// Full-screen dashboard opened from the popup ("Open web page").
// Shows football, F1 and GT3 side by side, with standings and inline YouTube highlights.
import { fetchFootballRange, fetchF1, fetchGT, fetchStandings, fetchF1Standings, searchYouTube, clearCache, isoDay, ymd } from './src/api.js';
import { FOOT_LEAGUES, GT_LEAGUES, PLAYER_RELAY, loadSettings, saveSettings, isFavTeam, refreshMinutes } from './src/config.js';
import { t, setLang, lang, localName, applyI18n } from './src/i18n.js';
import { ensureEmbedReferer, openPopout } from './src/embed.js';
import {
  esc, norm, img, fmtTime, fmtDay, relDays, dayLabel, dayPhrase, emptyBox, skeleton, flag,
  THEME_ICONS, sessionName, defaultSession, leagueCard, standingsHtml, f1GpCard, f1NextCard, f1StandingsCard, gtCard,
} from './src/render.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  settings: null,
  // Football period: a day, a week, a month or a custom range (see rangeBounds()).
  range: { mode: 'day', anchor: noon(new Date()), from: null, to: null },
  liveOnly: false,
  query: '',
  foot: null,
  f1: null,
  f1Stand: null,
  gt: null,
  f1Session: null,
  f1ShowAll: true,
  f1StandShowAll: false,
  scores: new Map(),
  flashIds: new Set(),
  timer: null,
  loading: false,
};

const isFav = (team) => isFavTeam(team, state.settings.favorites);

/* ================================================================ date range */

const DAY = 86400000;
const MAX_RANGE_DAYS = 62;

function noon(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

const offsetOf = (d) => Math.round((noon(d) - noon(new Date())) / DAY);

/** { from, to } (both at noon, inclusive) for the current period. */
function rangeBounds() {
  const { mode, anchor } = state.range;
  if (mode === 'week') {
    const from = noon(anchor);
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // back to Monday
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to };
  }
  if (mode === 'month') {
    return {
      from: noon(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
      to: noon(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    };
  }
  if (mode === 'custom' && state.range.from) return { from: state.range.from, to: state.range.to };
  return { from: noon(anchor), to: noon(anchor) };
}

const isSingleDay = () => {
  const { from, to } = rangeBounds();
  return ymd(from) === ymd(to);
};

function rangeLabel() {
  const { mode } = state.range;
  const { from, to } = rangeBounds();
  const today = noon(new Date());
  if (mode === 'day' || ymd(from) === ymd(to)) return dayLabel(offsetOf(from));
  if (mode === 'month') {
    const s = fmtDay(from, { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (mode === 'week' && today >= from && today <= to) return t('range.thisWeek');
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${fmtDay(from, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${fmtDay(to, { day: 'numeric', month: 'short', ...(sameYear && to.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })}`;
}

/** Moves the period by n units (day / week / month / range length); n = 0 goes back to today. */
function shiftRange(n) {
  const r = state.range;
  if (n === 0) {
    if (r.mode === 'custom') return;
    r.anchor = noon(new Date());
  } else if (r.mode === 'day') r.anchor = new Date(r.anchor.getTime() + n * DAY);
  else if (r.mode === 'week') r.anchor = new Date(r.anchor.getTime() + 7 * n * DAY);
  else if (r.mode === 'month') {
    const first = noon(new Date(r.anchor.getFullYear(), r.anchor.getMonth() + n, 1));
    const today = noon(new Date());
    // Stay on today when coming back to the current month, so Day / Week land on today.
    r.anchor = first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth() ? today : first;
  }
  else {
    const len = Math.round((r.to - r.from) / DAY) + 1;
    r.from = new Date(r.from.getTime() + n * len * DAY);
    r.to = new Date(r.to.getTime() + n * len * DAY);
    fillRangeForm();
  }
  state.scores.clear();
  refresh({ footOnly: true });
}

function setRangeMode(mode) {
  const r = state.range;
  if (mode === r.mode) return;
  // The custom range starts from what is on screen. Leaving it keeps the previous anchor,
  // so Day / Week / Month come back to the period you were looking at before.
  if (mode === 'custom') {
    const { from, to } = rangeBounds();
    r.from = from;
    r.to = to;
  }
  r.mode = mode;
  paintRangeControls();
  state.scores.clear();
  refresh({ footOnly: true });
}

function paintRangeControls() {
  const { mode } = state.range;
  $$('.range-seg [data-range]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.range === mode)));
  $('#custom-range').hidden = mode !== 'custom';
  $('#day-label').textContent = rangeLabel();
  fillRangeForm();
}

function fillRangeForm() {
  if (state.range.mode !== 'custom') return;
  $('#range-from').value = isoDay(state.range.from);
  $('#range-to').value = isoDay(state.range.to);
  $('#day-label').textContent = rangeLabel();
}

function applyCustomRange(e) {
  e.preventDefault();
  const from = noon(new Date($('#range-from').value + 'T12:00:00'));
  const to = noon(new Date($('#range-to').value + 'T12:00:00'));
  const err = $('#range-err');
  if (Number.isNaN(+from) || Number.isNaN(+to) || to < from) {
    err.textContent = t('range.bad');
    return;
  }
  if ((to - from) / DAY + 1 > MAX_RANGE_DAYS) {
    err.textContent = t('range.tooLong');
    return;
  }
  err.textContent = '';
  state.range.from = from;
  state.range.to = to;
  paintRangeControls();
  state.scores.clear();
  refresh({ footOnly: true });
}

async function persist(patch) {
  Object.assign(state.settings, patch);
  await saveSettings(patch);
}

/* ================================================================ chrome: language & theme */

function applyLanguage() {
  setLang(state.settings.lang);
  applyI18n();
  $$('.lang-seg [data-lang]').forEach((b) => {
    b.innerHTML = flag(b.dataset.lang) + `<span>${b.dataset.lang.toUpperCase()}</span>`;
    b.setAttribute('aria-checked', String(b.dataset.lang === lang()));
  });
  const today = new Intl.DateTimeFormat(lang() === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  $('#today-long').textContent = today.charAt(0).toUpperCase() + today.slice(1);
  applyTheme();
}

function applyTheme() {
  const cfg = state.settings.themeCfg;
  window.applyThemeCfg?.(cfg);
  const custom = cfg.palette === 'custom';
  $('#theme-btn').innerHTML = custom ? THEME_ICONS.custom : THEME_ICONS[cfg.mode] ?? THEME_ICONS.auto;
  $('#theme-btn').title = custom ? t('theme.customTitle') : t('theme.modeTitle', { m: t(`theme.mode.${cfg.mode}`) });
}

function cycleTheme() {
  const cfg = { ...state.settings.themeCfg };
  if (cfg.palette === 'custom') cfg.palette = cfg.lastPreset || 'pelouse';
  else cfg.mode = ['auto', 'light', 'dark'][(['auto', 'light', 'dark'].indexOf(cfg.mode) + 1) % 3];
  persist({ themeCfg: cfg });
  applyTheme();
}

function setLanguage(l) {
  if (l === lang()) return;
  persist({ lang: l });
  applyLanguage();
  paintAll();
}

/* ================================================================ painting */

function matchesTileLabel() {
  if (!isSingleDay()) return t('page.matchesRange', { range: rangeLabel() });
  const off = offsetOf(rangeBounds().from);
  return off ? t('page.matchesOn', { day: dayLabel(off) }) : t('page.matches');
}

function paintKpis() {
  const foot = state.foot?.leagues ?? [];
  const liveFoot = foot.reduce((n, lg) => n + lg.events.filter((e) => e.status.live).length, 0);
  const total = foot.reduce((n, lg) => n + lg.events.length, 0);

  // F1 tile: live session, else next session of the weekend, else next GP.
  let f1Main = '—';
  let f1Sub = t('page.f1None');
  let f1Live = false;
  const gp = state.f1?.current;
  if (gp) {
    const live = gp.sessions.find((s) => s.state === 'in');
    const upcoming = gp.sessions.find((s) => s.state === 'pre');
    if (live) {
      f1Live = true;
      f1Main = sessionName(live.abbr);
      f1Sub = t('page.f1Live', { s: gp.name });
    } else if (upcoming) {
      f1Main = sessionName(upcoming.abbr);
      f1Sub = `${fmtDay(upcoming.date, { weekday: 'long' })} · ${fmtTime(upcoming.date)}`;
    }
  }
  if (!f1Live && !gp?.sessions.some((s) => s.state === 'pre') && state.f1?.next) {
    f1Main = relDays(state.f1.next.start);
    f1Sub = state.f1.next.name;
  }

  // GT tile.
  const gtCards = (state.gt ?? []).map(gtCard);
  const gtToday = gtCards.filter((c) => c.today).length;
  const nextGt = (state.gt ?? []).map((c) => c.next).filter(Boolean).sort((a, b) => (a.date > b.date ? 1 : -1))[0];
  const gtMain = gtToday ? String(gtToday) : nextGt ? relDays(nextGt.date + 'T12:00:00') : '—';
  const gtSub = gtToday ? t('page.gtToday', { n: gtToday }) : nextGt ? nextGt.name : t('page.gtNone');

  const tile = (cls, label, main, sub) =>
    `<div class="kpi ${cls}"><span class="kpi-label">${esc(label)}</span><strong class="kpi-main">${esc(main)}</strong><span class="kpi-sub">${esc(sub)}</span></div>`;
  $('#kpis').innerHTML = [
    tile(liveFoot + (f1Live ? 1 : 0) ? 'is-live' : '', t('page.liveNow'), String(liveFoot + (f1Live ? 1 : 0)), t('page.liveSub')),
    tile('', matchesTileLabel(), String(total), t('page.matchesSub', { n: foot.length })),
    tile(f1Live ? 'is-live' : 'f1', t('page.f1'), f1Main, f1Sub),
    tile('gt', t('page.gt'), gtMain, gtSub),
  ].join('');
}

function paintFoot() {
  const box = $('#foot');
  $('#day-label').textContent = rangeLabel();
  if (!state.settings.footLeagues.length) {
    box.innerHTML = emptyBox('⚙️', t('foot.noComp'), t('page.settingsHint'));
    return;
  }
  const data = state.foot;
  if (!data) return;
  if (data.failedAll) {
    box.className = 'foot-masonry';
    box.innerHTML = data.blockedUntil
      ? emptyBox('⏳', t('err.blocked'), t('err.blockedSub', { time: fmtTime(data.blockedUntil) }))
      : emptyBox('📡', t('foot.err'), t('err.sub'));
    return;
  }
  const q = norm(state.query);
  const order = FOOT_LEAGUES.map((l) => l.id);
  const favMatch = (e) => isFav(e.home) || isFav(e.away);
  const lgs = data.leagues
    .map((lg) => ({
      ...lg,
      name: localName(FOOT_LEAGUES.find((l) => l.id === lg.id)) || lg.name,
      events: lg.events
        .filter((e) => !state.liveOnly || e.status.live)
        .filter((e) => !q || norm(`${e.home.name} ${e.home.fullName} ${e.away.name} ${e.away.fullName}`).includes(q))
        .sort((a, b) => favMatch(b) - favMatch(a)),
    }))
    .filter((lg) => lg.events.length)
    .map((lg) => ({ ...lg, fav: lg.events.some(favMatch), live: lg.events.some((e) => e.status.live) }))
    // Favourites first, then competitions with a live match, then the usual order.
    .sort((a, b) => b.fav - a.fav || b.live - a.live || order.indexOf(a.id) - order.indexOf(b.id));

  const total = lgs.reduce((n, lg) => n + lg.events.length, 0);
  $('#foot-count').textContent = total ? String(total) : '';

  if (!lgs.length) {
    box.innerHTML = q
      ? emptyBox('🔎', t('foot.noResult'), t('foot.noTeam', { q: state.query }))
      : state.liveOnly
        ? emptyBox('📺', t('foot.noLive'), t('foot.noLiveSub'))
        : isSingleDay()
          ? emptyBox('🗓️', t('foot.noMatch'), t('foot.noMatchSub', { day: dayPhrase(offsetOf(rangeBounds().from)) }))
          : emptyBox('🗓️', t('foot.noMatch'), t('foot.noMatchRange'));
    box.className = 'foot-masonry';
    return;
  }
  const open = $$('#foot .match.open').map((m) => m.dataset.id);
  const opts = { favorites: state.settings.favorites, flashIds: state.flashIds, follow: false };
  if (isSingleDay()) {
    box.className = 'foot-masonry';
    box.innerHTML = lgs.map((lg) => leagueCard(lg, opts)).join('');
  } else {
    box.className = 'foot-days';
    box.innerHTML = paintDays(lgs, opts);
  }
  for (const id of open) $(`#foot .match[data-id="${CSS.escape(id)}"]`)?.classList.add('open');
}

/** Week / month / range view: one block per day, competitions inside. */
function paintDays(lgs, opts) {
  const days = new Map(); // YYYY-MM-DD -> Map(leagueId -> league with that day's events)
  for (const lg of lgs) {
    for (const e of lg.events) {
      const k = isoDay(new Date(e.date));
      if (!days.has(k)) days.set(k, new Map());
      const m = days.get(k);
      if (!m.has(lg.id)) m.set(lg.id, { ...lg, events: [] });
      m.get(lg.id).events.push(e);
    }
  }
  const todayIso = isoDay(new Date());
  return [...days.keys()]
    .sort()
    .map((k) => {
      const leagues = [...days.get(k).values()];
      for (const lg of leagues) lg.events.sort((a, b) => new Date(a.date) - new Date(b.date));
      const n = leagues.reduce((s, lg) => s + lg.events.length, 0);
      const d = k + 'T12:00:00';
      const title = fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' });
      return `<section class="day-block${k === todayIso ? ' is-today' : ''}" id="day-${k}">
        <h3 class="day-sep"><span>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</span><small>${esc(relDays(d))}</small><em>${n}</em></h3>
        <div class="foot-masonry">${leagues.map((lg) => leagueCard(lg, opts)).join('')}</div>
      </section>`;
    })
    .join('');
}

function paintF1() {
  const box = $('#f1');
  if (!state.f1) return;
  if (state.f1.error) {
    box.innerHTML = state.f1.blockedUntil
      ? emptyBox('⏳', t('err.blocked'), t('err.blockedSub', { time: fmtTime(state.f1.blockedUntil) }))
      : emptyBox('📡', t('f1.err'), t('err.sub'));
    return;
  }
  const { current, next, round, total } = state.f1;
  let html = '';
  if (current) {
    if (!state.f1Session) state.f1Session = defaultSession(current)?.id;
    html += f1GpCard(current, { selectedId: state.f1Session, showAll: state.f1ShowAll, limit: 10, round, total });
  }
  html += f1NextCard(next);
  if (state.f1Stand) html += f1StandingsCard(state.f1Stand, { showAll: state.f1StandShowAll, limit: 10 });
  box.innerHTML = html || emptyBox('🏁', t('f1.over'), t('f1.overSub'));
}

function paintGT() {
  const box = $('#gt');
  if (!state.gt) return;
  if (state.gt.error) {
    box.innerHTML = emptyBox('📡', t('gt.err'), t('err.sub'));
    return;
  }
  if (!state.gt.length) {
    box.innerHTML = emptyBox('⚙️', t('gt.noChamp'), t('page.settingsHint'));
    return;
  }
  box.innerHTML = state.gt.map((c) => gtCard(c).html).join('') + `<div class="note">${esc(t('gt.note'))}</div>`;
}

function paintAll() {
  paintKpis();
  paintFoot();
  paintF1();
  paintGT();
  $('#updated').textContent = t('ui.updated', { time: fmtTime(new Date()) });
}

/* ================================================================ loading */

async function loadFoot() {
  const { from, to } = rangeBounds();
  const key = `${ymd(from)}-${ymd(to)}`;
  let data;
  try {
    data = await fetchFootballRange(from, to, state.settings.footLeagues);
  } catch {
    data = { leagues: [], errors: [], failedAll: true };
  }
  const now = rangeBounds();
  if (key !== `${ymd(now.from)}-${ymd(now.to)}`) return; // the period changed meanwhile
  // Remember scores to flash the ones that changed since the last refresh.
  state.flashIds = new Set();
  for (const lg of data.leagues) {
    for (const e of lg.events) {
      const key = `${e.home.score}-${e.away.score}`;
      const prev = state.scores.get(e.id);
      if (prev && prev !== key && e.status.live) state.flashIds.add(e.id);
      state.scores.set(e.id, key);
    }
  }
  state.foot = data;
}

async function loadMotor() {
  const s = state.settings;
  const gtLeagues = [...GT_LEAGUES, ...s.customGt].filter((l) => s.gtLeagues.includes(l.id));
  const [f1, f1s, gt] = await Promise.allSettled([fetchF1(), fetchF1Standings(), gtLeagues.length ? fetchGT(gtLeagues) : []]);
  state.f1 = f1.status === 'fulfilled' ? f1.value : { error: true, blockedUntil: f1.reason?.blockedUntil };
  state.f1Stand = f1s.status === 'fulfilled' ? f1s.value : null;
  state.gt = gt.status === 'fulfilled' ? gt.value : { error: true };
}

async function refresh({ silent = false, footOnly = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('#refresh').classList.add('spin');
  if (!silent) {
    $('#foot').innerHTML = `<div class="skel-col">${skeleton(4)}</div><div class="skel-col">${skeleton(3)}</div>`;
    if (!footOnly) {
      $('#f1').innerHTML = skeleton(2);
      $('#gt').innerHTML = skeleton(1);
    }
  }
  try {
    await Promise.all([loadFoot(), footOnly ? null : loadMotor()]);
    paintAll();
  } finally {
    state.loading = false;
    $('#refresh').classList.remove('spin');
  }
  const live =
    (state.foot?.leagues ?? []).some((lg) => lg.events.some((e) => e.status.live)) ||
    !!state.f1?.current?.sessions.some((s) => s.state === 'in');
  clearTimeout(state.timer);
  // Same pace as the popup and background (Settings → Automatic refresh); none in manual mode.
  const every = refreshMinutes(state.settings.refresh, live);
  if (every != null) state.timer = setTimeout(() => refresh({ silent: true }), every * 60000);
}

/* ================================================================ dialogs */

function openDialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}

async function openStandings(id, name) {
  $('#stand-title').textContent = t('stand.title', { name });
  $('#stand-body').innerHTML = skeleton(4);
  openDialog('#dlg-stand');
  try {
    $('#stand-body').innerHTML = standingsHtml(await fetchStandings(id), state.settings.favorites);
  } catch {
    $('#stand-body').innerHTML = emptyBox('📡', t('stand.err'), t('stand.errSub'));
  }
}

function playerHtml(v) {
  // Played through the https relay page (see PLAYER_RELAY in src/config.js).
  const src = `${PLAYER_RELAY}?v=${encodeURIComponent(v.id)}`;
  return `<div class="player"><iframe src="${esc(src)}" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

// Messages from the relay page (docs/player.html): 'loaded', then 'ready' or 'error'.
// Without any message after a few seconds (relay offline…), fall back to a direct embed,
// which gets the relay's origin as Referer through the rule in src/embed.js.
let relayTimer;
let relayListener;
function watchRelay(v, onBlocked) {
  clearTimeout(relayTimer);
  if (relayListener) window.removeEventListener('message', relayListener);
  const origin = new URL(PLAYER_RELAY).origin;
  relayListener = (e) => {
    if (e.origin !== origin || e.data?.type !== 'sdj-relay' || e.data.v !== v.id) return;
    clearTimeout(relayTimer);
    // 100: removed or private, 101 / 150: the owner disabled playback on other sites.
    if (e.data.state === 'error') onBlocked(e.data.code);
  };
  window.addEventListener('message', relayListener);
  relayTimer = setTimeout(() => {
    const frame = $('#video-body .player iframe');
    if (!frame || !$('#dlg-video').open) return;
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  }, 6000);
}

function stopRelayWatch() {
  clearTimeout(relayTimer);
  if (relayListener) window.removeEventListener('message', relayListener);
  relayListener = null;
}

function videoInfo(v, searchUrl) {
  const meta = [v.channel, v.views, v.published, v.length].filter(Boolean).join(' · ');
  return `<div class="vid-info">
    <div><div class="vid-title">${esc(v.title)}</div><div class="vid-meta">${esc(meta)}</div></div>
    <div class="vid-actions">
      <button class="pill-btn" data-popout="${esc(v.id)}">${esc(t('vid.popout'))}</button>
      <a class="pill-btn yt" href="https://www.youtube.com/watch?v=${esc(encodeURIComponent(v.id))}" target="_blank" rel="noopener">${esc(t('vid.watchOn'))}</a>
      <a class="pill-btn" href="${esc(searchUrl)}" target="_blank" rel="noopener">${esc(t('vid.search'))}</a>
    </div>
  </div>`;
}

/** First screen for a video: its thumbnail and a choice, nothing loads until you pick. */
function previewCard(v) {
  const thumb = `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg`;
  return `<div class="player preview">
    ${img(thumb, v.title)}
    <div class="preview-in">
      <button class="play-btn" data-play aria-label="${esc(t('vid.playHere'))}">
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>
      </button>
      <div class="preview-actions">
        <button class="btn" data-play>${esc(t('vid.playHere'))}</button>
        <a class="pill-btn yt" href="https://www.youtube.com/watch?v=${esc(encodeURIComponent(v.id))}" target="_blank" rel="noopener">${esc(t('vid.watchOn'))}</a>
      </div>
      <small>${esc(t('vid.adNote'))}</small>
    </div>
  </div>`;
}

/** Shown in place of the player when the video's owner only allows playback on YouTube. */
function blockedCard(v) {
  return `<div class="player blocked"><div class="blocked-in">
    <strong>${esc(t('vid.blockedTitle'))}</strong>
    <p>${esc(t('vid.blockedSub', { who: v.channel || 'YouTube' }))}</p>
    <div class="vid-actions center">
      <a class="btn" href="https://www.youtube.com/watch?v=${esc(encodeURIComponent(v.id))}" target="_blank" rel="noopener">${esc(t('vid.watchOn'))}</a>
      <button class="pill-btn" data-popout="${esc(v.id)}">${esc(t('vid.popout'))}</button>
    </div>
  </div></div>`;
}

async function openVideo(query, label) {
  const body = $('#video-body');
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  $('#video-title').textContent = label || t('vid.title');
  body.innerHTML = `<div class="player loading"><span>${esc(t('vid.loading'))}</span></div>`;
  openDialog('#dlg-video');

  let videos = [];
  try {
    // Make sure the Referer rule is in place before the player iframe loads (see src/embed.js).
    [videos] = await Promise.all([searchYouTube(query, { max: 5, hl: lang() }), ensureEmbedReferer()]);
  } catch {
    videos = null;
  }
  if (!$('#dlg-video').open) return;
  if (!videos?.length) {
    body.innerHTML =
      emptyBox('🎬', videos ? t('vid.none') : t('vid.error'), t('vid.errorSub')) +
      `<div class="vid-actions center"><a class="pill-btn yt" href="${esc(searchUrl)}" target="_blank" rel="noopener">${esc(t('vid.watchOn'))}</a></div>`;
    return;
  }

  const blocked = new Set(); // indexes of videos whose owner only allows playback on YouTube
  const playing = new Set(); // indexes the user chose to play here
  const bind = (i) => {
    body.querySelectorAll('[data-play]').forEach((b) =>
      b.addEventListener('click', () => {
        playing.add(i);
        show(i);
      })
    );
    body.querySelectorAll('[data-vid]').forEach((b) => b.addEventListener('click', () => show(+b.dataset.vid)));
    body.querySelectorAll('[data-popout]').forEach((b) =>
      b.addEventListener('click', (e) => {
        openPopout(e.currentTarget.dataset.popout);
        $('#dlg-video').close();
      })
    );
  };
  const list = (current) =>
    videos
      .map((o, j) =>
        j === current
          ? ''
          : `<button class="vid-alt${blocked.has(j) ? ' is-blocked' : ''}" data-vid="${j}">${img(o.thumb, o.title)}<span><b>${esc(o.title)}</b><small>${esc(
              [o.channel, o.length, blocked.has(j) ? t('vid.blockedTag') : ''].filter(Boolean).join(' · ')
            )}</small></span></button>`
      )
      .join('');
  const others = (i) => {
    const l = list(i);
    return l ? `<h3 class="vid-h">${esc(t('vid.others'))}</h3><div class="vid-list">${l}</div>` : '';
  };

  const show = (i) => {
    const v = videos[i];
    if (blocked.has(i) || !playing.has(i)) {
      stopRelayWatch();
      body.innerHTML = (blocked.has(i) ? blockedCard(v) : previewCard(v)) + videoInfo(v, searchUrl) + others(i);
      bind(i);
      return;
    }
    body.innerHTML = playerHtml(v) + videoInfo(v, searchUrl) + others(i);
    bind(i);
    // If the owner forbids playback here, swap the player for a one-click "Watch on YouTube".
    watchRelay(v, () => {
      blocked.add(i);
      if ($('#dlg-video').open) show(i);
    });
  };
  show(0);
}

/* ================================================================ init */


async function init() {
  state.settings = await loadSettings();
  applyLanguage();

  $$('.lang-seg [data-lang]').forEach((b) => b.addEventListener('click', () => setLanguage(b.dataset.lang)));
  $('#theme-btn').addEventListener('click', cycleTheme);
  $('#refresh').addEventListener('click', async () => {
    await clearCache();
    refresh();
  });
  $('#day-prev').addEventListener('click', () => shiftRange(-1));
  $('#day-next').addEventListener('click', () => shiftRange(1));
  $('#day-label').addEventListener('click', () => shiftRange(0));
  $$('.range-seg [data-range]').forEach((b) => b.addEventListener('click', () => setRangeMode(b.dataset.range)));
  $('#custom-range').addEventListener('submit', applyCustomRange);
  paintRangeControls();
  $('#live-only').addEventListener('click', (e) => {
    state.liveOnly = !state.liveOnly;
    e.currentTarget.setAttribute('aria-pressed', String(state.liveOnly));
    paintFoot();
  });
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    paintFoot();
  });

  // Dialogs: close button, click on the backdrop; stop the video when closing.
  $$('dialog').forEach((d) => {
    d.querySelector('.dlg-close').addEventListener('click', () => d.close());
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  });
  $('#dlg-video').addEventListener('close', () => {
    stopRelayWatch();
    $('#video-body').innerHTML = '';
  });

  document.addEventListener('click', (e) => {
    const yt = e.target.closest('[data-yt]');
    if (yt) {
      e.preventDefault();
      const card = yt.closest('.match');
      const label = card
        ? [...card.querySelectorAll('.team .nm')].map((n) => n.textContent).join(' – ')
        : yt.textContent.trim();
      return openVideo(yt.dataset.yt, label);
    }
    const st = e.target.closest('[data-standings]');
    if (st) return openStandings(st.dataset.standings, st.dataset.name);
    const sess = e.target.closest('[data-sess]');
    if (sess) {
      state.f1Session = sess.dataset.sess;
      return paintF1();
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      state[tog.dataset.toggle] = !state[tog.dataset.toggle];
      return paintF1();
    }
    const row = e.target.closest('.match-main');
    if (row) {
      const m = row.closest('.match');
      row.setAttribute('aria-expanded', String(m.classList.toggle('open')));
    }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey || $('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') refresh();
    else if (k === 't') cycleTheme();
    else if (k === 'l') setLanguage(lang() === 'fr' ? 'en' : 'fr');
    else if (e.key === 'ArrowLeft') shiftRange(-1);
    else if (e.key === 'ArrowRight') shiftRange(1);
    else if (k === 'd') setRangeMode('day');
    else if (k === 's' || k === 'w') setRangeMode('week');
    else if (k === 'm') setRangeMode('month');
    else if (e.key === '/') {
      e.preventDefault();
      $('#search').focus();
    }
  });

  // Follow settings changed from the popup (theme, language, competitions, favourites).
  try {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'sync') return;
      state.settings = await loadSettings();
      if (changes.themeCfg) applyTheme();
      if (changes.lang) {
        applyLanguage();
        paintAll();
      }
      if (changes.footLeagues || changes.gtLeagues || changes.customGt || changes.refresh) refresh({ silent: true });
      else if (changes.favorites) paintFoot();
    });
  } catch {
    /* preview outside the extension */
  }

  refresh();
}

init();
