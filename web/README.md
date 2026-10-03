# WattsMyPower web app

The dashboard UI: React 19, [TanStack Start](https://tanstack.com/start) in SPA mode, TanStack Router (file-based routes),
TanStack Query, and Tailwind CSS v4. `npm run build` writes static files to `dist/client/`, which the FastAPI backend
serves; there is no Node server in production.

## Develop

```bash
cd web
npm install
echo "API_TARGET=http://127.0.0.1:8080" > .env.local   # a running backend: local, mock, or your live server
npm run dev                                           # http://localhost:5174, /api proxied to API_TARGET
```

To run without an inverter, start the backend in mock mode from the repo root:
`MOCK=1 DB_PATH=/tmp/mock.db uvicorn app.main:app --port 8080`.

| Script              |                                       |
| ------------------- | ------------------------------------- |
| `npm run dev`       | dev server with hot reload            |
| `npm run build`     | production build to `dist/client/`    |
| `npm run typecheck` | `tsc --noEmit`                        |
| `npm run lint`      | ESLint                                |
| `npm run format`    | Prettier (sorts Tailwind classes too) |

## Layout

```
src/
  routes/                  file-based routes: thin files that set the title, search params and page component
    __root.tsx             html shell, fonts, providers
    login.tsx              sign-in / first-run account setup
    _app.tsx               every dashboard page: sign-in guard, live updates, top bar, dock
    _app/…                 one file per page
  features/
    <feature>/             one module per page or capability (overview, history, forecast, insights,
      components/          savings, tesla, settings, alerts, auth): everything it needs lives here, so
      hooks/               deleting the folder (and its route) removes the feature
      api/                 query options for its endpoints
      types/               its API response types
      utils/               pure helpers
    common/<area>/         shared by several features, organised the same way:
                           ui (design system), layout (app shell), live (inverter stream), api (fetch client),
                           tariffs, weather, readings, plans, settings, energy, formatting, time, storage
  styles/app.css           Tailwind import, design tokens (@theme), keyframes
```

Inside a feature, a folder holding a single module uses `index.ts` for it (`utils/index.ts`,
imported as `~/features/savings/utils`); with several, each file is named and imported by its own
path (`~/features/common/formatting/utils/date`). There are no barrel files that only re-export.

## Conventions

- **Data** comes from TanStack Query. Each feature defines query options for its endpoints in its `api/` folder
  (`useQuery(insightsQuery)`), and writes go through mutation hooks in `hooks/`; components never call `fetch`.
  Requests use the client in `common/api/utils`.
- **Live readings** arrive over `/api/stream` and are written into the `["live"]` query by `LiveProvider`. Read them
  with `useSnapshot()` / `useSystem()` from `common/live/hooks`. Queries whose key starts with `POLL` refetch on every new reading (use this for
  anything showing "today so far").
- **Styling** uses Tailwind utilities and the tokens in `styles/app.css` (`bg-surface`, `text-ink-muted`,
  `border-line-subtle`, `text-solar`, `bg-battery`…). Responsive rules are desktop-first, matching the original layout:
  `max-sm:` (< 640 px), `max-md:` (< 760 px), `max-lg:` (< 900 px). Reach for a shared component before repeating a
  long class list. `cn()` merges classes with tailwind-merge, so a `className` passed to a component overrides its defaults.
- **Charts** are hand-drawn SVG with `viewBox` + `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"`,
  with HTML overlays for labels, markers and tooltips (`common/ui/components/ChartHover.tsx`).
- **Copy** is Australian English, sentence case, with no trailing full stop on labels. Times are 24-hour.
- Times are unix seconds; power from the API is in watts, energy in kWh, money in AUD.
- **Sign-in** is enforced by the backend on every `/api` route; the `_app` route's `beforeLoad` sends signed-out
  browsers to `/login`, and any 401 later (an expired session) does the same.
