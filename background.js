// Service worker : badge "en direct" sur l'icône + notifications de but.
import { fetchFootball, fetchF1 } from './src/api.js';
import { loadSettings, isFavTeam, FOOT_LEAGUES } from './src/config.js';

const ALARM = 'refresh';

function shouldNotify(ev, s) {
  if (s.notify === 'off') return false;
  if (s.notify === 'all') return true;
  return isFavTeam(ev.home, s.favorites) || isFavTeam(ev.away, s.favorites);
}

async function notify(id, title, message, link) {
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 1,
    });
    if (link) {
      const { notifLinks = {} } = await chrome.storage.local.get('notifLinks');
      notifLinks[id] = link;
      // On ne garde que les 30 dernières.
      const keys = Object.keys(notifLinks);
      for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete notifLinks[k];
      await chrome.storage.local.set({ notifLinks });
    }
  } catch {
    /* permission refusée */
  }
}

async function checkGoals(leagues, s) {
  const { snap = {} } = await chrome.storage.local.get('snap');
  const next = {};
  const first = Object.keys(snap).length === 0;

  for (const raw of leagues) {
    const lg = { ...raw, name: FOOT_LEAGUES.find((l) => l.id === raw.id)?.name ?? raw.name };
    for (const ev of lg.events) {
      const cur = { h: ev.home.score, a: ev.away.score, st: ev.status.state };
      next[ev.id] = cur;
      const prev = snap[ev.id];
      if (first || !prev || !shouldNotify(ev, s)) continue;

      const score = `${ev.home.name} ${cur.h} – ${cur.a} ${ev.away.name}`;
      const goals = (Number(cur.h) || 0) + (Number(cur.a) || 0);
      const prevGoals = (Number(prev.h) || 0) + (Number(prev.a) || 0);

      if (prev.st === 'pre' && cur.st === 'in') {
        await notify(`ko-${ev.id}`, `Coup d'envoi · ${lg.name}`, `${ev.home.name} – ${ev.away.name}`, ev.link);
      }
      if (goals > prevGoals) {
        const last = [...ev.details].reverse().find((d) => d.kind !== 'red');
        const who = last ? `${last.player} ${last.minute}`.trim() : '';
        await notify(`goal-${ev.id}-${goals}`, `⚽ But ! ${score}`, `${who}${who ? ' · ' : ''}${lg.name}`, ev.link);
      }
      if (prev.st === 'in' && cur.st === 'post') {
        await notify(`ft-${ev.id}`, `Fin du match · ${lg.name}`, `${score} (${ev.status.label})`, ev.link);
      }
    }
  }
  await chrome.storage.local.set({ snap: next });
}

async function tick() {
  const s = await loadSettings();
  let live = 0;
  try {
    const foot = await fetchFootball(new Date(), s.footLeagues);
    for (const lg of foot.leagues) live += lg.events.filter((e) => e.status.live).length;
    await checkGoals(foot.leagues, s);
  } catch {
    /* réseau indisponible */
  }
  try {
    const f1 = await fetchF1();
    if (f1.current?.sessions.some((x) => x.state === 'in')) live += 1;
  } catch {
    /* idem */
  }
  const show = s.badge && live > 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#e5322d' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: show ? String(live) : '' });
  await chrome.action.setTitle({ title: live > 0 ? `Scores du jour · ${live} en direct` : 'Scores du jour' });
}

function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); tick(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); tick(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.badge || changes.footLeagues)) tick();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'refresh-badge') tick();
});

chrome.notifications.onClicked.addListener(async (id) => {
  const { notifLinks = {} } = await chrome.storage.local.get('notifLinks');
  if (notifLinks[id]) chrome.tabs.create({ url: notifLinks[id] });
  chrome.notifications.clear(id);
});
