// Shared view helpers: every function returns an HTML string.
// Used by both the popup (popup.js) and the full-screen page (page.js).
import { isoDay } from './api.js';
import { t, locale, lang } from './i18n.js';
import { isFavTeam } from './config.js';

/* ================================================================ basics */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const safeUrl = (u) => (/^https:\/\//.test(u ?? '') ? esc(u) : '');
export const img = (src, alt = '') =>
  safeUrl(src) ? `<img src="${safeUrl(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : '';
export const isHex = (c) => /^#[0-9a-f]{3,8}$/i.test(c ?? '');

export const fmtTime = (d) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat(locale(), opts).format(new Date(d));
export const sameDay = (a, b) => isoDay(new Date(a)) === isoDay(new Date(b));
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function dayFromOffset(off) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + off);
  return d;
}

/** "Today", "Yesterday", "Tomorrow" or a short date. */
export function dayLabel(off) {
  if (off === 0) return t('day.today');
  if (off === -1) return t('day.yesterday');
  if (off === 1) return t('day.tomorrow');
  return fmtDay(dayFromOffset(off));
}

/** Same as dayLabel but usable inside a sentence ("today", "on Tue 21 Oct"). */
export function dayPhrase(off) {
  if (off === 0) return t('day.phrase.today');
  if (off === -1) return t('day.phrase.yesterday');
  if (off === 1) return t('day.phrase.tomorrow');
  return t('day.phrase.other', { date: fmtDay(dayFromOffset(off)) });
}

export function relDays(dateStr) {
  const a = new Date(isoDay(new Date()) + 'T12:00:00');
  const b = new Date(isoDay(new Date(dateStr)) + 'T12:00:00');
  const n = Math.round((b - a) / 86400000);
  if (n === 0) return t('day.today');
  if (n === 1) return t('day.tomorrow');
  if (n === -1) return t('day.yesterday');
  return n > 0 ? t('rel.in', { n }) : t('rel.ago', { n: -n });
}

export const sessionName = (abbr) => {
  const k = `sess.${abbr}`;
  const v = t(k);
  return v === k ? abbr : v;
};

/** Translated match status, or the kick-off time for upcoming matches. */
export function statusText(ev) {
  const s = ev.status;
  if (s.clock) return s.clock;
  if (s.code) return t(`st.${s.code}`);
  return fmtTime(ev.date);
}

export const emptyBox = (icon, title, msg) =>
  `<div class="empty"><span class="big">${icon}</span><strong>${esc(title)}</strong>${esc(msg)}</div>`;
export const skeleton = (n = 4) => Array.from({ length: n }, () => '<div class="skel"></div>').join('');
export const stamp = () => `<div class="updated">${esc(t('ui.updated', { time: fmtTime(new Date()) }))}</div>`;

/* ================================================================ icons & flags */

export const ICON_YT =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9L15.5 12z"/></svg>';
export const ICON_CAL =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
export const ICON_EXT =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
export const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  custom:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.9 1.2-1.7-.4-1 .3-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>',
};

let flagSeq = 0;
/** Small SVG flag (emoji flags render as plain letters on Windows). */
export function flag(code) {
  if (code === 'fr') {
    return '<svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#0055A4"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#EF4135"/></svg>';
  }
  const id = `uk${++flagSeq}`;
  return `<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><clipPath id="${id}a"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="${id}b"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#${id}a)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#${id}b)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>`;
}

/* ================================================================ external links */

export function ytLink(query, label) {
  const q = query.replace(/\s+/g, ' ').trim();
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  // data-yt lets the full-screen page intercept the click and play the first result inline.
  return `<a class="pill-btn yt" href="${esc(url)}" data-yt="${esc(q)}" target="_blank" rel="noopener">${ICON_YT}${esc(label)}</a>`;
}

export function gcalLink({ title, start, end, details = '', location = '', allDay = false }) {
  const f = (d) => (allDay ? isoDay(d).replace(/-/g, '') : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
  const s = new Date(start);
  let e = end ? new Date(end) : new Date(s.getTime() + 2 * 3600000);
  if (allDay) {
    e = new Date(e);
    e.setDate(e.getDate() + 1);
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(s)}/${f(e)}`, details, location });
  return `<a class="pill-btn" href="https://calendar.google.com/calendar/render?${esc(p.toString())}" target="_blank" rel="noopener">${ICON_CAL}${esc(t('link.calendar'))}</a>`;
}

export const extLink = (url, label) =>
  safeUrl(url) ? `<a class="pill-btn" href="${safeUrl(url)}" target="_blank" rel="noopener">${ICON_EXT}${esc(label)}</a>` : '';

/* ================================================================ football */

/**
 * One match row (click to expand).
 * opts: { leagueName, favorites, flash, follow (show follow buttons) }
 */
export function matchRow(ev, { leagueName = '', favorites = [], flash = false, follow = true } = {}) {
  const { home, away, status } = ev;
  const pre = status.state === 'pre';
  const post = status.state === 'post';
  const fav = (tm) => isFavTeam(tm, favorites);

  const side = (tm, o) => {
    const c = ['team'];
    if (post && tm.winner) c.push('win');
    else if (post && o.winner) c.push('lose');
    return `<div class="${c.join(' ')}">${img(tm.logo) || '<span class="logo-ph"></span>'}<span class="nm" title="${esc(tm.fullName)}">${esc(tm.name)}</span>${fav(tm) ? '<span class="star">★</span>' : ''}</div>`;
  };
  const sc = (tm, o) => {
    const lose = post && o.winner && !tm.winner;
    const pen = tm.shootout != null ? `<span class="pen">(${esc(tm.shootout)})</span>` : '';
    return `<span class="${lose ? 'lose' : ''}">${esc(tm.score)}${pen}</span>`;
  };
  const stCls = status.live ? ' live' : post ? ' ft' : '';

  const events = ev.details
    .map((d) => {
      const isHome = d.teamId === home.id;
      const ico = d.kind === 'red' ? '🟥' : d.kind === 'og' ? `⚽ ${t('ev.og')}` : d.kind === 'pen' ? `⚽ ${t('ev.pen')}` : '⚽';
      return `<div class="ev ${isHome ? 'home' : 'away'}"><span class="min">${esc(d.minute)}</span><span>${esc(d.player)}</span><span class="ico">${esc(ico)}</span></div>`;
    })
    .join('');

  const date = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ev.date));
  const hn = home.fullName || home.name;
  const an = away.fullName || away.name;
  const followBtn = (tm) =>
    `<button class="pill-btn${fav(tm) ? ' on' : ''}" data-follow="${esc(tm.name)}" title="${esc(t('foot.follow'))}">${fav(tm) ? '★' : '☆'} ${esc(tm.name)}</button>`;

  const links = [
    !pre ? ytLink(t('yt.match', { h: hn, a: an, date }), t('link.summary')) : '',
    pre ? gcalLink({ title: `${hn} – ${an}`, start: ev.date, details: leagueName, location: ev.venue }) : '',
    extLink(ev.link, t('link.sheet')),
    follow ? followBtn(home) + followBtn(away) : '',
  ].join('');

  const extra = [
    events ? `<div class="events">${events}</div>` : '',
    ev.note ? `<div class="meta-line">${esc(ev.note)}</div>` : '',
    `<div class="meta-line">${esc(fmtDay(ev.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${fmtTime(ev.date)}${ev.venue ? ` · ${esc(ev.venue)}` : ''}</div>`,
    `<div class="links">${links}</div>`,
  ].join('');

  return `
  <div class="match${status.live ? ' is-live' : ''}${flash ? ' flash' : ''}" data-id="${esc(ev.id)}">
    <button class="match-main" aria-expanded="false">
      <span class="status${stCls}">${esc(statusText(ev))}</span>
      <span class="teams">${side(home, away)}${side(away, home)}</span>
      <span class="scores${pre ? ' pre' : ''}">${sc(home, away)}${sc(away, home)}</span>
    </button>
    <div class="match-extra">${extra}</div>
  </div>`;
}

/** Competition card with its matches. opts are forwarded to matchRow; opts.flashIds is a Set. */
export function leagueCard(lg, opts = {}) {
  const live = lg.events.filter((e) => e.status.live).length;
  const rows = lg.events
    .map((e) => matchRow(e, { ...opts, leagueName: lg.name, flash: opts.flashIds?.has(e.id) }))
    .join('');
  return `<section class="card league-card">
    <div class="card-head">${img(lg.logo)}<span>${esc(lg.name)}</span>
      <span class="sub">${live ? `<span class="pill live">${esc(t('foot.liveN', { n: live }))}</span>` : ''}
      <button class="link-btn" data-standings="${esc(lg.id)}" data-name="${esc(lg.name)}">${esc(t('foot.standings'))}</button></span>
    </div>
    ${rows}
  </section>`;
}

/** Full standings tables (with qualification / relegation zones). */
export function standingsHtml(data, favorites = []) {
  if (!data.groups.length) return emptyBox('📊', t('stand.none'), t('stand.noneSub'));
  const zones = new Map();
  const head = `<thead><tr><th>#</th><th>${esc(t('th.team'))}</th><th>${t('th.p')}</th><th>${t('th.w')}</th><th>${t('th.d')}</th><th>${t('th.l')}</th><th>${t('th.gd')}</th><th>${t('th.pts')}</th></tr></thead>`;
  const tables = data.groups
    .map((g) => {
      const rows = g.rows
        .map((r) => {
          if (isHex(r.zone) && r.zoneLabel) zones.set(r.zone, r.zoneLabel);
          const fav = isFavTeam({ name: r.team, fullName: r.fullName }, favorites);
          const zone = isHex(r.zone) ? `<i class="zone" style="background:${r.zone}"></i>` : '';
          return `<tr class="${fav ? 'fav' : ''}"><td class="r">${zone}${r.rank}</td>
            <td class="tm"><div>${img(r.logo)}<span title="${esc(r.fullName)}">${esc(r.team)}</span></div></td>
            <td>${esc(r.played)}</td><td>${esc(r.win)}</td><td>${esc(r.draw)}</td><td>${esc(r.loss)}</td><td>${esc(r.diff)}</td><td class="pt">${esc(r.pts)}</td></tr>`;
        })
        .join('');
      const title = data.groups.length > 1 && g.name ? `<div class="grp-title">${esc(g.name)}</div>` : '';
      return `${title}<div class="card"><table class="table">${head}<tbody>${rows}</tbody></table></div>`;
    })
    .join('');
  const legend = [...zones].map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('');
  return tables + (legend ? `<div class="legend">${legend}</div>` : '');
}

/* ================================================================ F1 */

/** Picks the session to show: live, else latest finished, else first. */
export function defaultSession(gp, selectedId) {
  return (
    gp.sessions.find((s) => s.id === selectedId) ??
    gp.sessions.find((s) => s.state === 'in') ??
    [...gp.sessions].reverse().find((s) => s.state === 'post') ??
    gp.sessions[0]
  );
}

function f1Results(sess, showAll, limit) {
  if (!sess) return '';
  if (sess.state === 'pre' || !sess.drivers.length) {
    return `<div class="note-pad">${esc(t('f1.resultsAt', { day: fmtDay(sess.date, { weekday: 'long' }), time: fmtTime(sess.date) }))}</div>`;
  }
  const list = showAll ? sess.drivers : sess.drivers.slice(0, limit);
  const rows = list
    .map(
      (d) =>
        `<div class="res${d.pos <= 3 ? ` podium p${d.pos}` : ''}"><span class="p">${d.pos}</span>${img(d.flag, d.flagAlt) || '<span></span>'}<span class="dn">${esc(d.name)}</span><span></span></div>`
    )
    .join('');
  const more =
    sess.drivers.length > limit
      ? `<button class="more" data-toggle="f1ShowAll">${esc(showAll ? t('f1.top10') : t('f1.all', { n: sess.drivers.length }))}</button>`
      : '';
  return `<div class="grid-res">${rows}</div>${more}`;
}

/** Current / last Grand Prix card. opts: { selectedId, showAll, limit, round, total } */
export function f1GpCard(gp, { selectedId, showAll = false, limit = 10, round = 0, total = 0 } = {}) {
  const now = Date.now();
  const inWeekend = new Date(gp.date).getTime() - 86400000 <= now && now <= new Date(gp.endDate).getTime() + 4 * 3600000;
  const live = gp.sessions.some((s) => s.state === 'in');
  const sel = defaultSession(gp, selectedId);

  const sessions = gp.sessions
    .map((s) => {
      const c = ['sess'];
      if (s.state === 'in') c.push('live');
      if (sameDay(s.date, now)) c.push('today');
      const when =
        s.state === 'in'
          ? t('f1.inProgress')
          : s.state === 'post'
            ? t('f1.done')
            : sameDay(s.date, now)
              ? t('f1.todayAt', { time: fmtTime(s.date) })
              : `${fmtDay(s.date, { weekday: 'short' })} ${fmtTime(s.date)}`;
      return `<button class="${c.join(' ')}" data-sess="${esc(s.id)}" aria-pressed="${s.id === sel?.id}">${esc(sessionName(s.abbr))}<span class="t">${esc(when)}</span></button>`;
    })
    .join('');

  const pill = live
    ? `<span class="pill live">${esc(t('f1.live'))}</span>`
    : `<span class="pill">${esc(inWeekend ? t('f1.weekend') : t('f1.last'))}</span>`;
  const year = new Date(gp.date).getFullYear();
  const links = [];
  if (sel && sel.state !== 'pre') {
    const what = sel.abbr === 'Race' ? (lang() === 'fr' ? 'course' : 'race') : sessionName(sel.abbr);
    const label = t('link.bestofSession', { s: sessionName(sel.abbr).toLowerCase() });
    links.push(ytLink(t('yt.f1', { gp: gp.name, year, what }), label.charAt(0).toUpperCase() + label.slice(1)));
  }
  if (sel && sel.state === 'pre') {
    const hours = sel.abbr === 'Race' ? 2 : 1;
    links.push(
      gcalLink({ title: `F1 · ${sessionName(sel.abbr)} · ${gp.name}`, start: sel.date, end: new Date(new Date(sel.date).getTime() + hours * 3600000), location: gp.circuit })
    );
  }
  links.push(extLink(gp.link, t('link.sheet')));

  const dates = `${fmtDay(gp.date, { day: 'numeric', month: 'short' })} – ${fmtDay(gp.endDate, { day: 'numeric', month: 'short' })}`;
  return `<section class="card gp-card">
    <div class="gp-head">
      <div class="gp-title">${esc(gp.name)} ${pill}</div>
      <div class="gp-meta">${round ? `${esc(t('f1.round', { r: round, t: total }))} · ` : ''}${esc(dates)}${gp.circuit ? ` · ${esc(gp.circuit)}` : ''}</div>
    </div>
    <div class="sessions">${sessions}</div>
    ${f1Results(sel, showAll, limit)}
    <div class="links pad">${links.join('')}</div>
  </section>`;
}

export function f1NextCard(next) {
  if (!next) return '';
  const range = `${fmtDay(next.start, { weekday: 'short', day: 'numeric', month: 'long' })} – ${fmtDay(next.end, { weekday: 'short', day: 'numeric', month: 'long' })}`;
  return `<section class="card">
    <div class="card-head"><span>${esc(t('f1.next'))}</span></div>
    <div class="next-row">
      <div><strong>${esc(next.name)}</strong><div class="gp-meta">${esc(range)}</div></div>
      <div class="when"><span class="countdown">${esc(relDays(next.start))}</span>${gcalLink({ title: `F1 · ${next.name}`, start: next.start, end: next.end, allDay: true })}</div>
    </div>
  </section>`;
}

/** Drivers' championship. opts: { showAll, limit } */
export function f1StandingsCard(groups, { showAll = false, limit = 5 } = {}) {
  const drivers = groups?.[0];
  if (!drivers?.rows.length) return '';
  const list = showAll ? drivers.rows : drivers.rows.slice(0, limit);
  const rows = list
    .map(
      (d) =>
        `<div class="res${d.rank <= 3 ? ` podium p${d.rank}` : ''}"><span class="p">${d.rank}</span>${img(d.flag) || '<span></span>'}<span class="dn">${esc(d.name)}</span><span class="pts">${esc(t('f1.pts', { n: d.pts }))}</span></div>`
    )
    .join('');
  const more =
    drivers.rows.length > limit
      ? `<button class="more" data-toggle="f1StandShowAll">${esc(showAll ? t('f1.less') : t('f1.full'))}</button>`
      : '';
  return `<section class="card"><div class="card-head"><span>${esc(t('f1.champ'))}</span></div><div class="grid-res">${rows}</div>${more}</section>`;
}

/* ================================================================ GT3 */

function gtRow(label, ev, isToday, champ) {
  if (!ev) return '';
  const where = [ev.venue, ev.country].filter(Boolean).join(', ');
  const d = ev.date + 'T12:00:00';
  const when = `${fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${relDays(d).toLowerCase()}`;
  const past = ev.date <= isoDay(new Date());
  const links = past
    ? ytLink(t('yt.gt', { champ, ev: ev.name, season: ev.season || '' }), t('link.bestof'))
    : gcalLink({ title: `${champ} · ${ev.name}`, start: d, end: d, allDay: true, location: where });
  return `<div class="gt-ev${isToday ? ' today' : ''}">
    <span class="lbl">${esc(label)}</span>
    <div><div class="nm">${esc(ev.name)}</div><div class="meta">${esc(when)}${where ? ` · ${esc(where)}` : ''}</div>
    <div class="links">${links}</div></div>
  </div>`;
}

/** One GT championship card. Returns { html, today } where today is the event running today, if any. */
export function gtCard(c) {
  if (c.error) {
    return { html: `<section class="card"><div class="card-head"><span>${esc(c.name)}</span></div><div class="note-pad">${esc(t('gt.unavailable'))}</div></section>`, today: null };
  }
  const todayIso = isoDay(new Date());
  const todayEv = [c.last, c.next].find((e) => e?.date === todayIso) ?? null;
  const rows = todayEv
    ? gtRow(t('gt.today'), todayEv, true, c.name) +
      (todayEv === c.next ? gtRow(t('gt.prev'), c.last, false, c.name) : gtRow(t('gt.after'), c.next, false, c.name))
    : gtRow(t('gt.last'), c.last, false, c.name) + gtRow(t('gt.next'), c.next, false, c.name);
  const html = `<section class="card"><div class="card-head"><span>${esc(c.name)}</span>${
    todayEv ? `<span class="sub"><span class="pill">${esc(t('gt.raceDay'))}</span></span>` : ''
  }</div>${rows || `<div class="note-pad">${esc(t('gt.none'))}</div>`}</section>`;
  return { html, today: todayEv };
}
