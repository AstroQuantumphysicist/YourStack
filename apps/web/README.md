# @yourstack/web

The YourStack web dashboard — a Next.js (App Router) control-plane UI for the
"bring your own server" cloud platform.

> Bring your own server. We turn it into a cloud.

## Stack

- **Next.js 14** (App Router, standalone output for Docker)
- **TypeScript** (strict), consuming `@yourstack/shared` as source
- **Tailwind CSS v3** (class-based dark mode, dark-first) with hand-built UI kit
- **SWR** for client-side data fetching
- **lucide-react** icons, **class-variance-authority** + **tailwind-merge** for components
- Realtime via **Server-Sent Events** (`EventSource`)

## Getting started

```bash
# from the monorepo root
pnpm install
cp apps/web/.env.example apps/web/.env.local   # adjust NEXT_PUBLIC_API_URL if needed

# run the API (port 4000) and the web app (port 3000)
pnpm --filter @yourstack/api dev
pnpm --filter @yourstack/web dev
```

Open http://localhost:3000. Use **dev sign-in** (email) locally, or **Continue
with GitHub** when GitHub OAuth is configured on the API.

## Scripts

| Script      | Description                                  |
| ----------- | -------------------------------------------- |
| `dev`       | `next dev` on port 3000                       |
| `build`     | `next build` (type-checks **and** lints)      |
| `start`     | `next start` on `$PORT` (default 3000)        |
| `typecheck` | `tsc --noEmit`                                |
| `lint`      | `next lint`                                   |
| `clean`     | remove `.next` / caches                       |

## Environment

| Variable              | Default                 | Purpose                                  |
| --------------------- | ----------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL of the control-plane API (`/v1`) |
| `PORT`                | `3000`                  | Port for `next start`                     |

## Authentication & cookies

Auth is a **cookie session** issued by the API. Every request the client makes
uses `credentials: 'include'`.

- **Local:** web (`:3000`) → API (`:4000`) is same-site, so the API's `Lax`
  session cookie is sent automatically.
- **Production:** the API and web must share a registrable domain
  (e.g. `app.yourstack.com` + `api.yourstack.com`) and the API must set
  `SESSION_COOKIE_DOMAIN=.yourstack.com` so the cookie is shared. Otherwise the
  browser will not attach the session cookie to cross-site API calls.

A `401` from the API automatically redirects the browser to `/login`.

## Data fetching strategy

All authenticated data fetching happens **client-side** (client components +
SWR), so `next build` never needs a running API. Only `/` (landing) and
`/login` are mostly-static. The typed API client lives in `src/lib/api.ts` and
the SSE hook in `src/lib/use-sse.ts`.

## Realtime

Live logs and status use SSE channels exposed by the API:

- `app:<id>` — runtime logs, deployment status
- `deployment:<id>` — build/deploy logs, pipeline status
- `node:<id>` — heartbeats, node status
- `workspace:<id>` — fleet-wide node events

## `public/install.sh`

A small POSIX bootstrap the API references as `${PUBLIC_WEB_URL}/install.sh`.
It validates `YOURSTACK_API_URL` + `YOURSTACK_JOIN_TOKEN`, downloads the agent
installer, and runs it to register the node. The "Join a node" modal renders the
exact one-line command.

## Project layout

```
src/
  app/                     App Router routes
    page.tsx               Landing
    login/                 Sign-in (dev email + GitHub)
    dashboard/             Authenticated app (client-rendered)
      apps/ nodes/ deployments/ cicd/ secrets/ domains/ settings/ admin/
  components/
    ui/                    Hand-built component library
    dashboard/             Dashboard-specific composites
  lib/
    api.ts                 Typed fetch client (throws ApiError, 401 → /login)
    use-sse.ts             EventSource hook
    session.tsx            Auth + workspace context
    hooks.ts               Composed SWR data hooks
```
