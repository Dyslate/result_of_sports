// Available competitions, theme presets and default settings.
// `name` is the French label, `en` the English one (see localName() in i18n.js).

export const FOOT_LEAGUES = [
  { id: 'fra.1', name: 'Ligue 1', en: 'Ligue 1', on: true },
  { id: 'fra.2', name: 'Ligue 2', en: 'Ligue 2', on: true },
  { id: 'fra.coupe_de_france', name: 'Coupe de France', en: 'Coupe de France', on: true },
  { id: 'uefa.champions', name: 'Ligue des champions', en: 'Champions League', on: true },
  { id: 'uefa.europa', name: 'Ligue Europa', en: 'Europa League', on: true },
  { id: 'uefa.europa.conf', name: 'Ligue Conférence', en: 'Conference League', on: true },
  { id: 'eng.1', name: 'Premier League', en: 'Premier League', on: true },
  { id: 'esp.1', name: 'LaLiga', en: 'LaLiga', on: true },
  { id: 'ita.1', name: 'Serie A', en: 'Serie A', on: true },
  { id: 'ger.1', name: 'Bundesliga', en: 'Bundesliga', on: true },
  { id: 'por.1', name: 'Liga Portugal', en: 'Liga Portugal', on: false },
  { id: 'ned.1', name: 'Eredivisie', en: 'Eredivisie', on: false },
  { id: 'bel.1', name: 'Pro League (Belgique)', en: 'Pro League (Belgium)', on: false },
  { id: 'uefa.nations', name: 'Ligue des nations', en: 'Nations League', on: false },
  { id: 'fifa.friendly', name: 'Matchs amicaux', en: 'Friendlies', on: false },
  { id: 'usa.1', name: 'MLS', en: 'MLS', on: false },
];

// https page that hosts the YouTube player (docs/player.html, published with GitHub Pages).
// YouTube refuses embeds inside chrome-extension:// pages (error 153), so the extension
// embeds this relay instead. Change it if you fork the repository.
export const PLAYER_RELAY = 'https://dyslate.github.io/result_of_sports/player.html';

// GT3 championships tracked through TheSportsDB (calendar only).
export const GT_LEAGUES = [
  { id: '4439', name: 'GT World Challenge Europe – Endurance', on: true },
  { id: '4410', name: 'British GT', on: true },
];

// Ready-made palettes: [light, dark] accent colours for the swatch preview.
export const PALETTES = [
  { id: 'pelouse', name: 'Pelouse', en: 'Pitch', colors: ['#0b7a4b', '#38d585'] },
  { id: 'ocean', name: 'Océan', en: 'Ocean', colors: ['#1463d6', '#5ea6ff'] },
  { id: 'sunset', name: 'Crépuscule', en: 'Sunset', colors: ['#d9480f', '#ff8f52'] },
  { id: 'neon', name: 'Néon', en: 'Neon', colors: ['#7c3aed', '#b794ff'] },
  { id: 'paddock', name: 'Paddock', en: 'Paddock', colors: ['#d6001c', '#ff4b5c'] },
  { id: 'minuit', name: 'Minuit', en: 'Midnight', colors: ['#0f766e', '#2dd4bf'] },
  { id: 'sable', name: 'Sable', en: 'Sand', colors: ['#8a5a12', '#e2b25c'] },
  { id: 'graphite', name: 'Graphite', en: 'Graphite', colors: ['#1d2125', '#e9ecef'] },
];

// Starting points offered in the custom theme editor.
export const CUSTOM_PRESETS = [
  { name: 'Stade de nuit', en: 'Night stadium', bg: '#0b1410', surface: '#13201a', text: '#e8f5ee', accent: '#c6ff3d', live: '#ff4d4d' },
  { name: 'Pit lane', en: 'Pit lane', bg: '#111111', surface: '#1c1c1c', text: '#f5f5f5', accent: '#ffcc00', live: '#ff3b30' },
  { name: 'Papier', en: 'Paper', bg: '#f2ede3', surface: '#fbf8f2', text: '#2b2620', accent: '#b4441f', live: '#c62828' },
  { name: 'Glacier', en: 'Glacier', bg: '#e9f1f7', surface: '#ffffff', text: '#0e2236', accent: '#0077c8', live: '#e5383b' },
];

// Automatic refresh, in minutes: while something is live / otherwise. 'off' = manual only.
export const REFRESH = {
  fast: { live: 1, idle: 10 },
  normal: { live: 5, idle: 15 },
  slow: { live: 15, idle: 60 },
  off: null,
};

/** Minutes until the next automatic refresh, or null when refreshing is manual. */
export function refreshMinutes(setting, live) {
  const r = setting in REFRESH ? REFRESH[setting] : REFRESH.normal;
  return r ? (live ? r.live : r.idle) : null;
}

export const DEFAULTS = {
  footLeagues: FOOT_LEAGUES.filter((l) => l.on).map((l) => l.id),
  gtLeagues: GT_LEAGUES.filter((l) => l.on).map((l) => l.id),
  customGt: [], // [{ id, name }] added by the user
  favorites: [], // highlighted team names
  badge: true,
  notify: 'fav', // goal alerts: 'fav' | 'all' | 'off'
  refresh: 'normal', // automatic refresh: 'fast' | 'normal' | 'slow' | 'off' (see REFRESH)
  lang: 'auto', // 'auto' | 'fr' | 'en'
  themeCfg: {
    mode: 'auto', // 'auto' | 'light' | 'dark'
    palette: 'pelouse', // one of PALETTES, or 'custom'
    lastPreset: 'pelouse',
    custom: { bg: '#101418', surface: '#1a2027', text: '#eef2f5', accent: '#ffcc00', live: '#ff4d4d' },
    radius: 12,
    font: 'system', // system | rounded | serif | mono | condensed
    size: 'normal', // compact | normal | large
  },
  lastTab: 'foot',
};

/** True when the team matches one of the favourite names. */
export function isFavTeam(team, favorites) {
  if (!team || !favorites?.length) return false;
  const n = `${team.name ?? ''} ${team.fullName ?? ''}`.toLowerCase();
  return favorites.some((f) => f && n.includes(f.toLowerCase()));
}

export async function loadSettings() {
  try {
    const s = await chrome.storage.sync.get(DEFAULTS);
    const t = s.themeCfg ?? {};
    return {
      ...DEFAULTS,
      ...s,
      themeCfg: { ...DEFAULTS.themeCfg, ...t, custom: { ...DEFAULTS.themeCfg.custom, ...(t.custom ?? {}) } },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export async function saveSettings(patch) {
  try {
    await chrome.storage.sync.set(patch);
  } catch {
    /* outside the extension (preview): ignore */
  }
}
