# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

Run everything from the repo root with Bun (`bun@1.4.2`, lockfile `bun.lock`). Task running, lint and format go through Vite+ (`vp`).

- Install: `bun install --frozen-lockfile` (its `postinstall` runs Varlock codegen for `apps/web`, `apps/server` and `packages/db`)
- Dev: `bun run dev` runs `alchemy dev` in `packages/infra`, which starts both workers locally: web on `localhost:3001` and API on `localhost:3000`, with a local miniflare D1. Run only one `alchemy dev` at a time, because a second one rewrites `VITE_SERVER_URL` to `:3002`.
- Tests: `bun test` (all), `bun test apps/server/src/routes/users` (one directory), `bun test -t "pattern"` (by name). Root `bunfig.toml` preloads `apps/web/src/test/dom.ts` (jsdom globals) for every test file.
- Lint: `bun run lint` (Vite+/oxlint) and `bun run lint:biome` (Biome runs lint only; its formatter is disabled). CI runs both, plus `check-types`. CI does not run `bun test`, so run the tests yourself.
- Types: `bun run check-types` (per workspace; for `web` this runs `vp build` first so the route tree exists)
- `bun run check` runs `vp check` (format, lint) plus type checks. `bun run format` rewrites files. CI skips `check` because the formatter still fails on older files, so check the baseline before you attribute a failure to your change.
- DB: edit `packages/db/src/schema/*`, then `bun run db:generate` to write a migration into `packages/db/src/migrations/`. `bun run db:local:studio` opens Drizzle Studio on the local dev D1 (you must run `bun run dev` once first).
- Env: each of `apps/web`, `apps/server`, `packages/db` and `packages/infra` has its own `.env.schema`. After you edit one of the first three, run `bun run env:generate`. `packages/infra` has no codegen step: `alchemy.run.ts` loads its schema at runtime through `varlock/auto-load`. Never hand-edit the generated `src/env.ts` files or `apps/web/src/routeTree.gen.ts`.
- `bun run deploy` and `bun run destroy` change real Cloudflare/Axiom infrastructure. They are not verification steps.

Formatting is double quotes with semicolons. Commits use conventional style with a scope, for example `fix(api): …`, `feat(web): …`, `chore(server): …`.

## Architecture

Bun workspace monorepo. Everything runs on Cloudflare Workers and is provisioned by Alchemy.

- `apps/server`: Hono API worker. `src/index.ts` wires evlog (Axiom drain), CORS, and Better Auth at `/api/auth/*`, then mounts resource routers from `src/routes/<resource>/index.ts` under `/api/<resource>`.
- `apps/web`: TanStack Start (React 19, TanStack Router + Query) worker. File routes are in `src/routes`. Signed-in pages live under `/staff`, a client-only layout (`ssr: false`) that sends non-members away. The UI copy is in Thai.
- `packages/auth`: Better Auth factory (`createAuth(env, db)`) with Google sign-in only, the admin plugin and the oAuthProxy plugin. `permissions.ts` defines the account roles `guest` (default for new sign-ins), `athlete`, `staff` and `admin`. Roles are stored as a comma-separated string; use `parseRoles`, `hasRole` and `isMember`.
- `packages/db`: Drizzle over D1 (`createDb({ DB })`). Schema is in `src/schema/` (auth, department, leadership) and migrations are in `src/migrations/`. Alchemy applies the migrations on deploy.
- `packages/ui`: shared shadcn/ui primitives and global styles, imported as `@it3k/ui/components/<name>`. App-local imports in web use `@/…`.
- `packages/infra/alchemy.run.ts`: the one stack. It defines the D1 database, the server worker (bindings include `DB`, auth secrets, `CORS_ORIGIN`, Axiom), the web worker (`VITE_SERVER_URL`, `VITE_DEPLOY_ENV`), custom hostnames per stage and PR preview comments. Worker env types are inferred from this file (`apps/server/cloudflare-env.d.ts`), and server code reads bindings via `cloudflare:workers`.

### Server patterns

- **Dependency seam:** every router is a factory `createXRoutes(deps: RouteDeps)`, where `RouteDeps = { getSession, getDb }`. Production injects the Better Auth session and D1. Tests inject a header-based fake session and an in-memory DB.
- **Authorization is always read from the DB:** the `requireUser` middleware (`src/middleware/current-user.ts`) loads role, department, seat and ban state fresh on every request. `requireMember` blocks guests and athletes. `requireJsonPosts` is the CSRF guard: cookies are `SameSite=None`, so every POST must be `application/json`.
- **Leaders are seats, not roles:** "head" and "vicehead" come from a row in the `leadership` table, not from Better Auth roles. `src/policies/leadership.ts` decides who can do what: admins, and members of certain departments, act as managers; other seat holders can edit only their own seat.
- **Race-safe writes:** routes read state, then write in a single D1 `db.batch([...])`, which runs as one transaction. `abortUnless(db, userId, condition)` goes first in the batch and forces a `NOT NULL` failure on `user.role` if what the route read has changed since. `constraintError()` reports that failure as `"stale"`. Keep this pattern whenever a write depends on something the route read earlier.
- Validate input with `validate(target, zodSchema)` from `src/middleware/validation.ts`. It returns 400 as `{ message, issues }`.

### Web ↔ API

- Each router exports `type XRoutes = ReturnType<typeof createXRoutes>`. The web app imports that type by relative path and builds a typed `hono/client` (`src/lib/users.ts`, `src/lib/leadership.ts`) with `credentials: "include"`. If you change a route's response shape, the web types follow automatically.
- Pages get API clients through `useApis()` (`src/lib/api-context.tsx`), so tests can swap in fakes with `ApiProvider`.
- `clearCacheOnUserChange` clears the Query cache when the signed-in account changes, because cached data such as `canEdit` flags belongs to a specific user.

### Tests

- Server: `apps/server/src/testing.ts` `createTestContext()` provides `seedUser(id, { role, department, seat })` and `as(userId, { method, json })`, which you pass to `app.request(...)`. The DB comes from `packages/db/src/testing.ts`: a bun:sqlite-backed D1 implementation with every migration applied and seed departments (for example `Tech/Live`, `ทะเบียน`, `Art`). `hooks.beforeBatch` lets a test change data between a route's reads and its batch, which is how race conditions get tested.
- Web: component and route tests sit next to their files as `*.test.tsx`. The router ignores `\.test\.tsx?$`, so these are not treated as routes. Helpers are in `apps/web/src/test/`.

## Environments and deployment

- Branches: `prod` is the default branch and deploys to stage `prod`. Pushes to `main` deploy `staging`, and each PR deploys a `pr-<n>` preview that is destroyed when the PR closes (`sweep-previews.yml` catches leftovers). Push work to `main`; changes reach `prod` only through a PR.
- Hostnames (`it3k[-<stage>].creasy.club`, `it3k-api[-<stage>].creasy.club`) are assigned only in CI (`GITHUB_ACTIONS`). Local deploys stay on workers.dev.
- Google OAuth: previews sign in through staging via Better Auth `oAuthProxy`. prod, staging and localhost each own a registered redirect URI, so the proxy does nothing for them. Keep dev, staging and prod on the same code path instead of gating features by stage.
- CI refuses to deploy `staging` or `prod` if that stage has no Alchemy state, to avoid creating a duplicate D1 database. To rebuild a stage on purpose, set the repo variable `ALLOW_FRESH_STAGE` for one run.
