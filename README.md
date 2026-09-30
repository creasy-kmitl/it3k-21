# IT3K

The staff portal for **IT·3·Kings**, the sports festival for information technology students from the three King Mongkut's institutes (KMUTT, KMUTNB and KMITL). Committee members sign in with Google to manage departments, department leadership and a shared department calendar. The UI is in Thai.

| Stage   | Web                               | API                                   |
| ------- | --------------------------------- | ------------------------------------- |
| prod    | https://it3k.creasy.club          | https://it3k-api.creasy.club          |
| staging | https://it3k-staging.creasy.club  | https://it3k-api-staging.creasy.club  |
| PR `n`  | `https://it3k-pr-<n>.creasy.club` | `https://it3k-api-pr-<n>.creasy.club` |

## Features

- **Google sign-in only.** Every new account starts as a `guest`.
- **Account roles.** The roles are `guest`, `athlete`, `staff` and `admin`. Only `staff` and `admin` can open the signed-in app under `/staff`. Guests and athletes are sent back to the home page.
- **Departments** (`/staff/departments`, admin only). Admins create, rename, recolour and delete departments and assign members to them. Sixteen departments are seeded, for example `ทะเบียน`, `Art` and `Tech/Live`.
- **Leadership** (`/staff/head`). Every department has _head_ and _vicehead_ seats. These are rows in the `leadership` table, not account roles. Admins and every member of `Tech/Live` or `ทะเบียน` are _managers_: they can fill any seat and move any account between departments. Other seat holders can edit only their own seat. Contact details are hidden until a member asks to reveal them, and every reveal is audited.
- **Users** (`/staff/users`, managers). Managers search accounts and assign each one as guest, athlete, staff, head or vicehead of a department. Only admins can grant or remove admin.
- **Calendar** (`/staff/calendar`, members only). Each department plans items in Bangkok time with the statuses `draft`, `confirmed` and `cancelled`. An item can name up to 20 collaborating departments, which see it on their calendar, but only the owning department (or an admin) can edit it. Every change goes into an append-only change log. People get in-app notifications when they are made an item's owner, when their department is added as a collaborator (the notice goes to that department's head and vicehead), and when an item is rescheduled or cancelled. Items can be added to Google, Apple or Microsoft calendars (`.ics`).

## Tech stack

| Area          | Tools                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Runtime       | Cloudflare Workers (web and API are separate workers), D1 (SQLite)                          |
| Web           | TanStack Start, React 19, TanStack Router and Query, Tailwind v4, shadcn/ui                 |
| API           | Hono, Zod validation, typed `hono/client` shared with the web app                           |
| Auth          | Better Auth with Google, the `admin` plugin and the `oAuthProxy` plugin                     |
| Database      | Drizzle ORM and drizzle-kit migrations                                                      |
| Infra         | Alchemy (one stack in `packages/infra/alchemy.run.ts`), GitHub Actions                      |
| Observability | evlog, drained to Axiom                                                                     |
| Tooling       | Bun 1.4.2 workspaces, Vite+ (`vp`: task runner, oxlint, formatter), Biome lint, Varlock env |

## Repository layout

```
apps/
  server/    Hono API worker: routes, middleware, authorization policies
  web/       TanStack Start worker: file routes in src/routes, staff app under /staff
packages/
  auth/      Better Auth factory and the role model (permissions.ts)
  db/        Drizzle schema, migrations and an in-memory D1 for tests
  ui/        Shared shadcn/ui primitives and global styles
  infra/     Alchemy stack: D1, both workers, hostnames, Axiom, PR comments
  config/    Shared tsconfig
```

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.4.2
- An Alchemy profile with Cloudflare and Axiom credentials. `bun run dev` also provisions the Axiom dataset for your stage.

  ```bash
  cd packages/infra && bunx alchemy profile edit
  ```

- A Google OAuth client whose redirect URIs include `http://localhost:3000/api/auth/callback/google`.

### Install

```bash
bun install --frozen-lockfile
```

`postinstall` runs Varlock codegen, which writes the typed `src/env.ts` for `apps/web`, `apps/server` and `packages/db`.

### Environment

Each workspace declares its variables in `.env.schema`. Put local values in an untracked `.env` next to the schema. The schema comments explain every variable.

- `apps/server/.env`: `BETTER_AUTH_SECRET` (at least 32 characters), `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET_ID` and `OAUTH_PROXY_SECRET` (at least 32 characters). The infra schema imports these values, so you set them only once.
- `packages/infra/.env`: `ALCHEMY_PASSWORD`, if your setup needs one.

`alchemy.run.ts` derives the remaining variables for each stage, so you never set them by hand: `BETTER_AUTH_URL`, `AUTH_PROXY_URL`, `AUTH_PREVIEW_ORIGINS`, `CORS_ORIGIN`, `VITE_SERVER_URL`, the `AXIOM_*` values and the deploy-stage variables. After you change a schema, run `bun run env:generate`.

### Run

```bash
bun run dev
```

This runs `alchemy dev`, which starts the web app on http://localhost:3001 and the API on http://localhost:3000 against a local D1 database, with every migration applied.

> Run only one `alchemy dev` at a time. A second one rewrites `VITE_SERVER_URL` to `:3002`.

### Becoming an admin

No code creates the first admin. Sign in once, then set `role` to `admin` on your row in the `user` table. Locally, run `bun run db:local:studio` to open Drizzle Studio on the dev database (run `bun run dev` at least once first). After that, admins can promote other accounts from `/staff/users`.

## Scripts

Run these from the repository root.

| Script                    | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| `bun run dev`             | Start both workers locally through `alchemy dev`                           |
| `bun run build`           | Build every workspace                                                      |
| `bun test`                | Run all tests                                                              |
| `bun run lint`            | Vite+ lint (oxlint)                                                        |
| `bun run lint:biome`      | Biome lint (its formatter is disabled)                                     |
| `bun run check-types`     | Type-check every workspace (`web` builds first to generate its route tree) |
| `bun run check`           | Format check, lint and type check                                          |
| `bun run format`          | Rewrite files with the Vite+ formatter                                     |
| `bun run staged`          | Run Vite+ checks on staged files                                           |
| `bun run hooks:setup`     | Install the Vite+ Git hooks                                                |
| `bun run db:generate`     | Generate a migration from `packages/db/src/schema`                         |
| `bun run db:local`        | Run drizzle-kit against the local dev D1                                   |
| `bun run db:local:studio` | Open Drizzle Studio on the local dev D1                                    |
| `bun run env:generate`    | Regenerate `src/env.ts` from the `.env.schema` files                       |
| `bun run deploy`          | Deploy with Alchemy (**changes real infrastructure**)                      |
| `bun run destroy`         | Destroy an Alchemy stage (**changes real infrastructure**)                 |

## Testing

```bash
bun test                                   # everything
bun test apps/server/src/routes/users      # one directory
bun test -t "reveal"                       # by test name
```

- The root `bunfig.toml` preloads `apps/web/src/test/dom.ts`, which installs jsdom globals before React loads, so every test file can render components.
- **Server tests** call `app.request(...)` against the real routers. `createTestContext()` in `apps/server/src/testing.ts` gives you `seedUser(id, { role, department, seat })`, and `as(userId, { method, json })` builds a request signed in as that user.
- **Database:** `packages/db/src/testing.ts` provides a D1 implementation backed by `bun:sqlite`. It applies every real migration, including the department seed. `hooks.beforeBatch` lets a test change data between a route's reads and its write batch, which is how the race-condition tests work.
- **Web tests** sit next to the code as `*.test.tsx`. The router ignores those files, so they never become routes. Helpers for Query, the router and fake APIs are in `apps/web/src/test/`.

CI does not run `bun test`, so run it before you push.

## Architecture

```
browser ─▶ web worker (TanStack Start)
              │  typed hono/client, credentials: "include"
              ▼
           API worker (Hono)  /api/auth/* ─▶ Better Auth
              │  /api/<resource> ─▶ requireUser ─▶ policy ─▶ D1 batch
              ▼
           D1 (Drizzle)
```

### API

`apps/server/src/index.ts` sets up evlog, CORS and Better Auth, then mounts one router per resource.

| Prefix             | Endpoints                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `/api/departments` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`, `PATCH /:id/code`, `PUT` and `DELETE /:id/members/:userId`           |
| `/api/users`       | `GET /me`, `GET /`, `PUT /:id/assignment`, `PUT /:id/admin`                                                                      |
| `/api/leadership`  | `GET /`, `GET /departments`, `GET /users`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/reveal`, `DELETE /:id`                 |
| `/api/calendar`    | `GET` and `POST /items`, `GET`, `PATCH` and `DELETE /items/:id`, `GET /people`, `GET /notifications`, `POST /notifications/read` |

Every router follows the same conventions:

- **Dependency seam.** Each router is a factory, `createXRoutes(deps)`, where `deps` is `{ getSession, getDb }`. Production passes in the Better Auth session and D1. Tests pass in a header-based fake session and the in-memory database.
- **Authorization is read from the database on every request.** `requireUser` (`src/middleware/current-user.ts`) loads the caller's role, department, seat and ban state fresh, and `requireMember` rejects guests and athletes. The rules themselves live in `src/policies/` (`leadership.ts`, `calendar.ts`).
- **CSRF.** Session cookies are `SameSite=None`, so `requireJsonPosts` rejects any POST that is not `application/json`.
- **Race-safe writes.** A route reads state, checks it, then writes everything in one `db.batch([...])`, which D1 runs as a single transaction. The batch starts with `abortUnless(db, userId, condition)`, which makes the whole batch fail if the caller's rights changed after the check. `constraintError()` turns that failure into a `"stale"` response. Calendar items also carry a `version` that every write increments, so an edit based on an old read is refused.
- **Validation.** `validate(target, zodSchema)` returns `400 { message, issues }` when the input is invalid.

### Web

- File routes are in `apps/web/src/routes`. `/staff` is a client-only layout (`ssr: false`) that sends non-members away.
- Each server router exports `type XRoutes`, and the web app imports that type by relative path to build a typed client (`src/lib/*.ts`). When a response shape changes, the web app's types follow.
- Pages get their API clients from `useApis()` (`src/lib/api-context.tsx`), so tests can supply fakes through `ApiProvider`.
- `clearCacheOnUserChange` clears the TanStack Query cache when the signed-in account changes, because cached flags such as `canEdit` belong to one user.

### Roles and permissions

`packages/auth/src/permissions.ts` defines the Better Auth access control. Roles are stored as a comma-separated string, so always read them through `parseRoles`, `hasRole`, `isMember` or `can`. Heads and viceheads get no Better Auth grants. Their rights come from their `leadership` seat, through the server's policies.

## Database and migrations

1. Edit the schema in `packages/db/src/schema/` (`auth`, `department`, `leadership`, `calendar`).
2. Run `bun run db:generate` to write a new migration folder in `packages/db/src/migrations/`.
3. Alchemy applies pending migrations on `alchemy dev` and on every deploy.

Never edit a migration after it has been generated. Your local `alchemy dev` has probably applied it already, and the deployed stages certainly have. Add a new migration instead.

## Environments and deployment

Only CI deploys shared stages (`.github/workflows/deploy.yml`):

| Trigger           | Stage     | Notes                                                                |
| ----------------- | --------- | -------------------------------------------------------------------- |
| Push to `prod`    | `prod`    | The default branch                                                   |
| Push to `main`    | `staging` | Also the Google sign-in relay for previews                           |
| Pull request `#n` | `pr-<n>`  | Destroyed when the PR closes, and a bot comment links to the preview |

- The deploy job runs `lint`, `lint:biome` and `check-types`, then `alchemy deploy`.
- Custom hostnames are assigned only in CI. A deploy from your laptop (`bun run deploy`) creates a personal stage on `workers.dev`.
- **Google sign-in on previews.** Google accepts only redirect URIs registered exactly, so `pr-*` stages sign in through staging using Better Auth's `oAuthProxy`. prod, staging and localhost each have their own registered URI, so the proxy does nothing for them. All environments run the same code. Do not gate features by stage.
- **State guard.** CI refuses to deploy `staging` or `prod` if that stage has no Alchemy state, because a fresh deploy would create a second D1 database next to the real one. To rebuild a stage on purpose, set the repository variable `ALLOW_FRESH_STAGE` to the stage name for one run, then delete it.
- **Preview cleanup.** `sweep-previews.yml` runs daily and can also be started by hand. It destroys preview stages whose PR has closed but that were not cleaned up.
- **Logs.** Each tier (prod or nonprod) has one Axiom dataset. Every event is tagged with its stage (`DEPLOY_ENV`), so you can tell `staging` and `pr-42` apart.

## Contributing

- Push work to `main`, which deploys `staging`. Changes reach `prod` only through a pull request from `main`.
- Commit messages use conventional commits with a scope, for example `feat(web): …`, `fix(api): …` or `chore(server): …`.
- Code uses double quotes and semicolons. Some older files still fail the formatter, so CI runs `lint` and `check-types` instead of `check`. Check the existing baseline before you blame a `bun run check` failure on your change.
- Never hand-edit generated files: `apps/web/src/routeTree.gen.ts` and each workspace's `src/env.ts`.

## UI components

Shared shadcn/ui primitives live in `packages/ui`.

- Design tokens and global styles: `packages/ui/src/styles/globals.css`
- Primitives: `packages/ui/src/components/*`
- shadcn config: `packages/ui/components.json` and `apps/web/components.json`

To add shared primitives, run this from the repository root:

```bash
npx shadcn@latest add accordion dialog popover -c packages/ui
```

```tsx
import { Button } from "@it3k/ui/components/button";
```

For blocks that only the web app uses, run the shadcn CLI from `apps/web` instead.
