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
