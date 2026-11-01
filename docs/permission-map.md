# Permission Map — Phase 2

> Part of the boundary split described in `docs/architecture-boundaries.md`
> and decided in `docs/boundary-map-decision.md`. Step 0 analysis is in
> `docs/step0-boundary-analysis.md`.
>
> **Status: Phase 2, Phase 3 and Phase 4 implemented. The admin-pure surface
> now lives under `/api/admin/*`, every moved route carries
> `@RequirePermissions`, and the frontend calls the new paths (§6 records
> the final annotation table and the two deliberate deviations). In Phase 4,
> the platform half of every mixed controller was annotated with
> `@RequirePermissions` while ownership/learner routes kept their
> role + service-ownership checks (§7 records the ported table and the
> `content:write` choice for review moderation).**

---

## 1. What Phase 2 added (and what it does not change)

| Piece | File | Effect today |
|---|---|---|
| Permission catalog + role grants + audience | `src/auth/permissions/permissions.ts` | Pure model. Read by the token signer, the JWT strategy and the guards. |
| `@RequirePermissions(...)` | `src/auth/decorators/permissions.decorator.ts` | Declares a requirement on a route. Since Phase 3: on **every** route of the `/api/admin/*` controllers plus the in-place `GET /admin/stats`. The Phase 2 pilot was `GET /audit`. |
| `PermissionsGuard` | `src/auth/guards/permissions.guard.ts` | Route-level, mounted next to `JwtAuthGuard`. Enforces the decorator; does nothing on routes that declare none. |
| `AdminBoundaryGuard` | `src/auth/guards/admin-boundary.guard.ts` | **Global.** Refuses `​/admin/*` and `/api/admin/*` paths without an admin-audience token. **Live since Phase 3** — every moved controller is served under `/api/admin/*`. `/enrollments/admin` remains deliberately not matched. |
| `aud` + `permissions` claims | `src/auth/auth.service.ts` (`issueTokens`, `refresh`) | Stamped into every access token. |
| DB-derived `req.user.permissions` / `.audience` | `src/auth/strategies/jwt.strategy.ts` | Computed from the **current** database role on every request, never read back from the token's claim. |

**Phase 3 changed URLs, not authority.** Existing `@Roles` decorators stay
exactly as they are and `RolesGuard` still runs everywhere: the permission
layer sits next to them, it does not replace them. The only visible change
is the **URL prefix** (and the frontend call sites that follow it).

### Batch-scoped instructor grants

The role-level catalog is only the outer gate. The primary instructor assigned
to a batch retains full teaching access; a secondary instructor must also have
an `OpeningInstructorGrant` for that specific batch and capability. Course
managers and admins manage grants through `PUT /openings/:id/instructor-grants`.
Grants cover task management, grading, sessions/attendance, announcements,
analytics, and read-only course content. Course content is shared across
batches, so a batch grant never permits editing it. Batch lifecycle, pricing,
certificates, calendar, and chat remain outside assistant grants.

### Security fix shipped alongside

`JwtStrategy` and the chat gateway now refuse tokens carrying `purpose`
(the 2FA challenge and forced-password-change tokens) or `opsGrant`. Those
tokens are signed with the same secret, carry no `tv` (which reads as the
default `0`), and until now passed every check — so a 5-minute challenge
token issued to *satisfy* 2FA could be replayed as a Bearer token to
*bypass* 2FA on any account whose `tokenVersion` had never moved. Tests:
`SECURITY: a 2FA challenge token cannot be used as an access token` and the
two siblings in `tests/permission-model.test.ts`.

---

## 2. The catalog

Permissions are `resource:action` strings describing **platform-surface**
actions ("review any refund"), never ownership ones ("my refund").

| Resource | Permissions |
|---|---|
| users | `users:read`, `users:write`, `users:delete`, `users:role` |
| catalogue | `courses:read`, `courses:write`, `courses:delete`, `openings:write`, `openings:delete` |
| content | `content:read`, `content:write`, `content:delete`, `paths:write` |
| assessment | `grades:read`, `grades:write`, `certificates:issue`, `certificates:manage`, `analytics:read` |
| enrolment | `enrollments:read`, `enrollments:write`, `enrollments:review` |
| money | `payments:read`, `payments:refund`, `payments:settings`, `refunds:review`, `finance:read`, `finance:write` |
| governance | `audit:read`, `support:read`, `support:write`, `news:read`, `news:write`, `blog:write`, `instructors:read`, `instructors:review`, `gamification:manage`, `ops:read`, `ops:manage`, `system:read` |

## 3. Role grants (least privilege)

Derived from the existing `@Roles` decorators — every role that can call a
route today holds the permission that route will be annotated with.

| Permission | STUDENT | INSTRUCTOR | COURSE_MANAGER | FINANCE | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| `openings:write` | | ✅ | ✅ | | ✅ |
| `openings:delete` | | | ✅ | | ✅ |
| `content:read` / `write` / `delete` | | ✅ | ✅ | | ✅ |
| `paths:write` | | | ✅ | | ✅ |
| `grades:read` / `grades:write` | | ✅ | ✅ | | ✅ |
| `certificates:issue` | | ✅ | ✅ | | ✅ |
| `certificates:manage` | | | ✅ | | ✅ |
| `analytics:read` | | ✅ | ✅ | | ✅ |
| `courses:read` / `write` / `delete` | | | ✅ | | ✅ |
| `users:read` | | | ✅ | | ✅ |
| `users:write` / `users:delete` / `users:role` | | | | | ✅ |
| `enrollments:read` | | | ✅ | ✅ | ✅ |
| `enrollments:write` | | | ✅ | | ✅ |
| `enrollments:review` | | | | ✅ | ✅ |
| `payments:read` / `refund` | | | | ✅ | ✅ |
| `payments:settings` | | | | | ✅ |
| `refunds:review` | | | | ✅ | ✅ |
| `finance:read` / `finance:write` | | | | ✅ | ✅ |
| `audit:read`, `ops:read`, `ops:manage`, `gamification:manage`, `system:read` | | | | | ✅ |
| `support:*`, `news:*`, `blog:write`, `instructors:*` | | | ✅ | | ✅ |
| **(nothing)** | ✅ | | | | |

Two pairs are disjoint **by construction**, and tests pin them:

- **COURSE_MANAGER** owns the catalogue and the people/process surface, and
  holds no `payments:*`, `finance:*`, `refunds:*`, `audit:*`, `users:role`,
  `users:delete` or `ops:*`.
- **FINANCE** owns the money and the review queues, and holds no
  `courses:*`, `content:*`, `grades:*`, `users:*`, `audit:*`, `ops:*`,
  `support:*`, `instructors:*` or `analytics:read`.

`ADMIN` is `ALL_PERMISSIONS` (the union of the catalog), not a
hand-maintained list: a new catalog entry is automatically available to the
superuser. Unknown roles resolve to **no** permissions — fail closed.

**STUDENT holds nothing.** Learner routes authorize by ownership (my
enrolment, my submission, my grade); that is a service-level check, not a
capability, and stamping it here would either hand students a platform
capability or break their routes. See section 7.

## 4. Audience (`aud`)

| Roles | `aud` |
|---|---|
| `STUDENT`, `INSTRUCTOR` | `learner` |
| `COURSE_MANAGER`, `FINANCE`, `ADMIN` | `admin` |
| unknown role | `learner` (the restricted side) |

Stamped at sign time; enforced by `AdminBoundaryGuard` on admin-prefixed
paths. The guard verifies the signature itself because global guards run
before `JwtAuthGuard` has authenticated anything — it is a cheap pre-check,
not the authorization decision: `JwtStrategy` still performs the
authoritative user + `tokenVersion` + **current-role** check later in the
same request, so a revoked session or a demoted role is caught even if the
prefix check passed.

Both claims are deliberately **advisory for the server**:

- `req.user.permissions` and `req.user.audience` are recomputed from the
  database row on every request (demotions and future edits to this map take
  effect immediately).
- The token's own `permissions` exist for the client's UI hints only.
- The token's own `aud` matters only at the prefix, where there is no
  database handle.

Tokens issued before this change carry neither claim: they keep working on
every path except `/admin` (which does not exist yet), and pick up both
claims on their next refresh. Access-token lifetime is 15 minutes.

## 5. How a route declares a requirement

```ts
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)   // guard must be listed
@Controller('audit')
export class AuditController {
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.AUDIT_READ)
    @Get()
    getLogs() { ... }
}
```

Rules:

1. `PermissionsGuard` must be in the same `@UseGuards` list as
   `JwtAuthGuard` — it reads `req.user`, so it cannot be global.
2. Guard without decorator = no-op; decorator without guard = **silently
   unenforced**, which is why `tests/permission-model.test.ts` fails the
   build if any file uses `@RequirePermissions` without registering the
   guard.
3. Decorator present but no resolved user/permissions → **deny** (fail
   closed). Decorator absent → allow; `RolesGuard`/ownership still apply.
4. Keep `@Roles` even when the permission implies it. Two independent
   layers, and `RolesGuard` is the one that carries the ADMIN superuser
   rule.

**Pilot:** `GET /audit` is annotated today (`audit:read`). It is
ADMIN-only, so behaviour is unchanged; it exists to prove the wiring
end-to-end on a real route.

## 6. Phase 3 — implemented annotation table

The eleven admin-pure controllers moved under `/api/admin/...` (the prefix
`AdminBoundaryGuard` enforces) and every row below carries
`@RequirePermissions`. Nothing changes who may call what: each row's
permission is held by exactly the roles the `@Roles` decorator allows
today. The only visible change is the **URL prefix** — frontend call sites
were updated to match. The backend has no global `/api` prefix, so the
controllers declare `api/admin/...` literally and the frontend calls
`/api/admin/...`.

Two deliberate deviations from the original plan:

* **`audit` moved** (`/audit` → `/api/admin/audit`) instead of being
  annotated in place — §6's own instruction was to move the eleven
  admin-pure controllers, and audit is one of them.
* **`blog` list route normalized**: `GET /blog/admin/all` became the root of
  the admin controller, `GET /api/admin/blog` (no `admin/all` segment).

| Controller (all under `/api/admin/…`) | Route | Method | Permission |
|---|---|---|---|
| `audit` ✅ *moved from `/audit`* | *(root)* | GET | `audit:read` |
| `gamification` | `add-points` | POST | `gamification:manage` |
| `operations` | `unlock` | POST | `ops:manage` |
| `operations` | `overview`, `timeline`, `events`, `sessions`, `sessions/:id`, `filter-options`, `settings` | GET | `ops:read` |
| `operations` | `settings/password`, `settings/allowlist`, `settings/allowlist/:userId` | POST/DELETE | `ops:manage` |
| `payment-gateways` | `all` | GET | `payments:settings` |
| `payment-gateways` | *(root)*, `media`, `:id` | POST/PATCH/DELETE | `payments:settings` |
| `finance` | `reports`, `coupons`, `coupons/:id/stats` | GET | `finance:read` |
| `finance` | `coupons`, `coupons/:id` | POST/PATCH/DELETE | `finance:write` |
| `support-tickets` | *(root)* (list) | GET | `support:read` |
| `support-tickets` | `:id` | PATCH | `support:write` |
| `announcement-board` | *(root)*, `:id` (list/read) | GET | `news:read` |
| `announcement-board` | *(root)*, `:id` | POST/PATCH/DELETE | `news:write` |
| `blog` | *(root)* — was `admin/all` | GET | `blog:write` |
| `blog` | *(root)*, `:id`, `:id/publish`, `:id/unpublish` | POST/PATCH/DELETE | `blog:write` |
| `instructor-applications` | *(root)* (list), `:id/cv` | GET | `instructors:read` |
| `instructor-applications` | `:id/status` | PATCH | `instructors:review` |
| `courses` (admin methods only) | *(root)* (create), `media`, `:id/openings`, `:id` | POST/PATCH | `courses:write` |
| `courses` | `:id` | DELETE | `courses:delete` |
| `health` ✅ *annotated in place, path unchanged* | `admin/stats` | GET | `system:read` |

Left in place, unannotated, because they are not platform routes:
`operations/track`, `payment-gateways` (active list), `finance/coupons/validate`,
`announcement-board/active`, `blog` public list/slug, `gamification`
`me`/`track`/`leaderboard`/`:userId`, `support-tickets` `create`/`my`,
`instructor-applications` `my`/`create`, all `courses` GETs, `health/health`,
`health/uploads/*`. The old `GET /blog/admin/all` no longer exists at all —
the admin list is `GET /api/admin/blog`.

## 7. Phase 4 rules — mixed controllers (implemented)

1. **Ownership routes never get `@RequirePermissions`.** A route whose
   `@Roles` includes `STUDENT` for their *own* record (`enrollments/:id`
   withdraw, `payments/:id/cancel`, `payments/:id/receipt`, `refunds`
   create, chat, discussions, ratings, `me/*`, progress/notes/submissions,
   certificates `my`/`print`, `rubrics` reviews, `lms/lessons`, `calendar`
   GETs) keeps "owner OR platform permission" semantics **inside the
   service**: `if (isOwner) allow; else require <permission>`. A plain
   permission decorator would deny the owner it exists for. No such route
   was annotated.
2. **Platform methods inside mixed controllers** are annotated, e.g.
   `enrollments/admin` → `enrollments:write`, `enrollments/pending` +
   `:id/review` → `enrollments:review`, `users` role/delete/update →
   `users:role` / `users:delete` / `users:write`,
   `course-openings` lifecycle → `openings:write` (INSTRUCTOR keeps it) and
   `remove` → `openings:delete`, `grades` roster/assessments →
   `grades:read` and assessment/grade writes → `grades:write`,
   `lms/quizzes` writes → `courses:write` (INSTRUCTOR is excluded by
   both guards, as today), `certificates` issue/candidates →
   `certificates:issue` and revoke/reissue/list → `certificates:manage`,
   `instructor-requests` reviews → `instructors:read` / `instructors:review`.
   Every permission selected was already held by exactly the `@Roles` roles
   of its route (no catalog change, no privilege cut); `reviews` moderation
   reuses `content:write` (`@Roles` = Admin + Course Manager, both already
   hold it, INSTRUCTOR stays excluded by `RolesGuard`).
3. Cross-boundary calls stay forbidden (learner services do not call admin
   services), as decided in the boundary documents.
4. Outcome: **75 platform routes annotated across 17 controllers**
   (`lessons`, `chat`, `discussions` are pure learner/participation and got
   none), `PermissionsGuard` mounted alongside `JwtAuthGuard`/`RolesGuard`
   on each annotated controller. No service code changed.

## 8. Tests

`tests/permission-model.test.ts` (29 cases): catalog integrity, the
least-privilege contrasts, audience split, claim stamping in
`issueTokens`/`refresh`, DB-derived permissions (a privileged claim inside
a token is ignored; a demotion shows on the next request), rejection of
`purpose`/`opsGrant` tokens, `PermissionsGuard` allow/deny/fail-closed
behaviour, `AdminBoundaryGuard` prefix + audience + signature + expiry
checks (including `/enrollments/admin` not matching), and the static wiring
checks (decorator ⇒ guard, guard registered globally).

`tests/admin-route-segregation.test.ts` (6 cases, Phase 3): every
admin-pure family still has its `/api/admin` controller; every route in
those controllers carries `@RequirePermissions` (route count == decorator
count) with both guards mounted; the in-place `GET /admin/stats` keeps
`system:read`; and a classifier over every literal API call in
`frontend/src` proves no call site targets a moved route at its old path
while each family is called at its new one — mutation-checked: reverting a
single call to `/audit` fails the suite. `tests/upload-hardening.test.ts`
now discovers upload controllers by scanning for `FileInterceptor` instead
of a hand-listed set, so the Phase 3 file moves cannot bypass it.

`tests/mixed-route-permissions.test.ts` (3 cases, Phase 4): a fixture maps
each of the 75 annotated platform routes to its `@RequirePermissions`
constant; the parser resolves `@Roles` (literals, `Role.*`, and local
`const` spreads incl. class-level) and asserts **every role that can call an
annotated route today holds that permission** (§7 no-privilege-cut), that
ownership/learner routes carry **no** permission (negative), that each
annotated controller mounts `PermissionsGuard`, and that per-file annotation
counts match the fixture. Mutation-checked in both directions: removing a
required permission, or adding one to an ownership route, fails the suite.

Full suite: **470 passing**, `nest build` clean, `tests/boot-smoke.ts` OK,
frontend `tsc --noEmit` clean.
