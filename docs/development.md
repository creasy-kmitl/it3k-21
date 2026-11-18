# Developer guide

Setup, architecture, testing and deployment notes for IT3K contributors. For a project overview, see the [README](../README.md).

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.4.2
- An Alchemy profile with Cloudflare credentials. Axiom is optional for local development.

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

- `apps/server/.env`: `BETTER_AUTH_SECRET` (at least 32 characters), `GOOGLE_CLIENT_ID` and `GOOGLE_SECRET_ID`. `OAUTH_PROXY_SECRET` (at least 32 characters) is optional for `alchemy dev`; omitting it disables the proxy and uses the registered localhost Google callback directly. Deployments require it. The infra schema imports these values, so you set them only once.
- `packages/infra/.env`: `ALCHEMY_PASSWORD`, if your setup needs one. Axiom is disabled by default during `alchemy dev`, so no Axiom account or credentials are required and logs stay in the terminal. Set `AXIOM_DEV_ENABLED=true` and configure Axiom credentials in your Alchemy profile to provision a dataset/token and send local logs to Axiom. Deployments always enable Axiom and require its credentials.

`alchemy.run.ts` derives the remaining variables for each stage, so you never set them by hand: `BETTER_AUTH_URL`, `AUTH_PROXY_URL`, `AUTH_PREVIEW_ORIGINS`, `CORS_ORIGIN`, `VITE_SERVER_URL`, the `AXIOM_*` values and the deploy-stage variables. After you change a schema, run `bun run env:generate`.

### Run

```bash
bun run dev
```

This runs `alchemy dev`, which starts the web app on http://localhost:3001 and the API on http://localhost:3000 against a local D1 database, with every migration applied.

> Run only one `alchemy dev` at a time. A second one rewrites `VITE_SERVER_URL` to `:3002`.

### Becoming an admin

No code creates the first admin. Sign in once with a Google account on one of the institution domains (`kmitl.ac.th`, `kmutt.ac.th`, `kmutnb.ac.th`); any other address is refused until someone invites it (see [Sign-up and invitations](#sign-up-and-invitations)). Then set `role` to `admin` on your row in the `user` table. Locally, run `bun run db:local:studio` to open Drizzle Studio on the dev database (run `bun run dev` at least once first). After that, admins can promote other accounts from `/staff/users`.

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
| `bun run email:dev`       | Preview the email templates in `packages/email/emails`                     |
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
- **Server tests** call `app.request(...)` against the real routers. `createTestContext()` in `apps/server/src/testing.ts` gives you `seedUser(id, { role, department, seat, institution, banned, name })`, `seedParticipant(id, institution)`, a fake mailer whose queued jobs are in `t.mail.jobs`, and `as(userId, { method, json })`, which builds a request signed in as that user.
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

| Prefix               | What it serves                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `/api/departments`   | Departments and their members                                                                   |
| `/api/users`         | `/me` (the caller's rights), the account list, assignment, admin, institution and storage quota |
| `/api/invitations`   | Invitations for addresses outside the institution domains: list, create, resend, revoke         |
| `/api/view-as`       | Admins previewing the app as a role, department and institution                                 |
| `/api/leadership`    | Head and vicehead seats, the account picker, and audited contact reveal                         |
| `/api/profile`       | The signed-in account's own profile: read, save a draft, submit                                 |
| `/api/files`         | Uploads to R2 with per-account quotas; `/api/files/public` serves public files                  |
| `/api/calendar`      | Team calendar items, people and notifications                                                   |
| `/api/links`         | Short links (see [Short links](short-links.md)); `/l/<slug>` answers visits                     |
| `/api/qr-presets`    | Shared QR designs                                                                               |
| `/api/sports`        | Sports and divisions                                                                            |
| `/api/registrations` | An athlete's own sport registrations                                                            |
| `/api/athletes`      | Staff review, edit and export of registrations                                                  |
| `/api/venues`        | Venues                                                                                          |
| `/api/events`        | Events, participants and check-in                                                               |
| `/api/tickets`       | Event tickets                                                                                   |
| `/api/emails`        | Staff emails to chosen audiences                                                                |
| `/api/public/events` | Signed-out event data for link previews                                                         |

Every router follows the same conventions:

- **Dependency seam.** Each router is a factory, `createXRoutes(deps)`, where `deps` is `{ getSession, getDb }`. Production passes in the Better Auth session and D1. Tests pass in a header-based fake session and the in-memory database.
- **Authorization is read from the database on every request.** `requireUser` (`src/middleware/current-user.ts`) loads the caller's role, department, seat and ban state fresh, and `requireMember` rejects guests and athletes. The rules themselves live in `src/policies/`, one file per area (see [Roles and permissions](#roles-and-permissions)).
- **CSRF.** Session cookies are `SameSite=None`, so `requireJsonPosts` rejects any POST that is not `application/json`.
- **Race-safe writes.** A route reads state, checks it, then writes everything in one `db.batch([...])`, which D1 runs as a single transaction. The batch starts with `abortUnless(db, userId, condition)`, which makes the whole batch fail if the caller's rights changed after the check. `constraintError()` turns that failure into a `"stale"` response. Calendar items also carry a `version` that every write increments, so an edit based on an old read is refused.
- **Validation.** `validate(target, zodSchema)` returns `400 { message, issues }` when the input is invalid.

### Web

- File routes are in `apps/web/src/routes`. `/staff` is a client-only layout (`ssr: false`) that sends non-members away.
- Each server router exports `type XRoutes`, and the web app imports that type by relative path to build a typed client (`src/lib/*.ts`). When a response shape changes, the web app's types follow.
- Pages get their API clients from `useApis()` (`src/lib/api-context.tsx`), so tests can supply fakes through `ApiProvider`.
- `clearCacheOnUserChange` clears the TanStack Query cache when the signed-in account changes, because cached flags such as `canEdit` belong to one user.
- Short links (`/l/<slug>`) are served on the web host but answered by the API through the `SERVER` service binding. See [Short links](short-links.md) for how a visit is handled and the runbook for outages.

### Roles and permissions

`packages/auth/src/permissions.ts` defines the account roles: `guest` (the default), `participant`, `athlete`, `staff` and `admin`. Roles are stored as a comma-separated string, so always read them through `parseRoles`, `hasRole` or `isMember`. `staff` and `admin` are members, who may use `/staff`.

Everything else is decided on the server, in `apps/server/src/policies/`:

- **Seats.** Heads and viceheads are rows in the `leadership` table, not roles. Seats are KMITL's only: an account of another institution can be staff but cannot hold a seat, and an account with no institution becomes KMITL's when it takes one. A seat held from before that rule grants no leader rights.
- **Department capabilities.** Only the reserved department codes grant rights, through `DEPARTMENT_CAPABILITIES` in `policies/department-capabilities.ts`: `tech-live` (Tech/Live) and `registration` (ทะเบียน). Policies ask for a capability, never a code.
- **Who may do what.**

| Area                                             | Who                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Give any role except admin, manage seats         | Admins, and the KMITL heads and viceheads of Tech/Live and ทะเบียน ("full rights")   |
| Give `guest` to a non-member, invite guests      | Other Tech/Live and ทะเบียน staff                                                    |
| Edit a seat's nickname, phone and socials        | Full rights, and the seat's own holder                                              |
| See a leader's contact (audited)                 | Admins and every leader see all; staff see their own department's head and vicehead |
| Storage quotas                                   | Full rights                                                                         |
| An account's institution                         | Full rights and KMITL ทะเบียน staff; holders cannot change their own once it is set  |
| Departments: create, edit, delete, members       | Admins, and KMITL ทะเบียน heads and viceheads                                        |
| Sports, events, venues; review and edit athletes | Full rights                                                                         |
| Read athletes and run the kiosk                  | Full rights, Tech/Live staff and KMITL ทะเบียน staff                                 |
| Read and export athletes of one institution      | ทะเบียน staff of that institution                                                    |
| Staff emails, to anyone                          | Admins, every Tech/Live member, and KMITL ทะเบียน heads and viceheads                |
| Short links                                      | See [Short links](short-links.md)                                                   |

`/api/users/me` returns the caller's flags (`canManageUsers`, `canManageDepartments`, `canSendEmail`, `assignableKinds`, `sportAccess`) and list responses carry per-row flags such as `canEdit`, `canReveal` and `canSetStorage`. The web app only uses them to decide what to show.

### Sign-up and invitations

A first Google sign-in creates an account on its own only for a verified address on `kmitl.ac.th`, `kmutt.ac.th` or `kmutnb.ac.th`, subdomains included (`SELF_SIGNUP_DOMAINS` in `packages/db/src/profile.ts`). Any other address is sent back to `/login?error=invite_required` unless it has an open invitation. Invitations are made on `/staff/users`, emailed through the queue, and expire after 14 days. When the invited address signs in, the invitation sets its role, department and institution, and gives it a head or vicehead seat if that seat is still free (`packages/auth/src/signup.ts`). A head or vicehead invitation is always KMITL's.

A new account picks its institution on the participant form, and can change it only until the form is first submitted. After that, or as soon as the account has an institution of its own (from an invitation, staff, or a first sport registration), the form shows it read-only and `/api/profile/draft` and `/submit` keep the locked value whatever they are sent (`lockedInstitution` in `apps/server/src/routes/profile/index.ts`). Only those in the table above change it, through `PUT /api/users/:id/institution`.

## Database and migrations

1. Edit the schema in `packages/db/src/schema/` (`auth`, `department`, `leadership`, `invitation`, `profile`, `sport`, `event`, `calendar`, `short-link`, `qr-preset`, `email`).
2. Run `bun run db:generate` to write a new migration folder in `packages/db/src/migrations/`.
3. Alchemy applies pending migrations on `alchemy dev` and on every deploy.

Never edit a migration after it has been generated. Your local `alchemy dev` has probably applied it already, and the deployed stages certainly have. Add a new migration instead.

## Environments and deployment

Only CI deploys shared stages (`.github/workflows/deploy.yml`):

Production endpoints: [web](https://it3k.creasy.club) and [API](https://it3k-api.creasy.club).

| Trigger           | Stage     | Notes                                                                |
| ----------------- | --------- | -------------------------------------------------------------------- |
| Push to `prod`    | `prod`    | The default branch                                                   |
| Push to `main`    | `staging` | Also the Google sign-in relay for previews                           |
| Pull request `#n` | `pr-<n>`  | Destroyed when the PR closes, and a bot comment links to the preview |

- CI has separate check and deploy jobs. The check job runs `lint`, `lint:biome` and `check-types`; the deploy job runs `alchemy deploy`. They are not currently linked by a `needs` dependency.
- Custom hostnames are assigned only in CI. A deploy from your laptop (`bun run deploy`) creates a personal stage on `workers.dev`.
- **Google sign-in on previews.** Google accepts only redirect URIs registered exactly, so `pr-*` stages sign in through staging using Better Auth's `oAuthProxy`. prod, staging and localhost each have their own registered URI, so the proxy does nothing for their own sign-ins. Local development can omit `OAUTH_PROXY_SECRET` to disable the plugin entirely.
- **State guard.** CI refuses to deploy `staging` or `prod` if that stage has no Alchemy state, because a fresh deploy would create a second D1 database next to the real one. To rebuild a stage on purpose, set the repository variable `ALLOW_FRESH_STAGE` to the stage name for one run, then delete it.
- **Preview cleanup.** `sweep-previews.yml` runs daily and can also be started by hand. It destroys preview stages whose PR has closed but that were not cleaned up.
- **Logs.** Each deployed tier (prod or nonprod) has one Axiom dataset. Every event is tagged with its stage (`DEPLOY_ENV`), so you can tell `staging` and `pr-42` apart. Local development logs stay in the terminal unless `AXIOM_DEV_ENABLED=true`.

## Contributing

- Open a pull request against `main`, which deploys `staging` when merged. Changes reach `prod` only through a pull request from `main`.
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
