# Step 1: Boundary Map + Decision Document (Approval Required Before Implementation)

> This follows the analysis in `docs/step0-boundary-analysis.md`. The approach is: logical separation (routes, guards, permissions, CORS) with a single shared PostgreSQL DB. No DB split now.

## 1. Core Principle

- **True security isolation via boundaries (code + routes + authZ + network exposure)**, not just UI hiding.
- **Single DB shared** to preserve FKs/relations (Student–Instructor natural relationship, Enrollments, Certificates, Chat).
- **Deny-by-default** + server-side authorization on every resource (ownership + permissions).
- **Incremental, non-breaking** changes. No big-bang rewrite.

## 2. Proposed Boundary Split

### 2.1 Learner System (Student + Instructor)
Purpose: day-to-day learning/teaching, least privilege.

**Pure/mixed candidates (from Step 0):**
- Pure learner: `ratings/ratings.controller.ts` (STUDENT/INSTRUCTOR only in observed scope)
- Mixed (must be split by endpoints/guards): `learning-paths`, `announcements` (some staff), `commerce` (mixed student/finance/admin), `grades`, `certificates`, `analytics`, `refunds` (student requests vs admin review), `users` (profile vs mgmt), `lms/*` (lessons/quizzes/reviews), `rubrics`, `tasks`, `instructor-requests`, `live-sessions`, `courses/course-openings`, `calendar`, `enrollments`, `chat`, `discussions`.

**Learner API surface (proposed base path):** `/api/v1/*` (or `/api/learner/*`). Keep existing public/auth paths intact.

**Learner roles:** `STUDENT`, `INSTRUCTOR`.

### 2.2 Administration System (Admin + Finance + Course Manager + SuperAdmin)
Purpose: sensitive operations (financial, user mgmt, audit, operations).

**Pure admin (clear):** `operations`, `audit`, `finance`, `support-tickets`, `payment-gateways`, `announcement-board`, `blog` (admin parts), `instructor-applications`, `courses/courses.controller.ts` (ADMIN/COURSE_MANAGER only), `gamification` (admin), `health` (ops).

**Admin API surface (proposed base path):** `/api/admin/*` (segregated). Never exposed to learner frontend origin.

**Admin roles:** `COURSE_MANAGER`, `FINANCE`, `ADMIN` (with future `SUPER_ADMIN`).

## 3. What Stays Shared vs Split

### Shared (must remain)
- **DB (Postgres)** – single schema, FKs, JOINs. Preserves Student–Instructor relationships.
- **Users table (identity)** – central. Prevents breaking Chat/Enrollments/Certificates.
- **Shared entities**: `Course`, `CourseOpening`, `Enrollment`, `Certificate`, `CourseReview`, `Chat/DirectChat/DirectMessage` – live in shared DB, accessed via services with authorization.
- **Auth core** (JWT issuance/refresh, user lookup). Unified identity.

### Split (code/routes/guards)
- **Route prefixes**: `/api/admin/*` vs `/api/*` (learner). Enforced by boundary guard (prefix + audience).
- **Controllers/Modules**: Admin-only controllers move under admin domain modules; mixed controllers split into learner/admin subroutes or separate admin controllers where feasible.
- **Permissions layer** (RBAC+Permissions) to enforce least privilege (especially FINANCE vs COURSE_MANAGER vs ADMIN).
- **Guards**: separate admin scope guard (`aud: 'admin'`) + learner (`aud: 'learner'`) to prevent token misuse across boundaries.

## 4. Authentication Model

- **Unified JWT**: `sub` (userId), `role`, granular `permissions`, `tokenVersion`, `aud` (`learner` | `admin`).
- **Audience enforcement**: token issued for admin cannot be accepted on learner-prefixed routes and vice versa (boundary guard). Also CORS origin check.
- **Refresh tokens**: consider admin token family with shorter TTL, rotation + reuse detection, stricter storage semantics.
- **MFA (admin)**: optional for `ADMIN` and `FINANCE` at sign-in, and managed from the account security settings. Step-up auth remains mandatory for sensitive operations (refund approve/reject, certificate revoke, payment-gateway changes); those operations are unavailable while 2FA is disabled.
- **Step-up**: high-risk financial/admin actions require fresh auth/TOTP.

## 5. Access Control Strategy (Security)

- **Deny-by-default** at route + service layers.
- **Server-side only**: never trust frontend role/claims beyond token verification.
- **Ownership + resource checks** (BOLA/IDOR): every service method authorizes (owner OR has management permission + scope).
- **Route segregation + prefix guard**: blocks cross-boundary calls at ingress.
- **CORS**: separate allowed origins (`learner.example.com`, `admin.example.com`). Learner origin disallowed for `/api/admin/*`.
- **Least privilege** per role (FINANCE vs COURSE_MANAGER). Granular permissions.
- **AuditLog protection**: no update/delete by non-SUPER_ADMIN; all admin/financial ops logged.
- **Error hygiene**: generic errors, no DB/internal details leaked.

## 6. Mixed Controllers Strategy

Most complexity is 20 mixed controllers. Recommended split approaches (non-breaking):

1. **Split by HTTP methods/routes** inside controller where admin-only endpoints exist (extract admin subroutes to Admin controllers). 
2. **Keep as-is initially but wrap with enhanced guards + audience + permissions**; migrate endpoints gradually to admin modules under `/api/admin/*`.
3. **Extract admin endpoints**: e.g. refunds (student creates/owns vs admin reviews), certificates (student read/own vs staff issue/revoke/print), users (profile vs management), commerce (student cart vs finance/admin ops), course-openings (instructor create/publish vs admin oversight).

Rationale: preserves backward compatibility, reduces blast radius, allows verification per endpoint.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Privilege escalation | Separate guards + aud + route prefix + permission checks in every service method + tests |
| IDOR/BOLA | Ownership checks on every resource + resource policies + fail-closed |
| Admin endpoint exposure | Prefix guard + CORS (separate origins) + deny-by-default + don’t expose admin routes in learner Swagger |
| Token misuse across boundaries | `aud` enforcement + issuer checks + tokenVersion + reject cross-audience usage |
| Breaking Student–Instructor relations | Keep single DB + identity; split only code/routes/authZ |
| Mixed controller complexity | Gradual extraction + boundary tests per endpoint group |
| Data leakage | DTOs/projections, `select` only needed fields, sanitized errors |

## 8. Phased Plan (Incremental, Non-Breaking)

| Phase | Steps | Risk | Status |
|---|---|---|---|
| **Phase 0** | Cross-ref + classification | Low | **Done** |
| **Phase 1** | Boundary Map + Decision Doc (this doc) – **APPROVAL REQUIRED** | Low | **Done (approved)** |
| **Phase 2** | Permissions model (RBAC+Permissions), decorators (`@RequirePermissions`), policy layer, update guards to include audience | Low | **Done** — catalog + guards + `aud` claims shipped, pilot on `GET /audit`; see `docs/permission-map.md` |
| **Phase 3** | Route segregation: introduce `/api/admin/*`, admin module scaffolding, boundary prefix guard (aud+path), CORS split | Low–Med | **Done** — eleven admin-pure controllers serve `/api/admin/*` with `@RequirePermissions` on every route, `GET /admin/stats` annotated in place, frontend call sites updated, segregation test added; see `docs/permission-map.md` §6. Origin/CORS split deferred to Phase 7 (single frontend origin today) |
| **Phase 4** | Mixed controllers: annotate platform methods with `@RequirePermissions`, keep ownership routes on role + service ownership checks | Med | **Done** — 75 platform routes across the 17 mixed controllers annotated (`lessons`/`chat`/`discussions` are pure learner and got none), `PermissionsGuard` mounted on each, no catalog/service change; `tests/mixed-route-permissions.test.ts` pins the table via a fixture + no-privilege-cut + negative-mount checks; see `docs/permission-map.md` §7 |
| **Phase 5** | Hardening: MFA for admin/finance, step-up for sensitive ops, audit protection, error hygiene | Low | **Done** — admins/finance can optionally enable or disable 2FA from account security settings; enabled 2FA is required at login/refresh/google, while sensitive actions always require 2FA and are unavailable when it is off. Setup uses `2fa/setup` + `2fa/confirm`; `StepUpGuard` protects refund review/certificate revoke+reissue/payment-gateway mutations (fresh TOTP via `X-Step-Up-Code`), audit remains append-only (read-only controller, single `create`), error hygiene already pinned by `exception-filter` tests; frontend: `/auth/two-factor-setup` page, axios retry interceptor + `StepUpProvider` modal; see code + §10 |
| **Phase 6** | Security tests: boundary tests (learner cannot call admin), IDOR/BOLA, privilege escalation, token misuse | Low | **Done** — `tests/hardening-security.test.ts`: optional 2FA for privileged roles (login/refresh/google + challenge flow + disable), step-up wrong/missing code, AdminBoundaryGuard overreach (learner-audience 403, purpose tokens 401, `opsGrant` 401), CORS allow-list behaviour |
| **Phase 7** | Frontend split prep (separate origins), docs, verify no functional regressions | Low | **Done** — CORS now allow-list based (`cors-origins.ts` = `FRONTEND_URL` + `CORS_ORIGINS`, `X-Step-Up-Code` header allowed), full backend suite **497/497**, backend build, frontend build + ESLint clean (single pre-existing warning) |
| **Phase 8** | Origin split: admin console + admin API on their own origins (same repo, same DB) | Med | **Done** — server wall: `src/common/surface-gate.ts` on both API hosts (`ADMIN_SURFACE=1` on the admin host serves only `aud: admin`/`opsGrant` tokens after a whitelist; `DENY_ADMIN_AUD=1` on the public host refuses `aud: admin`), `tests/surface-gate.test.ts` **16/16**, full suite **512/512**; browser wall: `NEXT_PUBLIC_APP_MODE` gating in `frontend/src/middleware.ts` (admin console/operations 404 on the learner origin, learner dashboard pages + `/register` 404 on the admin origin, `/` + `/dashboard` rewrite to `/dashboard/admin` on admin), login hands privileged roles to `NEXT_PUBLIC_ADMIN_ORIGIN` before storing any token; deployed as separate Railway services `admin-backend` + `admin-frontend` from the same image/DB — verified in production: gate matrix (403 no/learner token, 401 stale token, past-gate→guard for admin), per-origin CORS allow-list, both walls, all frontend 404/200 probes |

## 9. Decision Required

**Recommendation:** Proceed with logical boundary separation (routes + guards + permissions + CORS) + **shared single DB**. Do **not** split DB now.

**Phase 2 is implemented** (permissions model, `@RequirePermissions`,
`PermissionsGuard`, global `AdminBoundaryGuard` on the `admin` path prefix,
`aud`/`permissions` claims, DB-derived permissions in the JWT strategy, plus
a fix for single-purpose tokens being accepted as access tokens).

**Phase 3 is implemented** per the approved §6 table: the eleven admin-pure
controllers moved under `/api/admin/*` (audit moved rather than annotated in
place; the blog admin list normalized to `GET /api/admin/blog`),
`GET /admin/stats` was annotated without moving, every moved route carries
`@RequirePermissions`, all frontend call sites follow the new paths, and
`tests/admin-route-segregation.test.ts` pins both halves. The learner/public
routes listed in §6 stayed where they were.

**Phase 4 is implemented** per §7 of `docs/permission-map.md`: the platform
half of the 20 mixed controllers is annotated with `@RequirePermissions`
(75 routes across 17 files; `lessons`, `chat`, `discussions` carry none) and
`PermissionsGuard` is mounted alongside the existing guards on each. Every
permission was already held by the `@Roles` roles of its route — no catalog
edit, no privilege cut, no service change — and `reviews` moderation reuses
`content:write`. Ownership/learner routes (withdraw, receipts, `my/*`
records, participation) kept their role + service-ownership checks exactly
as before. `tests/mixed-route-permissions.test.ts` pins the annotation map
and the no-privilege-cut invariant, and was mutation-checked in both
directions.
470 tests passing, build and boot smoke clean, frontend typecheck clean.

**Phases 5–7 are implemented.**

> **2FA enforcement.** `login`/`refresh`/`googleLogin` refuse to mint tokens for
> `ADMIN`/`FINANCE` users with `twoFactorEnabled: false` and answer
> `{ requiresTwoFactorSetup: true, tempToken }` (purpose `2fa_setup`, 10 min).
> `POST /auth/2fa/setup` returns the otpauth QR + secret under that tempToken
> (or a session); `POST /auth/2fa/confirm` verifies a challenge TOTP and mints
> the real tokens. `disable2FA` is rejected for privileged roles once enrolled.
> Non-privileged users keep the existing flow unchanged.

> **TOTP verification.** otplib v13 `verify` returns a `VerifyResult` *object*
> that is always truthy, so `if (!verify(...))` accepted ANY code anywhere it
> was used (login/confirm/disable and the new step-up guard). All paths now go
> through `src/common/totp.ts` (`verifyTotp`, checks `result?.valid === true`);
> that function is the single otplib verify call in the codebase. Bug was
> confirmed by the old tests passing wrong codes and now rejecting them.

> **Step-up.** `StepUpGuard` (DI-free, uses Prisma + encryption) is mounted on
> `PATCH /api/admin/refunds/:id/review`, `POST /api/admin/certificates/:id/revoke`
> and `/:id/reissue`, and `POST`/`PATCH`/`DELETE /api/admin/payment-gateways`.
> It reads the TOTP from `X-Step-Up-Code` or the `stepupCode` body field and
> answers `403 { stepUpRequired: true }` when a code is missing/invalid. The
> frontend api interceptor answers that shape by prompting the `StepUpProvider`
> modal and retrying once with the header.

> **CORS.** `corsOrigins()` builds the allow-list from `FRONTEND_URL` plus the
> optional `CORS_ORIGINS` (comma-separated) variable, deduped; the old open
> `/.*/` regex is gone. Set `CORS_ORIGINS` on the new backend when additional
> origins are needed (e.g. a separate ops console unblocks Phase 7's origin
> split).

> **Verification.** Backend suite **497/497** (26 new security tests), backend
> build clean, frontend build clean, ESLint clean (one pre-existing `<img>`
> warning in login page).

Next: wire the reviewer checklist for the privileged 2FA policy (bot a
`twoFactorEnabled: false` FINANCE account before/after a lucky prod deploy),
then open the separate ops-console origin + per-origin CORS when the team is
ready for Phase 7's UI split. The deactivated Google OAuth and SMTP/Stripe
variables on the new host remain outstanding migrations, not boundary work.
