// Liste des compétitions disponibles et réglages par défaut.

export const FOOT_LEAGUES = [
  { id: 'fra.1', name: 'Ligue 1', on: true },
  { id: 'fra.2', name: 'Ligue 2', on: true },
  { id: 'fra.coupe_de_france', name: 'Coupe de France', on: true },
  { id: 'uefa.champions', name: 'Ligue des champions', on: true },
  { id: 'uefa.europa', name: 'Ligue Europa', on: true },
  { id: 'uefa.europa.conf', name: 'Ligue Conférence', on: true },
  { id: 'eng.1', name: 'Premier League', on: true },
  { id: 'esp.1', name: 'LaLiga', on: true },
  { id: 'ita.1', name: 'Serie A', on: true },
  { id: 'ger.1', name: 'Bundesliga', on: true },
  { id: 'por.1', name: 'Liga Portugal', on: false },
  { id: 'ned.1', name: 'Eredivisie', on: false },
  { id: 'bel.1', name: 'Pro League (Belgique)', on: false },
  { id: 'uefa.nations', name: 'Ligue des nations', on: false },
  { id: 'fifa.friendly', name: 'Matchs amicaux', on: false },
  { id: 'usa.1', name: 'MLS', on: false },
];

// Championnats GT3 suivis via TheSportsDB (calendrier uniquement).
export const GT_LEAGUES = [
  { id: '4439', name: 'GT World Challenge Europe – Endurance', on: true },
  { id: '4410', name: 'British GT', on: true },
];

// Palettes prêtes à l'emploi : [clair, sombre] pour l'aperçu des pastilles.
export const PALETTES = [
  { id: 'pelouse', name: 'Pelouse', colors: ['#0b7a4b', '#38d585'] },
  { id: 'ocean', name: 'Océan', colors: ['#1463d6', '#5ea6ff'] },
  { id: 'sunset', name: 'Crépuscule', colors: ['#d9480f', '#ff8f52'] },
  { id: 'neon', name: 'Néon', colors: ['#7c3aed', '#b794ff'] },
  { id: 'paddock', name: 'Paddock', colors: ['#d6001c', '#ff4b5c'] },
  { id: 'minuit', name: 'Minuit', colors: ['#0f766e', '#2dd4bf'] },
  { id: 'sable', name: 'Sable', colors: ['#8a5a12', '#e2b25c'] },
  { id: 'graphite', name: 'Graphite', colors: ['#1d2125', '#e9ecef'] },
];

// Thèmes personnalisés de départ proposés dans l'éditeur.
export const CUSTOM_PRESETS = [
  { name: 'Stade de nuit', bg: '#0b1410', surface: '#13201a', text: '#e8f5ee', accent: '#c6ff3d', live: '#ff4d4d' },
  { name: 'Pit lane', bg: '#111111', surface: '#1c1c1c', text: '#f5f5f5', accent: '#ffcc00', live: '#ff3b30' },
  { name: 'Papier', bg: '#f2ede3', surface: '#fbf8f2', text: '#2b2620', accent: '#b4441f', live: '#c62828' },
  { name: 'Glacier', bg: '#e9f1f7', surface: '#ffffff', text: '#0e2236', accent: '#0077c8', live: '#e5383b' },
];

export const DEFAULTS = {
  footLeagues: FOOT_LEAGUES.filter((l) => l.on).map((l) => l.id),
  gtLeagues: GT_LEAGUES.filter((l) => l.on).map((l) => l.id),
  customGt: [], // [{id, name}] ajoutés par l'utilisateur
  favorites: [], // noms d'équipes mis en avant
  badge: true,
  notify: 'fav', // 'fav' | 'all' | 'off' : notifications de but
  themeCfg: {
    mode: 'auto', // 'auto' | 'light' | 'dark'
    palette: 'pelouse', // une des PALETTES ou 'custom'
    lastPreset: 'pelouse',
    custom: { bg: '#101418', surface: '#1a2027', text: '#eef2f5', accent: '#ffcc00', live: '#ff4d4d' },
    radius: 12,
    font: 'system', // system | rounded | serif | mono | condensed
    size: 'normal', // compact | normal | large
  },
  lastTab: 'foot',
};

/** Vrai si l'équipe correspond à une des équipes favorites. */
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
    return { ...DEFAULTS };
  }
}

export async function saveSettings(patch) {
  try {
    await chrome.storage.sync.set(patch);
  } catch {
    /* hors extension (aperçu) : on ignore */
  }
}
