// Récupération et normalisation des données (ESPN pour foot/F1, TheSportsDB pour GT3).

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';

async function getJSON(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
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
  let label = '';
  if (state === 'pre') {
    if (name === 'STATUS_POSTPONED') label = 'Reporté';
    else if (name === 'STATUS_CANCELED') label = 'Annulé';
    else if (name === 'STATUS_DELAYED') label = 'Retardé';
  } else if (state === 'in') {
    if (name === 'STATUS_HALFTIME') label = 'Mi\u2011temps';
    else if (name === 'STATUS_SHOOTOUT') label = 'T.a.b.';
    else if (name === 'STATUS_END_OF_REGULATION') label = 'Fin 90\'';
    else if (name === 'STATUS_END_OF_EXTRATIME') label = 'Fin prol.';
    else label = status?.displayClock && status.displayClock !== "0'" ? status.displayClock : 'En cours';
  } else {
    if (name === 'STATUS_FINAL_AET') label = 'Terminé a.p.';
    else if (name === 'STATUS_FINAL_PEN') label = 'Terminé t.a.b.';
    else if (name === 'STATUS_ABANDONED') label = 'Arrêté';
    else if (name === 'STATUS_POSTPONED') label = 'Reporté';
    else if (name === 'STATUS_CANCELED') label = 'Annulé';
    else label = 'Terminé';
  }
  // Un match reporté / annulé ne doit pas compter comme "en direct".
  const live = state === 'in';
  return { state, live, label, name };
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

/** Matchs d'une date pour une liste de compétitions. */
export async function fetchFootball(date, leagueIds) {
  const day = ymd(date);
  const results = await Promise.allSettled(
    leagueIds.map((id) => getJSON(`${ESPN}/soccer/${id}/scoreboard?dates=${day}`))
  );
  const leagues = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      errors.push(leagueIds[i]);
      return;
    }
    const data = r.value;
    const events = (data.events ?? []).map(normalizeFootEvent);
    if (!events.length) return;
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    const lg = data.leagues?.[0] ?? {};
    leagues.push({
      id: leagueIds[i],
      name: lg.name || lg.abbreviation || leagueIds[i],
      logo: lg.logos?.[0]?.href ?? '',
      events,
    });
  });
  return { leagues, errors, failedAll: errors.length === leagueIds.length && leagueIds.length > 0 };
}

/* ---------------------------------------------------------------- F1 */

const SESSION_NAMES = {
  FP1: 'Essais libres 1',
  FP2: 'Essais libres 2',
  FP3: 'Essais libres 3',
  Qual: 'Qualifications',
  SS: 'Qualif. sprint',
  SQ: 'Qualif. sprint',
  Sprint: 'Sprint',
  SR: 'Sprint',
  Race: 'Course',
};

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
    name: SESSION_NAMES[abbr] ?? abbr,
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

/** Week-end en cours (ou dernier GP) + prochain GP. */
export async function fetchF1(now = new Date()) {
  const base = await getJSON(`${ESPN}/racing/f1/scoreboard`);
  const calendar = (base.leagues?.[0]?.calendar ?? []).map((c) => ({
    name: c.label,
    start: c.startDate,
    end: c.endDate,
    id: eventIdFromRef(c.event?.$ref),
  }));
  let current = base.events?.[0] ? normalizeF1Event(base.events[0]) : null;

  // Si un GP se déroule aujourd'hui (± 1 jour) et que ce n'est pas celui renvoyé, on le charge.
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
      /* on garde le précédent */
    }
  }

  const next = calendar.find((c) => new Date(c.start) > now && (!current || c.id !== current.id)) ?? null;
  const round = current ? calendar.findIndex((c) => c.id === current.id) + 1 : 0;
  return { current, next, round, total: calendar.length };
}

/* ---------------------------------------------------------------- Classements */

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

/** Classement d'une compétition de foot (gère les groupes). */
export async function fetchStandings(leagueId) {
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

/** Championnat F1 : pilotes (et constructeurs si fournis). */
export async function fetchF1Standings() {
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

/* ---------------------------------------------------------------- GT3 */

function gtEvent(e) {
  if (!e) return null;
  return {
    id: e.idEvent,
    name: e.strEvent,
    date: e.dateEvent, // AAAA-MM-JJ
    time: e.strTime && e.strTime !== '00:00:00' ? e.strTimestamp : null,
    venue: e.strVenue ?? '',
    country: e.strCountry ?? '',
    season: e.strSeason ?? '',
    league: e.strLeague ?? '',
    status: e.strStatus ?? '',
  };
}

/** Dernière et prochaine épreuve de chaque championnat GT. */
export async function fetchGT(leagues) {
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
