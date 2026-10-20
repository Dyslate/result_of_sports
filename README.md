# Today's Scores (Scores du jour)

A Chrome extension that shows today's results in one click: live football, Formula 1 and GT3. Click the toolbar icon for a compact popup, or hit **Open web page** for a full-screen dashboard with inline video highlights. Everything runs locally inside the extension: no server, no account.

Available in **English** and **French** (follows Chrome's language, or switch with the flag).

<p align="center">
  <img src="docs/popup-fr.png" width="250" alt="Popup, French, light theme">
  <img src="docs/popup-en-dark.png" width="250" alt="Popup, English, dark theme">
  <img src="docs/popup-settings.png" width="250" alt="Settings">
</p>

<p align="center">
  <img src="docs/page-dark.png" width="820" alt="Full-screen dashboard, dark theme">
</p>

<p align="center">
  <img src="docs/page-week.png" width="820" alt="Week view">
</p>

<p align="center">
  <img src="docs/page-video.png" width="405" alt="Inline video highlights">
  <img src="docs/page-standings.png" width="405" alt="League table">
</p>

<sub>Screenshots taken with demo data.</sub>

## Features

**Football**
- Live, finished and upcoming matches for Ligue 1, Ligue 2, Coupe de France, Champions League, Europa League, Conference League, Premier League, LaLiga, Serie A, Bundesliga (more can be enabled)
- Match minute, half-time, extra time, penalty shoot-outs
- Click a match for scorers, penalties, red cards and venue
- Browse other days, search for a team, "Live only" filter
- League tables with qualification and relegation zones
- Favourite teams are highlighted (★) and can be followed from any match

**Formula 1**
- Current (or last) Grand Prix weekend with every session
- Classification for each session (practice, qualifying, sprint, race), live during the session
- Next Grand Prix with a countdown
- Drivers' championship

**GT3**
- Race of the day, last and next event (GT World Challenge Europe, British GT, or any TheSportsDB championship by ID)

**Full-screen page** ("Open web page" button, or <kbd>W</kbd> in the popup)
- Football, F1 and GT3 side by side, with live / today / F1 / GT3 summary tiles
- **Day / Week / Month / custom range** for football (up to 62 days), grouped by day
- **Inline highlights**: the Highlights button plays the first YouTube result for the match right in the page, with the next results as alternatives
- League tables in a dialog, responsive down to phone width
- Stays in sync with the popup settings (theme, language, competitions, favourites)

**Everywhere**
- Highlights button for every finished match, F1 session and GT3 race
- Add a match or a Grand Prix to Google Calendar
- **Notifications** for kick-off, goals and full time (favourites only, all matches, or off)
- **Badge** on the toolbar icon with the number of live events
- Auto-refresh every 30 s while something is live

## Themes

- **Auto / Light / Dark** mode
- 8 palettes: Pitch, Ocean, Sunset, Neon, Paddock, Midnight, Sand, Graphite
- **Custom theme**: background, card, text, accent and live colours; font (5 styles), text size, corner radius
- Share a theme: "Copy theme code", then "Import" on another browser

## Keyboard shortcuts

| Key | Popup | Page |
|---|---|---|
| `1` `2` `3` | Football / F1 / GT3 tab | — |
| `←` `→` | Previous / next day | Previous / next period |
| `D` `S` `M` | — | Day / week / month view |
| `/` | Search for a team | Search for a team |
| `R` | Refresh | Refresh |
| `T` | Cycle light / dark mode | Cycle light / dark mode |
| `L` | Switch language | Switch language |
| `W` | Open the web page | — |
| `Esc` | Close a panel | Close a dialog |

## Installation

1. Download the repository (**Code → Download ZIP**) and unzip it, or clone it:
   ```
   git clone https://github.com/Dyslate/result_of_sports.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `result_of_sports` folder.
5. Pin the extension (puzzle icon → pin) and click it.

Requires Chrome 123 or later.

## Data sources

| Sport | Source | Content |
|---|---|---|
| Football | ESPN public API (`site.api.espn.com`) | scores, scorers, tables |
| Formula 1 | ESPN public API | sessions, classifications, championship |
| GT3 | [TheSportsDB](https://www.thesportsdb.com) (free key) | calendar |
| Highlights | YouTube search results page | first videos for a search |

None of these require an API key, but they are not officially documented and may change.

To stay polite with these APIs, responses are cached in `chrome.storage.session`, shared by the popup, the page and the background worker (cleared when the browser closes): 30 s when the period includes today, 6 h for past days, 15 min for future fixtures, 10 min for tables, 1 h for the GT3 calendar and video searches. Requests are limited to 4 at a time and retried on errors; the refresh button bypasses the cache.

If ESPN answers 403 or 429 (it throttles an IP that sends too many requests), the extension stops calling it for 2 minutes, then 4, 8, 16 and 30 minutes if the block persists, shows when it will try again, and serves cached data meanwhile. Background polling also adapts: every minute while something is live, every 2 minutes just before a kick-off, every 10 minutes otherwise. No free source publishes live GT3 race results, so the GT3 section is limited to the calendar.

Inline highlights rely on YouTube embeds. YouTube refuses to play inside pages that aren't a regular http(s) website (error 153), and extension pages are `chrome-extension://`. The extension therefore embeds a tiny relay page, [`docs/player.html`](docs/player.html), published with GitHub Pages at `https://dyslate.github.io/result_of_sports/player.html`, which embeds the player itself. If you fork the project, enable GitHub Pages on the `docs/` folder and update `PLAYER_RELAY` in `src/config.js`. Some broadcasters also disable embedding on their videos: use **Pop-out** (small Chrome window) or **Watch on YouTube** in that case. If you have never accepted YouTube's cookie banner in Chrome, the search may be blocked by the consent page; open youtube.com once to accept it.

## Tests

An automated suite (36 tests) loads the real extension in Chromium with simulated ESPN, TheSportsDB and YouTube responses, so it runs offline and never stresses the real APIs.

```
npm install
npx playwright install chromium
npm test
```

It covers the data layer (statuses, date ranges fetched day by day on match days only, cache, ESPN 403 back-off, malformed data), translations (same keys and placeholders in both languages), the popup (tabs, day navigation, search, live filter, F1 sessions, GT3, tables, language flag, themes, favourites, "Open web page"), the full-screen page (day / week / month / custom range, fast switching between them, inline highlights through the relay, tables, phone width) and the background worker (badge, goal and full-time notifications, adaptive polling). Screenshots are saved to `test-results/`.

## Project structure

```
manifest.json          Manifest V3 (name and description localised via _locales/)
popup.html / popup.js  Toolbar popup
page.html / page.js    Full-screen dashboard
page.css               Dashboard layout
app.css                Shared theme and components
theme-init.js          Applies the theme before first paint
background.js          Service worker: badge and notifications
src/api.js             API calls and data normalisation
src/render.js          Shared HTML rendering (popup + page)
src/i18n.js            English / French strings
src/embed.js           Referer rule for YouTube embeds + pop-out window
src/config.js          Competitions, palettes and default settings
icons/                 Extension icons
docs/                  README screenshots, YouTube relay page (player.html)
tests/                 Automated tests (node --test + Playwright)
```

## License

MIT
