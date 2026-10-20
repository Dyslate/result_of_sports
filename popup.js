// Popup UI: tabs (football / F1 / GT3), settings panel and standings panel.
import { fetchFootball, fetchF1, fetchGT, fetchStandings, fetchF1Standings, clearCache } from './src/api.js';
import { FOOT_LEAGUES, GT_LEAGUES, PALETTES, CUSTOM_PRESETS, loadSettings, saveSettings, isFavTeam, refreshMinutes } from './src/config.js';
import { t, setLang, lang, localName, applyI18n } from './src/i18n.js';
import {
  esc, norm, fmtTime, dayFromOffset, dayLabel, dayPhrase, emptyBox, skeleton, stamp, flag, THEME_ICONS,
  leagueCard, standingsHtml, f1GpCard, f1NextCard, f1StandingsCard, gtCard,
} from './src/render.js';

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
  lastFoot: null, // last football payload, so filters re-render without refetching
  scores: new Map(), // match id -> "h-a", used to flash a score that just changed
  timer: null,
  loading: false,
};

/* ================================================================ helpers */

const isFav = (team) => isFavTeam(team, state.settings.favorites);

function scheduleRefresh(hasLive) {
  clearTimeout(state.timer);
  // Same pace as the background checks (Settings → Automatic refresh); none in manual mode.
  const every = refreshMinutes(state.settings.refresh, hasLive);
  if (every != null) state.timer = setTimeout(() => render(true), every * 60000);
}


function setTabCount(tab, n) {
  const btn = $(`.tab[data-tab="${tab}"]`);
  btn.querySelector('.count')?.remove();
  if (n > 0) btn.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="toast">${esc(msg)}</div>`);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => document.querySelector('.toast')?.remove(), 1800);
}

async function persist(patch) {
  Object.assign(state.settings, patch);
  await saveSettings(patch);
}

function openWebPage() {
  try {
    chrome.tabs.create({ url: chrome.runtime.getURL('page.html') });
    window.close();
  } catch {
    window.open('page.html', '_blank'); // preview outside the extension
  }
}

/* ================================================================ language */

function applyLanguage() {
  setLang(state.settings.lang);
  applyI18n();
  const other = lang() === 'fr' ? 'en' : 'fr';
  const btn = $('#lang-btn');
  btn.innerHTML = flag(lang());
  btn.title = other === 'en' ? 'Switch to English (L)' : 'Passer en français (L)';
  btn.setAttribute('aria-label', btn.title);
  applyTheme(); // refresh translated theme tooltip
}

function toggleLanguage() {
  const next = lang() === 'fr' ? 'en' : 'fr';
  persist({ lang: next });
  applyLanguage();
  if (!$('#settings').hidden) renderSettings();
  render(true);
}

/* ================================================================ theme */

function applyTheme() {
  const cfg = state.settings.themeCfg;
  window.applyThemeCfg?.(cfg);
  const custom = cfg.palette === 'custom';
  $('#theme-btn').innerHTML = custom ? THEME_ICONS.custom : THEME_ICONS[cfg.mode] ?? THEME_ICONS.auto;
  $('#theme-btn').title = custom ? t('theme.customTitle') : t('theme.modeTitle', { m: t(`theme.mode.${cfg.mode}`) });
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
  toast(t('theme.modeToast', { m: t(`theme.mode.${mode}`) }));
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
        <span class="dots"><i style="background:${p.colors[0]}"></i><i style="background:${p.colors[1]}"></i></span>${esc(localName(p))}</button>`
    ).join('') +
    `<button class="swatch" role="radio" data-palette="custom" aria-checked="${custom}"><span class="rainbow"></span>${esc(t('set.custom'))}</button>`;

  $('#custom-editor').hidden = !custom;
  $('#custom-presets').innerHTML = CUSTOM_PRESETS.map(
    (p, i) => `<button class="ce-preset" data-cpreset="${i}"><i style="background:linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)"></i>${esc(localName(p))}</button>`
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
    if (!['bg', 'surface', 'text', 'accent', 'live'].every((k) => hex(c[k]))) throw new Error('colours');
    setTheme({
      palette: 'custom',
      custom: { bg: c.bg, surface: c.surface, text: c.text, accent: c.accent, live: c.live },
      radius: Math.min(22, Math.max(0, Number(raw.radius) || 12)),
      font: ['system', 'rounded', 'serif', 'mono', 'condensed'].includes(raw.font) ? raw.font : 'system',
      size: ['compact', 'normal', 'large'].includes(raw.size) ? raw.size : 'normal',
    });
    toast(t('theme.imported'));
    return true;
  } catch {
    toast(t('theme.invalid'));
    return false;
  }
}

/* ================================================================ football */

function paintFoot() {
  const data = state.lastFoot;
  if (!data) return false;
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

  const liveCount = data.leagues.reduce((n, lg) => n + lg.events.filter((e) => e.status.live).length, 0);
  if (state.dayOffset === 0) setTabCount('foot', liveCount);

  if (!lgs.length) {
    content.innerHTML = q
      ? emptyBox('🔎', t('foot.noResult'), t('foot.noTeam', { q: state.query }))
      : state.liveOnly
        ? emptyBox('📺', t('foot.noLive'), t('foot.noLiveSub'))
        : emptyBox('🗓️', t('foot.noMatch'), t('foot.noMatchSub', { day: dayPhrase(state.dayOffset) }));
    return liveCount > 0;
  }

  // Flash scores that changed since the previous refresh.
  const flashIds = new Set();
  for (const lg of data.leagues) {
    for (const e of lg.events) {
      const key = `${e.home.score}-${e.away.score}`;
      const prev = state.scores.get(e.id);
      if (prev && prev !== key && e.status.live) flashIds.add(e.id);
      state.scores.set(e.id, key);
    }
  }

  const opts = { favorites: state.settings.favorites, flashIds };
  const warn = data.errors.length ? `<div class="warn">${esc(t('foot.unavailable', { n: data.errors.length }))}</div>` : '';
  const open = $$('.match.open').map((m) => m.dataset.id); // keep expanded matches open
  content.innerHTML = warn + lgs.map((lg) => leagueCard(lg, opts)).join('') + stamp();
  for (const id of open) {
    const m = $(`.match[data-id="${CSS.escape(id)}"]`);
    m?.classList.add('open');
    m?.querySelector('.match-main').setAttribute('aria-expanded', 'true');
  }
  return liveCount > 0;
}

async function renderFoot(silent) {
  $('#day-label').textContent = dayLabel(state.dayOffset);
  const leagues = state.settings.footLeagues;
  if (!leagues.length) {
    content.innerHTML = emptyBox('⚙️', t('foot.noComp'), t('foot.noCompSub'));
    return false;
  }
  if (!silent) content.innerHTML = skeleton();
  const offset = state.dayOffset;
  let data;
  try {
    data = await fetchFootball(dayFromOffset(offset), leagues);
  } catch {
    data = { leagues: [], failedAll: true, errors: leagues };
  }
  if (state.tab !== 'foot' || offset !== state.dayOffset) return false;
  if (data.failedAll) {
    content.innerHTML = data.blockedUntil
      ? emptyBox('⏳', t('err.blocked'), t('err.blockedSub', { time: fmtTime(data.blockedUntil) }))
      : emptyBox('📡', t('foot.err'), t('err.sub')) + `<div class="retry"><button class="btn" data-retry>${esc(t('ui.retry'))}</button></div>`;
    return false;
  }
  state.lastFoot = data;
  return paintFoot();
}

async function openStandings(id, name) {
  $('#standings-title').textContent = t('stand.title', { name });
  $('#standings').hidden = false;
  const body = $('#standings-body');
  body.innerHTML = skeleton(3);
  try {
    body.innerHTML = standingsHtml(await fetchStandings(id), state.settings.favorites);
  } catch {
    body.innerHTML = emptyBox('📡', t('stand.err'), t('stand.errSub'));
  }
}

/* ================================================================ F1 */

async function renderF1(silent) {
  if (!silent) content.innerHTML = skeleton(3);
  const [res, stand] = await Promise.allSettled([fetchF1(), fetchF1Standings()]);
  if (state.tab !== 'f1') return false;
  if (res.status !== 'fulfilled') {
    const until = res.reason?.blockedUntil;
    content.innerHTML = until
      ? emptyBox('⏳', t('err.blocked'), t('err.blockedSub', { time: fmtTime(until) }))
      : emptyBox('📡', t('f1.err'), t('err.sub'));
    return false;
  }
  const { current, next, round, total } = res.value;
  let html = '';
  let live = false;
  if (current) {
    live = current.sessions.some((s) => s.state === 'in');
    html += f1GpCard(current, { selectedId: state.f1Session, showAll: state.f1ShowAll, round, total });
  }
  html += f1NextCard(next);
  if (stand.status === 'fulfilled') html += f1StandingsCard(stand.value, { showAll: state.f1StandShowAll });
  if (!html) html = emptyBox('🏁', t('f1.over'), t('f1.overSub'));
  content.innerHTML = html + stamp();
  setTabCount('f1', live ? 1 : 0);
  return live;
}

/* ================================================================ GT3 */

async function renderGT(silent) {
  const s = state.settings;
  const leagues = [...GT_LEAGUES, ...s.customGt].filter((l) => s.gtLeagues.includes(l.id));
  if (!leagues.length) {
    content.innerHTML = emptyBox('⚙️', t('gt.noChamp'), t('foot.noCompSub'));
    return false;
  }
  if (!silent) content.innerHTML = skeleton(2);
  let data;
  try {
    data = await fetchGT(leagues);
  } catch {
    if (state.tab === 'gt') content.innerHTML = emptyBox('📡', t('gt.err'), t('err.sub'));
    return false;
  }
  if (state.tab !== 'gt') return false;
  const cards = data.map(gtCard);
  setTabCount('gt', cards.filter((c) => c.today).length);
  content.innerHTML = cards.map((c) => c.html).join('') + `<div class="note">${esc(t('gt.note'))}</div>` + stamp();
  return false;
}

/* ================================================================ render loop */

async function render(silent = false) {
  if (state.loading) return;
  state.loading = true;
  $('#refresh').classList.add('spin');
  $('#foot-bar').hidden = state.tab !== 'foot';
  $$('.tab').forEach((tb) => tb.setAttribute('aria-selected', String(tb.dataset.tab === state.tab)));
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
  // Keep expanded matches open across refreshes.
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

/* ================================================================ settings */

function renderSettings() {
  const s = state.settings;
  $('#set-foot').innerHTML = FOOT_LEAGUES.map(
    (l) => `<label class="check"><input type="checkbox" data-foot="${esc(l.id)}" ${s.footLeagues.includes(l.id) ? 'checked' : ''}> ${esc(localName(l))}</label>`
  ).join('');
  $('#set-gt').innerHTML = [...GT_LEAGUES, ...s.customGt]
    .map((l) => `<label class="check"><input type="checkbox" data-gt="${esc(l.id)}" ${s.gtLeagues.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`)
    .join('');
  $('#set-fav').value = s.favorites.join(', ');
  $('#set-badge').checked = s.badge;
  $$('#set-notify [data-notify]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.notify === s.notify)));
  $$('#set-lang [data-lang]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === (s.lang ?? 'auto'))));
  $$('#set-refresh [data-refresh]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.refresh === (s.refresh ?? 'normal'))));
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
  $('#set-lang').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    persist({ lang: b.dataset.lang });
    applyLanguage();
    renderSettings();
  });
  $('#set-foot').addEventListener('change', () => persist({ footLeagues: $$('[data-foot]:checked').map((i) => i.dataset.foot) }));
  $('#set-gt').addEventListener('change', () => persist({ gtLeagues: $$('[data-gt]:checked').map((i) => i.dataset.gt) }));
  $('#set-fav').addEventListener('change', (e) =>
    persist({ favorites: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })
  );
  $('#set-badge').addEventListener('change', (e) => persist({ badge: e.target.checked }));
  $('#set-refresh').addEventListener('click', (e) => {
    const b = e.target.closest('[data-refresh]');
    if (!b) return;
    persist({ refresh: b.dataset.refresh });
    $$('#set-refresh [data-refresh]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  $('#set-notify').addEventListener('click', (e) => {
    const b = e.target.closest('[data-notify]');
    if (!b) return;
    persist({ notify: b.dataset.notify });
    $$('#set-notify [data-notify]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
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
    const { bg, surface, text, accent, live } = CUSTOM_PRESETS[+b.dataset.cpreset];
    setTheme({ custom: { bg, surface, text, accent, live } });
  });
  // Live preview while dragging a colour picker; saved when released.
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
      toast(t('ui.copied'));
    } catch {
      const inp = $('#theme-import-input');
      inp.hidden = false;
      inp.value = exportTheme();
      inp.select();
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
  $('#set-gt-add').addEventListener('click', async () => {
    const id = $('#set-gt-id').value.trim();
    if (!/^\d+$/.test(id)) return;
    const s = state.settings;
    if (![...GT_LEAGUES, ...s.customGt].some((l) => l.id === id)) {
      let name = t('gt.custom', { id });
      try {
        const [c] = await fetchGT([{ id, name }]);
        if (c && !c.error && c.name) name = c.name;
      } catch {
        /* keep the default name */
      }
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
  applyLanguage();

  $$('.tab').forEach((tb) => tb.addEventListener('click', () => switchTab(tb.dataset.tab)));
  $('#theme-btn').addEventListener('click', cycleTheme);
  $('#lang-btn').addEventListener('click', toggleLanguage);
  $('#open-page').addEventListener('click', openWebPage);
  $('#refresh').addEventListener('click', async () => {
    await clearCache();
    render();
    try {
      chrome.runtime.sendMessage({ type: 'refresh-badge' });
    } catch {
      /* preview outside the extension */
    }
  });
  $('#day-prev').addEventListener('click', () => shiftDay(-1));
  $('#day-next').addEventListener('click', () => shiftDay(1));
  $('#day-label').addEventListener('click', () => {
    if (state.dayOffset) shiftDay(-state.dayOffset);
  });
  $('#live-only').addEventListener('click', (e) => {
    state.liveOnly = !state.liveOnly;
    e.currentTarget.setAttribute('aria-pressed', String(state.liveOnly));
    paintFoot();
  });
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    paintFoot();
  });
  $('#standings-back').addEventListener('click', () => {
    $('#standings').hidden = true;
  });

  content.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) {
      return clearCache().then(() => render());
    }
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

  // Keyboard shortcuts.
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
    else if (k === 'l') toggleLanguage();
    else if (k === 'w') openWebPage();
    else if (state.tab === 'foot' && e.key === 'ArrowLeft') shiftDay(-1);
    else if (state.tab === 'foot' && e.key === 'ArrowRight') shiftDay(1);
    else if (state.tab === 'foot' && e.key === '/') {
      e.preventDefault();
      $('#search').focus();
    }
  });

  bindSettings();
  render();
}

init();
