# Laxalab Flutter clients

This directory contains two separate Flutter clients and a shared UI/API package:

- `student_teacher_app`: student and instructor experiences.
- `staff_app`: course manager, finance, and administrator experiences.
- `shared_core`: Arabic RTL design, login/2FA, secure token handling, API access, and shared screens.

## API setup

Set the API origin at build or run time:

```sh
flutter run -d <android-device> --dart-define=API_BASE_URL=https://your-api-host
```

The Android emulator default is `http://10.0.2.2:3001`. Android cleartext HTTP is permitted only for that emulator host. Use HTTPS for any deployed API. macOS also requires an explicitly reachable API origin; build the macOS target on a Mac with Xcode installed.

## Implemented flows

- Password login, forced password change, 2FA challenge and privileged account 2FA enrollment.
- Secure token storage, refresh rotation, and server logout.
- Role-gated app entry and per-role navigation; API authorization remains authoritative.
- Student course/opening lists, no-payment seat reservation, receipt upload (PDF/JPG/PNG, 5 MB limit), enrollment history and withdrawal while pending, grades/certificates/payment/refund eligibility screens, and refund requests.
- Instructor opening lists, searchable roster, per-student assessment grade entry, assessment component management, task creation, and submission scoring with notes.
- Student task list per enrolled opening, text or file submissions (50 MB maximum), grade and instructor feedback display.
- Messaging conversation list, read state and sending messages.
- Finance enrollment approval/rejection and refund review with fresh step-up TOTP.
- Course opening publish/open/start/end actions for staff with server-side permission checks.
- Authenticated enrollment receipt preview for PDF and image files.
- Notification list, individual read state, and mark-all-read action.
- Opening assessment components can be listed, created, and deleted by authorized teaching staff.
- Profile summary and statistics returned by `/users/me`.

## Remaining parity work

The apps are a functional mobile foundation, not yet a screen-for-screen copy of the whole web portal. Remaining work for closer parity includes full course editing and curriculum authoring, opening creation, certificate issuance/revocation workflows, richer support/admin screens, and more complete dashboard/report layouts. The current screens cover core API flows but are not a screen-for-screen recreation of the web portal. App identifiers and production signing credentials also need to be set for release.

These clients do not modify the existing web frontend or backend.
