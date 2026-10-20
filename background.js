// Service worker: "live" badge on the toolbar icon + goal notifications.
import { fetchFootball, fetchF1, getCooldown } from './src/api.js';
import { loadSettings, isFavTeam, FOOT_LEAGUES, refreshMinutes } from './src/config.js';
import { t, setLang, localName } from './src/i18n.js';
import { ensureEmbedReferer } from './src/embed.js';

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
      // Keep only the 30 most recent links.
      const keys = Object.keys(notifLinks);
      for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete notifLinks[k];
      await chrome.storage.local.set({ notifLinks });
    }
  } catch {
    /* notifications blocked by the user */
  }
}

/** Compares scores with the previous snapshot and fires kick-off / goal / full-time alerts. */
async function checkGoals(leagues, s) {
  const { snap = {} } = await chrome.storage.local.get('snap');
  const next = {};
  const first = Object.keys(snap).length === 0;

  for (const raw of leagues) {
    const lgName = localName(FOOT_LEAGUES.find((l) => l.id === raw.id)) || raw.name;
    for (const ev of raw.events) {
      const cur = { h: ev.home.score, a: ev.away.score, st: ev.status.state };
      next[ev.id] = cur;
      const prev = snap[ev.id];
      if (first || !prev || !shouldNotify(ev, s)) continue;

      const score = `${ev.home.name} ${cur.h} – ${cur.a} ${ev.away.name}`;
      const goals = (Number(cur.h) || 0) + (Number(cur.a) || 0);
      const prevGoals = (Number(prev.h) || 0) + (Number(prev.a) || 0);

      if (prev.st === 'pre' && cur.st === 'in') {
        await notify(`ko-${ev.id}`, t('notif.kickoff', { lg: lgName }), `${ev.home.name} – ${ev.away.name}`, ev.link);
      }
      if (goals > prevGoals) {
        const last = [...ev.details].reverse().find((d) => d.kind !== 'red');
        const who = last ? `${last.player} ${last.minute}`.trim() : '';
        await notify(`goal-${ev.id}-${goals}`, t('notif.goal', { score }), `${who}${who ? ' · ' : ''}${lgName}`, ev.link);
      }
      if (prev.st === 'in' && cur.st === 'post') {
        await notify(`ft-${ev.id}`, t('notif.ft', { lg: lgName }), `${score} (${t(`st.${ev.status.code || 'ft'}`)})`, ev.link);
      }
    }
  }
  await chrome.storage.local.set({ snap: next });
}

/**
 * Checks scores, updates the badge, then schedules the next check according to the
 * "Automatic refresh" setting (src/config.js REFRESH): the "live" pace while a match or
 * session is live or about to start, the "idle" pace otherwise, nothing when it's manual,
 * and nothing while ESPN is throttling us.
 */
async function tick() {
  const s = await loadSettings();
  setLang(s.lang);
  let live = 0;
  let soon = false;
  try {
    const foot = await fetchFootball(new Date(), s.footLeagues);
    const now = Date.now();
    for (const lg of foot.leagues) {
      live += lg.events.filter((e) => e.status.live).length;
      if (lg.events.some((e) => e.status.state === 'pre' && new Date(e.date) - now < 20 * 60000 && new Date(e.date) > now - 5 * 60000)) soon = true;
    }
    await checkGoals(foot.leagues, s);
  } catch {
    /* offline */
  }
  try {
    const f1 = await fetchF1();
    if (f1.current?.sessions.some((x) => x.state === 'in')) live += 1;
  } catch {
    /* offline or throttled */
  }
  const show = s.badge && live > 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#e5322d' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: show ? String(live) : '' });
  await chrome.action.setTitle({ title: live > 0 ? t('badge.title', { app: t('app.title'), n: live }) : t('app.title') });

  const blocked = await getCooldown();
  const every = refreshMinutes(s.refresh, live > 0 || soon);
  if (every == null) {
    await chrome.alarms.clear(ALARM); // manual mode: only the refresh button updates things
    return;
  }
  const delay = blocked ? Math.max(every, (blocked - Date.now()) / 60000 + 0.5) : every;
  chrome.alarms.create(ALARM, { delayInMinutes: delay });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureEmbedReferer();
  tick();
});
chrome.runtime.onStartup.addListener(() => tick());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) tick();
});

// Debounced: ticking several boxes in the settings must not fire a full refresh per click.
let changeTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !(changes.badge || changes.footLeagues || changes.lang || changes.refresh)) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(tick, 4000);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'refresh-badge') tick();
});

chrome.notifications.onClicked.addListener(async (id) => {
  const { notifLinks = {} } = await chrome.storage.local.get('notifLinks');
  if (notifLinks[id]) chrome.tabs.create({ url: notifLinks[id] });
  chrome.notifications.clear(id);
});
