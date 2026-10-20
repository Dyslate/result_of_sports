import { fetchFootball, fetchF1, fetchGT, fetchStandings, fetchF1Standings, isoDay } from './src/api.js';
import { FOOT_LEAGUES, GT_LEAGUES, PALETTES, CUSTOM_PRESETS, loadSettings, saveSettings, isFavTeam } from './src/config.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const content = $('#content');

const state = {
  settings: null,
  tab: 'foot',
  dayOffset: 0,
  liveOnly: false,
  query: '',
  f1Session: null,
  f1ShowAll: false,
  f1StandShowAll: false,
  lastFoot: null, // dernières données foot (pour filtrer sans recharger)
  scores: new Map(), // id -> "h-a" pour détecter les buts
  timer: null,
  loading: false,
};

/* ================================================================ utilitaires */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https:\/\//.test(u ?? '') ? esc(u) : '');
const img = (src, alt = '') =>
  safeUrl(src) ? `<img src="${safeUrl(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : '';

const fmtTime = (d) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat('fr-FR', opts).format(new Date(d));
const sameDay = (a, b) => isoDay(new Date(a)) === isoDay(new Date(b));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function dayFromOffset(off) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + off);
  return d;
}

function dayLabel(off) {
  if (off === 0) return "Aujourd'hui";
  if (off === -1) return 'Hier';
  if (off === 1) return 'Demain';
  return fmtDay(dayFromOffset(off));
}

function relDays(dateStr) {
  const a = new Date(isoDay(new Date()) + 'T12:00:00');
  const b = new Date(isoDay(new Date(dateStr)) + 'T12:00:00');
  const n = Math.round((b - a) / 86400000);
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return 'Demain';
  if (n === -1) return 'Hier';
  return n > 0 ? `Dans ${n} jours` : `Il y a ${-n} jours`;
}

const isFav = (team) => isFavTeam(team, state.settings.favorites);

/* ----- liens externes ----- */

const ICON_YT =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9L15.5 12z"/></svg>';
const ICON_CAL =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const ICON_EXT =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

function ytLink(query, label = 'Résumé') {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return `<a class="pill-btn yt" href="${esc(url)}" target="_blank" rel="noopener">${ICON_YT}${esc(label)}</a>`;
}

function gcalLink({ title, start, end, details = '', location = '', allDay = false }) {
  const f = (d) =>
    allDay ? isoDay(d).replace(/-/g, '') : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const s = new Date(start);
  let e = end ? new Date(end) : new Date(s.getTime() + 2 * 3600000);
  if (allDay) {
    e = new Date(e);
    e.setDate(e.getDate() + 1);
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(s)}/${f(e)}`, details, location });
  return `<a class="pill-btn" href="https://calendar.google.com/calendar/render?${esc(p.toString())}" target="_blank" rel="noopener">${ICON_CAL}Agenda</a>`;
}

function extLink(url, label) {
  return safeUrl(url) ? `<a class="pill-btn" href="${safeUrl(url)}" target="_blank" rel="noopener">${ICON_EXT}${esc(label)}</a>` : '';
}

/* ----- états ----- */

function skeleton(n = 4) {
  content.innerHTML = Array.from({ length: n }, () => '<div class="skel"></div>').join('');
}
function emptyBox(icon, title, msg) {
  return `<div class="empty"><span class="big">${icon}</span><strong>${esc(title)}</strong>${esc(msg)}</div>`;
}
const stamp = () => `<div class="updated">Mis à jour à ${fmtTime(new Date())}</div>`;

function scheduleRefresh(hasLive) {
  clearTimeout(state.timer);
  // 30 s s'il y a du direct, sinon 5 min tant que le popup reste ouvert.
  state.timer = setTimeout(() => render(true), hasLive ? 30000 : 300000);
}

function setTabCount(tab, n) {
  const btn = $(`.tab[data-tab="${tab}"]`);
  btn.querySelector('.count')?.remove();
  if (n > 0) btn.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
}

/* ================================================================ thème */

const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
const THEME_NAMES = { auto: 'automatique', light: 'jour', dark: 'nuit' };
const ICON_PALETTE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.9 1.2-1.7-.4-1 .3-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>';

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="toast">${esc(msg)}</div>`);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => document.querySelector('.toast')?.remove(), 1800);
}

/** Applique state.settings.themeCfg et met à jour les contrôles. */
function applyTheme() {
  const cfg = state.settings.themeCfg;
  window.applyThemeCfg?.(cfg);
  const custom = cfg.palette === 'custom';
  $('#theme-btn').innerHTML = custom ? ICON_PALETTE : THEME_ICONS[cfg.mode] ?? THEME_ICONS.auto;
  $('#theme-btn').title = custom ? 'Thème personnalisé (T pour revenir aux thèmes)' : `Mode ${THEME_NAMES[cfg.mode]} (T)`;
}

function setTheme(patch) {
  const cfg = { ...state.settings.themeCfg, ...patch };
  if (patch.palette && patch.palette !== 'custom') cfg.lastPreset = patch.palette;
  persist({ themeCfg: cfg });
  applyTheme();
  if (!$('#settings').hidden) renderThemeSettings();
}

function cycleTheme() {
  const cfg = state.settings.themeCfg;
  if (cfg.palette === 'custom') return setTheme({ palette: cfg.lastPreset || 'pelouse' });
  const order = ['auto', 'light', 'dark'];
  const mode = order[(order.indexOf(cfg.mode) + 1) % 3];
  setTheme({ mode });
  toast(`Mode ${THEME_NAMES[mode]}`);
}

function renderThemeSettings() {
  const cfg = state.settings.themeCfg;
  const custom = cfg.palette === 'custom';
  $$('#set-theme [data-theme-val]').forEach((b) => {
    b.setAttribute('aria-checked', String(!custom && b.dataset.themeVal === cfg.mode));
    b.disabled = custom;
  });
  $('#mode-hint').hidden = !custom;
  $('#set-palettes').innerHTML =
    PALETTES.map(
      (p) => `<button class="swatch" role="radio" data-palette="${p.id}" aria-checked="${cfg.palette === p.id}">
        <span class="dots"><i style="background:${p.colors[0]}"></i><i style="background:${p.colors[1]}"></i></span>${esc(p.name)}</button>`
    ).join('') +
    `<button class="swatch" role="radio" data-palette="custom" aria-checked="${custom}"><span class="rainbow"></span>Perso</button>`;

  $('#custom-editor').hidden = !custom;
  $('#custom-presets').innerHTML = CUSTOM_PRESETS.map(
    (p, i) => `<button class="ce-preset" data-cpreset="${i}"><i style="background:linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)"></i>${esc(p.name)}</button>`
  ).join('');
  $$('[data-color]').forEach((inp) => {
    inp.value = cfg.custom[inp.dataset.color];
    inp.parentElement.querySelector('code').textContent = inp.value;
  });
  $$('#set-font [data-font]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.font === cfg.font)));
  $$('#set-size [data-size]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.size === cfg.size)));
  $('#set-radius').value = cfg.radius;
  $('#radius-val').textContent = `${cfg.radius}px`;
}

function exportTheme() {
  const { custom, radius, font, size } = state.settings.themeCfg;
  return 'SDJ1:' + btoa(JSON.stringify({ custom, radius, font, size }));
}

function importTheme(code) {
  try {
    const raw = JSON.parse(atob(code.trim().replace(/^SDJ1:/, '')));
    const hex = (v) => /^#[0-9a-f]{6}$/i.test(v);
    const c = raw.custom ?? {};
    if (!['bg', 'surface', 'text', 'accent', 'live'].every((k) => hex(c[k]))) throw new Error('couleurs');
    setTheme({
      palette: 'custom',
      custom: { bg: c.bg, surface: c.surface, text: c.text, accent: c.accent, live: c.live },
      radius: Math.min(22, Math.max(0, Number(raw.radius) || 12)),
      font: ['system', 'rounded', 'serif', 'mono', 'condensed'].includes(raw.font) ? raw.font : 'system',
      size: ['compact', 'normal', 'large'].includes(raw.size) ? raw.size : 'normal',
    });
    toast('Thème importé');
    return true;
  } catch {
    toast('Code de thème invalide');
    return false;
  }
}

/* ================================================================ Foot */

function matchRow(ev, leagueName) {
  const { home, away, status } = ev;
  const pre = status.state === 'pre';
  const post = status.state === 'post';

  const side = (t, o) => {
    const c = ['team'];
    if (post && t.winner) c.push('win');
    else if (post && o.winner) c.push('lose');
    return `<div class="${c.join(' ')}">${img(t.logo) || '<span class="logo-ph"></span>'}<span class="nm" title="${esc(t.fullName)}">${esc(t.name)}</span>${isFav(t) ? '<span class="star">★</span>' : ''}</div>`;
  };
  const sc = (t, o) => {
    const lose = post && o.winner && !t.winner;
    const pen = t.shootout != null ? `<span class="pen">(${esc(t.shootout)})</span>` : '';
    return `<span class="${lose ? 'lose' : ''}">${esc(t.score)}${pen}</span>`;
  };
  const statusTxt = pre && !status.label ? fmtTime(ev.date) : status.label;
  const stCls = status.live ? ' live' : post ? ' ft' : '';

  const events = ev.details
    .map((d) => {
      const isHome = d.teamId === home.id;
      const ico = d.kind === 'red' ? '🟥' : d.kind === 'og' ? '⚽ csc' : d.kind === 'pen' ? '⚽ pen.' : '⚽';
      return `<div class="ev ${isHome ? 'home' : 'away'}"><span class="min">${esc(d.minute)}</span><span>${esc(d.player)}</span><span class="ico">${ico}</span></div>`;
    })
    .join('');

  const dateFr = isoDay(new Date(ev.date)).split('-').reverse().join('/');
  const hn = home.fullName || home.name;
  const an = away.fullName || away.name;
  const follow = (t) =>
    `<button class="pill-btn${isFav(t) ? ' on' : ''}" data-follow="${esc(t.name)}">${isFav(t) ? '★' : '☆'} ${esc(t.name)}</button>`;

  const links = [
    !pre ? ytLink(`résumé ${hn} ${an} ${dateFr}`, 'Résumé') : '',
    pre ? gcalLink({ title: `${hn} – ${an}`, start: ev.date, details: leagueName, location: ev.venue }) : '',
    extLink(ev.link, 'Fiche'),
    follow(home),
    follow(away),
  ].join('');

  const extra = [
    events ? `<div class="events">${events}</div>` : '',
    ev.note ? `<div class="meta-line">${esc(ev.note)}</div>` : '',
    `<div class="meta-line">${esc(fmtDay(ev.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${fmtTime(ev.date)}${ev.venue ? ` · ${esc(ev.venue)}` : ''}</div>`,
    `<div class="links">${links}</div>`,
  ].join('');

  // Détection d'un nouveau but depuis la dernière actualisation.
  const key = `${home.score}-${away.score}`;
  const prev = state.scores.get(ev.id);
  const flash = prev && prev !== key && status.live;
  state.scores.set(ev.id, key);

  return `
  <div class="match${status.live ? ' is-live' : ''}${flash ? ' flash' : ''}" data-id="${esc(ev.id)}">
    <button class="match-main" aria-expanded="false">
      <span class="status${stCls}">${esc(statusTxt)}</span>
      <span class="teams">${side(home, away)}${side(away, home)}</span>
      <span class="scores${pre ? ' pre' : ''}">${sc(home, away)}${sc(away, home)}</span>
    </button>
    <div class="match-extra">${extra}</div>
  </div>`;
}

function paintFoot() {
  const data = state.lastFoot;
  if (!data) return false;
  const q = norm(state.query);
  const order = FOOT_LEAGUES.map((l) => l.id);
  const favMatch = (e) => isFav(e.home) || isFav(e.away);

  const lgs = data.leagues
    .map((lg) => ({
      ...lg,
      name: FOOT_LEAGUES.find((l) => l.id === lg.id)?.name ?? lg.name,
      events: lg.events
        .filter((e) => !state.liveOnly || e.status.live)
        .filter((e) => !q || norm(`${e.home.name} ${e.home.fullName} ${e.away.name} ${e.away.fullName}`).includes(q))
        .sort((a, b) => favMatch(b) - favMatch(a)),
    }))
    .filter((lg) => lg.events.length)
    .map((lg) => ({ ...lg, fav: lg.events.some(favMatch) }))
    .sort((a, b) => b.fav - a.fav || order.indexOf(a.id) - order.indexOf(b.id));

  const liveCount = data.leagues.reduce((n, lg) => n + lg.events.filter((e) => e.status.live).length, 0);
  if (state.dayOffset === 0) setTabCount('foot', liveCount);

  if (!lgs.length) {
    content.innerHTML = q
      ? emptyBox('🔎', 'Aucun résultat', `Aucune équipe ne correspond à « ${state.query} ».`)
      : state.liveOnly
        ? emptyBox('📺', 'Aucun match en direct', 'Désactivez « Direct » pour voir tout le programme.')
        : emptyBox('🗓️', `Pas de match ${dayLabel(state.dayOffset).toLowerCase()}`, 'dans les compétitions suivies.');
    return liveCount > 0;
  }

  const cards = lgs
    .map((lg) => {
      const live = lg.events.filter((e) => e.status.live).length;
      return `<section class="card">
        <div class="card-head">${img(lg.logo)}<span>${esc(lg.name)}</span>
          <span class="sub">${live ? `<span class="pill live">${live} en direct</span>` : ''}
          <button class="link-btn" data-standings="${esc(lg.id)}" data-name="${esc(lg.name)}">Classement</button></span>
        </div>
        ${lg.events.map((e) => matchRow(e, lg.name)).join('')}
      </section>`;
    })
    .join('');
  const warn = data.errors.length ? `<div class="warn">${data.errors.length} compétition(s) momentanément indisponible(s).</div>` : '';
  content.innerHTML = warn + cards + stamp();
  return liveCount > 0;
}

async function renderFoot(silent) {
  $('#day-label').textContent = dayLabel(state.dayOffset);
  const leagues = state.settings.footLeagues;
  if (!leagues.length) {
    content.innerHTML = emptyBox('⚙️', 'Aucune compétition', 'Choisissez des championnats dans les réglages.');
    return false;
  }
  if (!silent) skeleton();
  const offset = state.dayOffset;
  let data;
  try {
    data = await fetchFootball(dayFromOffset(offset), leagues);
  } catch {
    data = { leagues: [], failedAll: true, errors: leagues };
  }
  if (state.tab !== 'foot' || offset !== state.dayOffset) return false;
  if (data.failedAll) {
    content.innerHTML = emptyBox('📡', 'Impossible de charger les scores', 'Vérifiez votre connexion puis actualisez.');
    return false;
  }
  state.lastFoot = data;
  return paintFoot();
}

/* ----- classement ----- */

async function openStandings(id, name) {
  $('#standings-title').textContent = `Classement · ${name}`;
  $('#standings').hidden = false;
  const body = $('#standings-body');
  body.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  try {
    const data = await fetchStandings(id);
    if (!data.groups.length) {
      body.innerHTML = emptyBox('📊', 'Pas de classement', 'Cette compétition ne publie pas de classement.');
      return;
    }
    const zones = new Map();
    const tables = data.groups
      .map((g) => {
        const rows = g.rows
          .map((r) => {
            if (r.zone && r.zoneLabel) zones.set(r.zone, r.zoneLabel);
            const fav = isFavTeam({ name: r.team, fullName: r.fullName }, state.settings.favorites);
            const zone = /^#[0-9a-f]{3,8}$/i.test(r.zone) ? `<i class="zone" style="background:${r.zone}"></i>` : '';
            return `<tr class="${fav ? 'fav' : ''}"><td class="r">${zone}${r.rank}</td>
              <td class="tm"><div>${img(r.logo)}<span title="${esc(r.fullName)}">${esc(r.team)}</span></div></td>
              <td>${esc(r.played)}</td><td>${esc(r.win)}</td><td>${esc(r.draw)}</td><td>${esc(r.loss)}</td><td>${esc(r.diff)}</td><td class="pt">${esc(r.pts)}</td></tr>`;
          })
          .join('');
        const title = data.groups.length > 1 && g.name ? `<div class="grp-title">${esc(g.name)}</div>` : '';
        return `${title}<div class="card"><table class="table"><thead><tr><th>#</th><th>Équipe</th><th>J</th><th>G</th><th>N</th><th>P</th><th>Diff</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      })
      .join('');
    const legend = [...zones]
      .filter(([c]) => /^#[0-9a-f]{3,8}$/i.test(c))
      .map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`)
      .join('');
    body.innerHTML = tables + (legend ? `<div class="legend">${legend}</div>` : '');
  } catch {
    body.innerHTML = emptyBox('📡', 'Classement indisponible', 'Réessayez dans un instant.');
  }
}

/* ================================================================ F1 */

function f1Results(sess) {
  if (!sess) return '';
  if (sess.state === 'pre' || !sess.drivers.length) {
    return `<div class="note-pad">Résultats disponibles ${esc(fmtDay(sess.date, { weekday: 'long' }))} à ${fmtTime(sess.date)}.</div>`;
  }
  const list = state.f1ShowAll ? sess.drivers : sess.drivers.slice(0, 10);
  const rows = list
    .map(
      (d) =>
        `<div class="res${d.pos <= 3 ? ` podium p${d.pos}` : ''}"><span class="p">${d.pos}</span>${img(d.flag, d.flagAlt) || '<span></span>'}<span class="dn">${esc(d.name)}</span><span></span></div>`
    )
    .join('');
  const more =
    sess.drivers.length > 10
      ? `<button class="more" data-toggle="f1ShowAll">${state.f1ShowAll ? 'Top 10 seulement' : `Voir les ${sess.drivers.length} pilotes`}</button>`
      : '';
  return `<div class="grid-res">${rows}</div>${more}`;
}

function f1StandingsCard(groups) {
  const drivers = groups?.[0];
  if (!drivers?.rows.length) return '';
  const list = state.f1StandShowAll ? drivers.rows : drivers.rows.slice(0, 5);
  const rows = list
    .map(
      (d) =>
        `<div class="res${d.rank <= 3 ? ` podium p${d.rank}` : ''}"><span class="p">${d.rank}</span>${img(d.flag) || '<span></span>'}<span class="dn">${esc(d.name)}</span><span class="pts">${esc(d.pts)} pts</span></div>`
    )
    .join('');
  const more =
    drivers.rows.length > 5
      ? `<button class="more" data-toggle="f1StandShowAll">${state.f1StandShowAll ? 'Réduire' : 'Classement complet'}</button>`
      : '';
  return `<section class="card"><div class="card-head"><span>Championnat pilotes</span></div><div class="grid-res">${rows}</div>${more}</section>`;
}

async function renderF1(silent) {
  if (!silent) skeleton(3);
  const [res, stand] = await Promise.allSettled([fetchF1(), fetchF1Standings()]);
  if (state.tab !== 'f1') return false;
  if (res.status !== 'fulfilled') {
    content.innerHTML = emptyBox('📡', 'Impossible de charger la F1', 'Vérifiez votre connexion puis actualisez.');
    return false;
  }
  const { current, next, round, total } = res.value;
  const now = Date.now();
  let html = '';
  let live = false;

  if (current) {
    const inWeekend =
      new Date(current.date).getTime() - 86400000 <= now && now <= new Date(current.endDate).getTime() + 4 * 3600000;
    live = current.sessions.some((s) => s.state === 'in');
    const def =
      current.sessions.find((s) => s.state === 'in') ??
      [...current.sessions].reverse().find((s) => s.state === 'post') ??
      current.sessions[0];
    const sel = current.sessions.find((s) => s.id === state.f1Session) ?? def;
    if (sel) state.f1Session = sel.id;

    const sessions = current.sessions
      .map((s) => {
        const c = ['sess'];
        if (s.state === 'in') c.push('live');
        if (sameDay(s.date, now)) c.push('today');
        const t =
          s.state === 'in' ? '● En cours' : s.state === 'post' ? 'Terminé' : sameDay(s.date, now) ? `Auj. ${fmtTime(s.date)}` : `${fmtDay(s.date, { weekday: 'short' })} ${fmtTime(s.date)}`;
        return `<button class="${c.join(' ')}" data-sess="${esc(s.id)}" aria-pressed="${s.id === sel?.id}">${esc(s.name)}<span class="t">${esc(t)}</span></button>`;
      })
      .join('');

    const pill = live
      ? '<span class="pill live">En direct</span>'
      : inWeekend
        ? '<span class="pill">Ce week-end</span>'
        : '<span class="pill">Dernier GP</span>';
    const year = new Date(current.date).getFullYear();
    const selLinks = [];
    if (sel && sel.state !== 'pre') {
      const what = sel.abbr === 'Race' ? 'race highlights' : `${sel.name} highlights`;
      selLinks.push(ytLink(`F1 ${current.name} ${year} ${what}`, `Best-of ${sel.name.toLowerCase()}`));
    }
    if (sel && sel.state === 'pre') {
      selLinks.push(
        gcalLink({ title: `F1 · ${sel.name} · ${current.name}`, start: sel.date, end: new Date(new Date(sel.date).getTime() + (sel.abbr === 'Race' ? 2 : 1) * 3600000), location: current.circuit })
      );
    }
    selLinks.push(extLink(current.link, 'Fiche'));

    html += `<section class="card">
      <div class="gp-head">
        <div class="gp-title">${esc(current.name)} ${pill}</div>
        <div class="gp-meta">${round ? `Manche ${round}/${total} · ` : ''}${esc(fmtDay(current.date, { day: 'numeric', month: 'short' }))} – ${esc(fmtDay(current.endDate, { day: 'numeric', month: 'short' }))}${current.circuit ? ` · ${esc(current.circuit)}` : ''}</div>
      </div>
      <div class="sessions">${sessions}</div>
      ${f1Results(sel)}
      <div class="links pad">${selLinks.join('')}</div>
    </section>`;
  }

  if (next) {
    html += `<section class="card">
      <div class="card-head"><span>Prochain Grand Prix</span></div>
      <div class="next-row">
        <div><strong>${esc(next.name)}</strong>
          <div class="gp-meta">${esc(fmtDay(next.start, { weekday: 'short', day: 'numeric', month: 'long' }))} – ${esc(fmtDay(next.end, { weekday: 'short', day: 'numeric', month: 'long' }))}</div></div>
        <div class="when"><span class="countdown">${esc(relDays(next.start))}</span>${gcalLink({ title: `F1 · ${next.name}`, start: next.start, end: next.end, allDay: true })}</div>
      </div>
    </section>`;
  }

  if (stand.status === 'fulfilled') html += f1StandingsCard(stand.value);
  if (!html) html = emptyBox('🏁', 'Saison terminée', 'Aucun Grand Prix programmé pour le moment.');

  content.innerHTML = html + stamp();
  setTabCount('f1', live ? 1 : 0);
  return live;
}

/* ================================================================ GT3 */

function gtRow(label, ev, isToday, champ) {
  if (!ev) return '';
  const where = [ev.venue, ev.country].filter(Boolean).join(', ');
  const d = ev.date + 'T12:00:00';
  const when = `${fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${relDays(d).toLowerCase()}`;
  const past = ev.date <= isoDay(new Date());
  const links = past
    ? ytLink(`${champ} ${ev.name} ${ev.season || ''} highlights`, 'Best-of')
    : gcalLink({ title: `${champ} · ${ev.name}`, start: d, end: d, allDay: true, location: where });
  return `<div class="gt-ev${isToday ? ' today' : ''}">
    <span class="lbl">${esc(label)}</span>
    <div><div class="nm">${esc(ev.name)}</div><div class="meta">${esc(when)}${where ? ` · ${esc(where)}` : ''}</div>
    <div class="links">${links}</div></div>
  </div>`;
}

async function renderGT(silent) {
  const s = state.settings;
  const leagues = [...GT_LEAGUES, ...s.customGt].filter((l) => s.gtLeagues.includes(l.id));
  if (!leagues.length) {
    content.innerHTML = emptyBox('⚙️', 'Aucun championnat GT3', 'Choisissez des championnats dans les réglages.');
    return false;
  }
  if (!silent) skeleton(2);
  let data;
  try {
    data = await fetchGT(leagues);
  } catch {
    if (state.tab === 'gt') content.innerHTML = emptyBox('📡', 'Impossible de charger le GT3', 'Vérifiez votre connexion puis actualisez.');
    return false;
  }
  if (state.tab !== 'gt') return false;
  const today = isoDay(new Date());
  let todayCount = 0;
  const cards = data
    .map((c) => {
      if (c.error) return `<section class="card"><div class="card-head"><span>${esc(c.name)}</span></div><div class="note-pad">Données indisponibles.</div></section>`;
      const todayEv = [c.last, c.next].find((e) => e?.date === today);
      if (todayEv) todayCount++;
      const rows = todayEv
        ? gtRow("Aujourd'hui", todayEv, true, c.name) +
          (todayEv === c.next ? gtRow('Précédente', c.last, false, c.name) : gtRow('Suivante', c.next, false, c.name))
        : gtRow('Dernière', c.last, false, c.name) + gtRow('Prochaine', c.next, false, c.name);
      return `<section class="card"><div class="card-head"><span>${esc(c.name)}</span>${todayEv ? '<span class="sub"><span class="pill">Course du jour</span></span>' : ''}</div>${rows || '<div class="note-pad">Aucune épreuve trouvée.</div>'}</section>`;
    })
    .join('');
  setTabCount('gt', todayCount);
  content.innerHTML = cards + '<div class="note">Calendrier GT3 : TheSportsDB. Les classements de course ne sont pas publiés en accès libre.</div>' + stamp();
  return false;
}

/* ================================================================ rendu */

async function render(silent = false) {
  if (state.loading) return;
  state.loading = true;
  $('#refresh').classList.add('spin');
  $('#foot-bar').hidden = state.tab !== 'foot';
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  const open = $$('.match.open').map((m) => m.dataset.id);
  const scroll = content.scrollTop;
  let live = false;
  try {
    if (state.tab === 'foot') live = await renderFoot(silent);
    else if (state.tab === 'f1') live = await renderF1(silent);
    else live = await renderGT(silent);
  } finally {
    state.loading = false;
    $('#refresh').classList.remove('spin');
  }
  for (const id of open) {
    const m = $(`.match[data-id="${CSS.escape(id)}"]`);
    if (m) {
      m.classList.add('open');
      m.querySelector('.match-main').setAttribute('aria-expanded', 'true');
    }
  }
  if (silent) content.scrollTop = scroll;
  scheduleRefresh(live);
}

/* ================================================================ réglages */

async function persist(patch) {
  Object.assign(state.settings, patch);
  await saveSettings(patch);
}

function renderSettings() {
  const s = state.settings;
  $('#set-foot').innerHTML = FOOT_LEAGUES.map(
    (l) => `<label class="check"><input type="checkbox" data-foot="${esc(l.id)}" ${s.footLeagues.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`
  ).join('');
  $('#set-gt').innerHTML = [...GT_LEAGUES, ...s.customGt]
    .map((l) => `<label class="check"><input type="checkbox" data-gt="${esc(l.id)}" ${s.gtLeagues.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`)
    .join('');
  $('#set-fav').value = s.favorites.join(', ');
  $('#set-badge').checked = s.badge;
  $$('#set-notify [data-notify]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.notify === s.notify)));
  renderThemeSettings();
}

function toggleFavorite(name) {
  const favs = state.settings.favorites;
  const has = favs.some((f) => f.toLowerCase() === name.toLowerCase()) || isFav({ name, fullName: '' });
  const next = has
    ? favs.filter((f) => !name.toLowerCase().includes(f.toLowerCase()) && f.toLowerCase() !== name.toLowerCase())
    : [...favs, name];
  persist({ favorites: next });
  if (state.tab === 'foot') paintFoot();
}

function bindSettings() {
  $('#settings-btn').addEventListener('click', () => {
    renderSettings();
    $('#settings').hidden = false;
  });
  $('#settings-close').addEventListener('click', () => {
    $('#settings').hidden = true;
    render();
  });
  $('#set-foot').addEventListener('change', () =>
    persist({ footLeagues: $$('[data-foot]:checked').map((i) => i.dataset.foot) })
  );
  $('#set-gt').addEventListener('change', () => persist({ gtLeagues: $$('[data-gt]:checked').map((i) => i.dataset.gt) }));
  $('#set-fav').addEventListener('change', (e) =>
    persist({ favorites: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })
  );
  $('#set-badge').addEventListener('change', (e) => persist({ badge: e.target.checked }));
  $('#set-theme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-val]');
    if (b && !b.disabled) setTheme({ mode: b.dataset.themeVal });
  });
  $('#set-palettes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-palette]');
    if (b) setTheme({ palette: b.dataset.palette });
  });
  $('#custom-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cpreset]');
    if (!b) return;
    const { name, ...colors } = CUSTOM_PRESETS[+b.dataset.cpreset];
    setTheme({ custom: colors });
  });
  // Aperçu en direct pendant qu'on déplace le sélecteur, enregistrement au relâchement.
  $$('[data-color]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const cfg = state.settings.themeCfg;
      cfg.custom = { ...cfg.custom, [inp.dataset.color]: inp.value };
      inp.parentElement.querySelector('code').textContent = inp.value;
      window.applyThemeCfg?.(cfg);
    });
    inp.addEventListener('change', () => setTheme({ custom: { ...state.settings.themeCfg.custom } }));
  });
  $('#set-font').addEventListener('click', (e) => {
    const b = e.target.closest('[data-font]');
    if (b) setTheme({ font: b.dataset.font });
  });
  $('#set-size').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (b) setTheme({ size: b.dataset.size });
  });
  $('#set-radius').addEventListener('input', (e) => {
    const cfg = state.settings.themeCfg;
    cfg.radius = +e.target.value;
    $('#radius-val').textContent = `${cfg.radius}px`;
    window.applyThemeCfg?.(cfg);
  });
  $('#set-radius').addEventListener('change', (e) => setTheme({ radius: +e.target.value }));
  $('#theme-export').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportTheme());
      toast('Code copié dans le presse-papiers');
    } catch {
      $('#theme-import-input').hidden = false;
      $('#theme-import-input').value = exportTheme();
      $('#theme-import-input').select();
    }
  });
  $('#theme-import').addEventListener('click', () => {
    const inp = $('#theme-import-input');
    inp.hidden = false;
    inp.value = '';
    inp.focus();
  });
  $('#theme-import-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && importTheme(e.target.value)) e.target.hidden = true;
  });
  $('#set-notify').addEventListener('click', (e) => {
    const b = e.target.closest('[data-notify]');
    if (!b) return;
    persist({ notify: b.dataset.notify });
    $$('#set-notify [data-notify]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  $('#set-gt-add').addEventListener('click', async () => {
    const id = $('#set-gt-id').value.trim();
    if (!/^\d+$/.test(id)) return;
    const s = state.settings;
    if (![...GT_LEAGUES, ...s.customGt].some((l) => l.id === id)) {
      let name = `Championnat ${id}`;
      try {
        const [c] = await fetchGT([{ id, name }]);
        if (c && !c.error && c.name) name = c.name;
      } catch { /* nom par défaut */ }
      await persist({ customGt: [...s.customGt, { id, name }], gtLeagues: [...s.gtLeagues, id] });
    }
    $('#set-gt-id').value = '';
    renderSettings();
  });
}

/* ================================================================ init */

function switchTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  persist({ lastTab: tab });
  render();
}

function shiftDay(n) {
  state.dayOffset += n;
  state.scores.clear();
  render();
}

async function init() {
  state.settings = await loadSettings();
  state.tab = state.settings.lastTab ?? 'foot';
  applyTheme();

  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#theme-btn').addEventListener('click', cycleTheme);
  $('#refresh').addEventListener('click', () => {
    render();
    try { chrome.runtime.sendMessage({ type: 'refresh-badge' }); } catch { /* aperçu hors extension */ }
  });
  $('#day-prev').addEventListener('click', () => shiftDay(-1));
  $('#day-next').addEventListener('click', () => shiftDay(1));
  $('#day-label').addEventListener('click', () => { if (state.dayOffset) shiftDay(-state.dayOffset); });
  $('#live-only').addEventListener('click', (e) => {
    state.liveOnly = !state.liveOnly;
    e.currentTarget.setAttribute('aria-pressed', String(state.liveOnly));
    paintFoot();
  });
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    paintFoot();
  });
  $('#standings-back').addEventListener('click', () => { $('#standings').hidden = true; });

  content.addEventListener('click', (e) => {
    const follow = e.target.closest('[data-follow]');
    if (follow) return toggleFavorite(follow.dataset.follow);
    const st = e.target.closest('[data-standings]');
    if (st) return openStandings(st.dataset.standings, st.dataset.name);
    const sess = e.target.closest('[data-sess]');
    if (sess) {
      state.f1Session = sess.dataset.sess;
      state.f1ShowAll = false;
      return render(true);
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      state[tog.dataset.toggle] = !state[tog.dataset.toggle];
      return render(true);
    }
    const btn = e.target.closest('.match-main');
    if (btn) {
      const m = btn.closest('.match');
      btn.setAttribute('aria-expanded', String(m.classList.toggle('open')));
    }
  });

  // Raccourcis clavier.
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (!$('#standings').hidden) $('#standings').hidden = true;
      else if (!$('#settings').hidden) $('#settings-close').click();
      else if (typing) document.activeElement.blur();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('#settings').hidden || !$('#standings').hidden) return;
    const k = e.key.toLowerCase();
    if (k === '1') switchTab('foot');
    else if (k === '2') switchTab('f1');
    else if (k === '3') switchTab('gt');
    else if (k === 'r') render();
    else if (k === 't') cycleTheme();
    else if (state.tab === 'foot' && e.key === 'ArrowLeft') shiftDay(-1);
    else if (state.tab === 'foot' && e.key === 'ArrowRight') shiftDay(1);
    else if (state.tab === 'foot' && e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else return;
  });

  bindSettings();
  render();
}

init();
