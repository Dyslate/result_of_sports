// Applique le thème avant le premier rendu (évite le flash) et expose applyThemeCfg().
(function () {
  const SIZES = { compact: '12px', normal: '13px', large: '14.5px' };
  const CUSTOM_VARS = ['--bg', '--surface', '--text', '--accent', '--live', '--accent-ink'];

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function applyThemeCfg(cfg) {
    cfg = cfg || {};
    const r = document.documentElement;
    CUSTOM_VARS.forEach((p) => r.style.removeProperty(p));
    r.dataset.palette = cfg.palette || 'pelouse';

    if (cfg.palette === 'custom' && cfg.custom) {
      const c = cfg.custom;
      r.style.setProperty('--bg', c.bg);
      r.style.setProperty('--surface', c.surface);
      r.style.setProperty('--text', c.text);
      r.style.setProperty('--accent', c.accent);
      r.style.setProperty('--live', c.live);
      r.style.setProperty('--accent-ink', luminance(c.accent) > 0.45 ? '#111111' : '#ffffff');
      // Le mode (clair/sombre) découle de la couleur de fond choisie.
      r.dataset.theme = luminance(c.bg) < 0.35 ? 'dark' : 'light';
    } else if (cfg.mode === 'light' || cfg.mode === 'dark') {
      r.dataset.theme = cfg.mode;
    } else {
      delete r.dataset.theme;
    }

    r.style.setProperty('--radius', `${Number.isFinite(+cfg.radius) ? +cfg.radius : 12}px`);
    r.style.setProperty('--fs', SIZES[cfg.size] || SIZES.normal);
    r.dataset.font = cfg.font || 'system';
    try {
      localStorage.setItem('themeCfg', JSON.stringify(cfg));
    } catch {
      /* stockage indisponible */
    }
  }

  window.applyThemeCfg = applyThemeCfg;
  try {
    const saved = JSON.parse(localStorage.getItem('themeCfg') || 'null');
    if (saved) applyThemeCfg(saved);
  } catch {
    /* rien à appliquer */
  }
})();
