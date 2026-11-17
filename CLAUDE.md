# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A redesign prototype of TripShot, the shuttle tracker the University of Cincinnati uses. It is for a UI/UX course project ("If it is broke, fix it"). The full brief is in `REQUIREMENTS.md`. The constraints that affect the code:

- It must be written in **Svelte/SvelteKit and JavaScript**. Use JS with JSDoc types, not TypeScript files.
- It must be **publicly hosted** so graders can test it. It is hosted on GitHub Pages (see Deployment).
- **Live data comes from the proxy in `proxy/`** (see "Live data proxy"), not from mock data. The app is still fully static on GitHub Pages and only calls the proxy from the browser.
- Spend the effort on the core redesigned flows: a main page and one or two subpages. Skip login and settings pages unless they show a redesign goal.
- Deadlines: code is due Nov 16, documentation Nov 17, presentations Nov 18 and 20.

## Commands

```sh
npm run dev            # dev server (http://localhost:5173)
npm run build          # static build to build/
npm run preview        # serve the production build
npm run check          # svelte-check (JSDoc type checking)
npm run lint           # prettier --check + eslint
npm run format         # prettier --write
npm test               # vitest, single run
npx vitest run src/lib/foo.spec.js      # one test file
npx vitest run -t "name of test"        # tests matching a name
```

## Stack and structure

- SvelteKit 3 with Svelte 5 **runes mode**, which is forced for all project files (`$state`, `$derived`, `$props`; not `export let` or `$:`).
- There is **no `svelte.config.js`**. SvelteKit is configured inside `vite.config.js` through the `sveltekit({...})` plugin options: the adapter, `paths` and compiler options. The vitest config is in the same file.
- Import shared code with the `#lib` / `#lib/*` subpath imports defined in `package.json` (they map to `src/lib`).
- Tests live next to their source as `*.spec.js` / `*.test.js` under `src/` and run in the Node environment. `expect.requireAssertions` is on, so every test must assert something.
- **One responsive app, two layouts.** Below 900px is the phone design (bottom nav); 900px and up is the desktop design (top bar + sticky sidebar). The shell lives in `src/routes/+layout.svelte`; pages only render their content. Figma: page "Final design", phone frames 1–8 are drawn at 2× (halve their px), desktop frames 01–08 at 1×.
- Shared code in `src/lib`: `api.js` (proxy URL + `getJSON`), `departures.js` (pure, tested logic: distances, walk times, catchable buses, route badge labels, text color on route color), `here.svelte.js` (rider location; defaults to Langsam Library and only switches to real geolocation when it's within 3 km of campus, so the demo works from anywhere), `Icon.svelte` (Figma icons in `src/lib/assets/icons/`, placed at Figma's exact offsets), `route.js` (pure, tested: which bus to follow, stop list rows, trip segment of the route line), `RouteMap.svelte` (Leaflet map, also used for screen 2's trip preview; markers from `src/lib/assets/map/`), `trips.js` (pure, tested: trip planning, place search, walk-vs-ride choice), `places.json` (107 campus buildings, dorms, apartments, libraries and garages, pulled once from OpenStreetMap via Overpass; ODbL, so keep the "© OpenStreetMap contributors" credit; stops are added at runtime from `/stops`).
- **Service changes** (`serviceChanges.js`, pure and tested): TripShot only publishes closures as free-text alerts, so a closure is described in `SCENARIOS` and applied to live data (`applyServiceChange`): buses that would serve the closed stop serve the temporary stop at the same times, so departures, walks and the live route all follow automatically. Screen 1 and the route page activate one with `?scenario=<id>` (e.g. `/?scenario=mlk-closure` replays the Oct 7 MLK Dr alert, labeled as a replay); links carry the param along. `RouteMap`'s `closure` prop draws the closed road, closed stop and the arrow to the temporary stop.
- **Delays and leave-now alerts** (live route page, Figma frames 5 and 6): TripShot sets `riderStatus: "Delayed"` on nearly every bus, so it is **not** used. The page detects a delay itself, when the ETA for the followed bus at your stop slips 3+ min past the first ETA it saw. It then shows "Delayed N min", "ETA changed: a → b min" with a reason, "Alert moved to …", and "Still faster?" (wait vs. another route vs. walk via `planTrips`, only when the trip has a destination). `?delay=calhoun` (`DELAYS` in `serviceChanges.js`) replays a 5-min delay by pushing live ETAs back 8 s after load, so the same detection runs; the Alerts page links to it through search, which passes `delay` along. "Tell me when to leave" fires at ETA − (walk + 1) min as the "Leave now" card (On my way / Snooze 1 bus, which skips that bus and re-arms for the next); if the ETA slips after it fires, the alert re-arms for the new time.
- **My day** (Figma frames 9–11 / 09–11): the rider's classes, kept in localStorage only (`myDay.svelte.js`, loaded by the layout). `schedule.js` (pure, tested) does campus-time math (America/New_York), `upcoming` / `classesOn`, `planFor` (arrive-by planning: the latest bus that still gets you there `ARRIVE_EARLY_MIN` early, via `planTrips(…, arriveBy)`; classes more than `LIVE_HORIZON_MIN` ahead get "we'll plan it at …" plus today's typical trip time), `parseIcs` + `matchPlace` for .ics imports, and `sampleSchedule`. `NextClass.svelte` is the card on Running now (phone: under the search; desktop: replaces "Not sure which route?" once classes exist); its "Remind me" sets `day.reminder`, which the layout fires on any page. `MyDay.svelte` is the `/search/` landing before you type (timeline, Add a class as a bottom sheet / side panel, .ics import, sample schedule, saved trips).
- **Recommendation rule** (`WALK_MARGIN_MIN` = 5 in `trips.js`): saving under 5 minutes isn't worth extra walking or an extra shuttle. Walking is recommended only if it beats the best shuttle by 5+ min, and among shuttle trips (per route, per route pair, and across them) arriving within 5 min of the fastest, the easiest wins: least walking, counting a change of shuttle as `CHANGE_PENALTY_MIN` (5) min of walking.
- **Two-shuttle trips** (Figma frames 14–15 / 014–015): `planTrips` also builds trips with one change (`Trip.change`: where you change, the second route, its departure). The second bus must leave at least a minute (plus any walk between stops within `TRANSFER_M` = 200 m) after you get there and within `MAX_WAIT_MIN` = 20. Search links the first shuttle's live route with `to=<change stop>&then=<route>&thenStop=…&thenTo=…`; `connection.svelte.js` reads those on the live route and On board pages ("Then change to Southwest at Transit Row", the next bus, "See Southwest live"). On loop routes the destination reappears in a bus's upcoming stops after it passes, so On board and the friend's view treat "the boarding stop is ahead again after we saw the bus past it" as arrived (`tripProgress(…, rode)`; `rode.js` keeps it in sessionStorage so a reload at the stop doesn’t lose it).
- **Routes:** `/` Running now (screen 1); `/search/?to=<place name>` Search by destination (screen 2); `/route/?id=<routeId>&stop=<stopId>[&to=<stopId>]` Live route (screen 3; `stop` is optional and defaults to the route's stop nearest you; its back button returns to the previous in-app page via history, or `/` from a shared link); `/trip/?id=…&stop=…&to=…&bus=<vehicle name>[&place=…&after=<min>]` On board (screen 7): reached from the route page's "I’m on the bus" (shown only when the trip has a destination, i.e. it came from search, which adds `place` and the final walk `after`); follows that one bus via `tripProgress()` in `route.js` and fires the one-stop-before alert (vibrate + notification) only after the bus has left your boarding stop; "Save trip" keeps `{ to }` in localStorage (`savedTrips`), listed on `/search/` before you type. `/ride/?id=…&bus=…&stop=…&to=…&until=<epoch ms>[&name=…&place=…&after=…]` Share my ride, the friend's read-only view (screen 13): made by the On board page's **Share my ride** panel (Web Share API, falling back to copying the link; the optional name is remembered in localStorage). It follows the bus by name via `tripProgress` + `rideStatus` (`boarding`/`riding`/`arrived`/`lost`/`ended`) and never the rider's location; `until` is the expected arrival + 60 min. `RouteMap` takes `here={null}` for this view (no "you" marker or walk line). `/routes/` every route today, linking to its live route; `/alerts/` service changes (no live feed yet: TripShot alerts aren't proxied, so it offers the MLK replay) and how leave-now reminders work. The bottom nav / sidebar tabs are Now `/`, My trips `/search/`, Alerts `/alerts/`, Routes `/routes/`. The route page reads its query in `onMount` (the page is prerendered without one), so links use `` `${resolve('/route')}/?id=…` ``.
- **Map:** Leaflet 1.9 with OpenStreetMap tiles muted (`.muted-tiles` CSS grayscale, plus the tile layer's `opacity: 0.5` option; Leaflet writes opacity inline, so CSS opacity doesn't stick); attribution must stay visible. Leaflet is imported dynamically inside `onMount` so prerendering never touches `window`.
- **Color system** (tokens in `src/app.css`): buttons UC Black; route color only for route context (badges, route headers, map lines); UC red only for alerts/delays/closures; TripShot magenta only for the logo; route text color from `textOn()`.
- **NightRide theme** (Figma frame 4): `:root[data-theme='night']` in `src/app.css` overrides the same tokens (dark surfaces, amber `#ffb020` for buttons and "you" emphasis via `--accent`). An inline script in `src/app.html` sets it before first paint from 10 PM to 2 AM campus time; `?theme=night` / `?theme=day` preview either, and it sticks during in-app navigation. Use tokens, not hex, for anything that must flip (`--on-action` for button text, `--line-strong`, `--pill`, `--chip`, `--map-ink` for map lines). `Icon.svelte` draws icons as CSS masks in `currentColor`, so set an icon's color with `color`. Map markers and labels keep fixed colors in both themes.

## Deployment (GitHub Pages)

- `@sveltejs/adapter-static` turns the whole site into static files. `src/routes/+layout.js` sets `prerender = true` and `trailingSlash = 'always'` for every route.
- The site is served from `https://<user>.github.io/TripShot_Redesign/`. `.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo-name>`, and `vite.config.js` reads that into `paths.base`. Locally, `BASE_PATH` is unset and the base is `''`.
  - **Every internal link and asset URL must go through `resolve()` / `asset()` from `$app/paths`.** A hardcoded `/stops` will break on Pages.
  - To test the Pages build locally: `BASE_PATH=/TripShot_Redesign npm run build && npm run preview`.
- `fallback: '404.html'` serves the SPA shell for unknown paths. A route with dynamic params (for example `/route/[id]`) must either be reachable through links from prerendered pages or list its params with `entries()`. Otherwise prerendering skips it.
- Every push to `main` deploys. One-time setup: in the repo, go to Settings → Pages → Source and choose "GitHub Actions".

## Live data proxy (`proxy/`)

UC's TripShot API (`uc.tripshot.com`) needs a login and sends no CORS headers, so the browser can't call it directly. `proxy/` is a Cloudflare Worker that logs in with the `TRIPSHOT_USER` / `TRIPSHOT_PASSWORD` secrets and serves trimmed, cached, read-only JSON at `https://tripshot-proxy.tripshot-proxy.workers.dev`:

| Endpoint               | Returns                                                                                                                    | Cache |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- |
| `GET /live`            | `{ at, routes: [{ id, name, color, headwaySec, stopIds, vehicles }] }`: every route today, one call (used by Running now)  | 10 s  |
| `GET /routes`          | `[{ id, name, color }]` for today                                                                                          | 5 min |
| `GET /stops`           | `[{ id, name, loc: [lat, lng] }]`                                                                                          | 1 h   |
| `GET /routes/:id`      | `{ id, name, color, headwaySec, stops: [{ id, name, loc }], path: [[lat, lng], ...] }`                                     | 5 min |
| `GET /routes/:id/live` | `{ at, vehicles: [{ name, loc, bearing, speed, seen, capacity, occupancy, next: [{ stopId, eta, scheduled, status }] }] }` | 10 s  |

- Run it with `cd proxy && npm run dev` (port 8787; reads secrets from the gitignored `proxy/.dev.vars`). Deploy with `npm run deploy`.
- **Keep it an allow-list.** Never add a pass-through to arbitrary upstream paths: the session belongs to a real user account, and a pass-through would let anyone act as that user.
- **Never return internal fields.** Upstream live data includes `driverId`, `shiftId`, `deviceId` and ride histories. Map responses to only what the UI needs.
- Allowed CORS origins are listed in `ALLOWED_ORIGINS` in `proxy/src/index.js`. Add a port there if you run the app on a new one.
- Upstream auth: `POST /v1/webLogin` with `{ username, password }` returns `{ token, sessionId, expiresIn }`. Every call needs `Authorization: Bearer <token>` **and** `x-session-id: <sessionId>`. Sessions last 24 h.

## Notes

- `REQUIREMENTS.md` is listed in `.prettierignore` so the course text keeps its original formatting. Don't reformat it.
