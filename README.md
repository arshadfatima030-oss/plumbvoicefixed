# PlumbVoice AI

AI phone-receptionist and dispatch console for plumbing and electrical contractors.
React 19 + Vite 8 frontend, Express server (`server.ts`). The servers are stateless: all data goes through `server/storage.ts`, so several servers can run side by side.

## Run

```bash
npm install
cp .env.example .env     # then edit
npm run dev              # http://localhost:3000
```

Production:

```bash
npm run build
APP_URL=https://your-domain.com npm start
```

## What is real and what is simulated

| Area | Status |
| --- | --- |
| Accounts, sessions, email verification, password reset, emailed sign-in codes | Real (salted scrypt, expiring sessions, rate limits). Emails need `SENDGRID_API_KEY` + `MAIL_FROM`; without them they are printed in dev only. |
| Test Agent | Gemini when configured; automatic rule-based fallback if the model/key is unavailable. |
| Demo "System Number" and Test Agent calls | **Simulated.** The demo number is a placeholder (fictional 555-01XX range) and cannot take real calls; test calls are logged without telephony. |
| Real inbound calls, emergency SMS, missed-call text-back, maintenance reminders, recording playback | **Built, not yet tested live.** Telnyx webhook (Ed25519 signature check), SMS sending and `GET /api/calls/:id/recording` are implemented and activate when `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` and `TELNYX_SMS_FROM` are set (see TELNYX_SETUP.md). Without those keys the app runs in simulation mode. Needs a staging test with a real number, plus US 10DLC registration for texting. |
| PostgreSQL (multi-server, activity log, reminder counters) | Built and unit-tested on the in-memory store. The activity-log and reminder SQL has **not** been run against a real PostgreSQL database yet. |
| Billing / Stripe (+ trial/grace rules) | Built (Checkout, customer portal, signed webhook sync). **Not yet tested live**: set the `STRIPE_*` env vars and do a test-mode checkout first (see FEATURES_SETUP.md). Without the keys, plan changes are recorded locally and nobody is charged. |
| Google Calendar | Built, not verified end-to-end. |
| Quotes, duplicate merge, data export, booking page, review requests, maintenance reminders, activity log, ring-owner-first | Built, logic reviewed, not yet clicked through in a browser. |
| Authenticator-app 2FA | Not implemented. Emailed codes (below) are the second step instead. |

## Marketing copy
Statistics on the public pages are illustrative or removed; none are customer or field data. Add real, sourced figures before publishing any.

## Running several servers together

```bash
cp .env.example .env     # set POSTGRES_PASSWORD, APP_URL, SENDGRID_*, GEMINI_API_KEY
docker compose up --build            # nginx load balancer + 3 app servers + Postgres
docker compose up --build --scale app=5
```

Open http://localhost:8080. `GET /api/health` returns `instance` so you can watch requests spread across servers.

How the servers cooperate:

- **Shared state:** sessions, accounts, workspaces, one-time email links and rate-limit counters live in Postgres (`DATABASE_URL`). Any server can answer any request, so no sticky sessions are needed and a server can be restarted or removed at any time.
- **Safe concurrent writes:** each workspace has a version number. If two servers save the same workspace at once, the second save is rejected with `409` (nothing is written) and the browser retries automatically.
- **Race-proof signup and links:** email addresses are unique in the database, and verification/reset links are redeemed atomically, so they work exactly once even if two servers receive them.
- **Shared rate limits:** login and signup limits count across all servers.
- **Health:** `/api/ready` (database reachable) is used by the container health check and is the right target for a load balancer.
- **Graceful shutdown:** servers finish in-flight requests on SIGTERM before exiting.

Without `DATABASE_URL` the app falls back to local storage (`data/store.json`) and must run as one server.

Limits: each business's data is one JSON document (capped at 1000 calls / 2000 leads), which is fine for early customers; move calls and leads into their own tables as volume grows. The Postgres layer and Docker setup were written but not run in the environment where this was authored, so test them with `docker compose up` before going live.

## Security notes

- New accounts start empty; there is no demo account or shared data.
- All write routes whitelist and validate fields and enforce roles (Owner / Dispatcher / Technician / Viewer).
- The same Gmail address cannot register twice (dots and `+tags` are ignored).

## Saved devices and emailed codes

- **Sign-in:** on a device that isn't saved, a correct password is not enough. We email a 6-digit code (valid 10 minutes, 5 guesses). Ticking "Remember this device" saves that browser for 30 days, and later sign-ins skip the code.
- **Sensitive changes:** changing the password, the billing plan, or team members/roles on an unsaved device asks for a fresh emailed code (valid for 15 minutes once entered). Saved devices skip it.
- **Control:** Profile → "Forget all saved devices" removes every saved device and signs out other sessions. Changing or resetting the password does the same.
- **Needs email:** codes are only required when SendGrid is configured (otherwise nobody could receive them). Set `LOGIN_CODES=always` to test locally with codes printed to the server console.

## Reliability (server should not crash)

- **Async-safe routes:** every route and middleware is wrapped (`server/safe.ts`), so a failure such as the database being briefly down becomes a clean `500` JSON reply instead of an unhandled rejection that kills Node.
- **Process guards:** a stray unhandled rejection is logged and the server keeps running. A real uncaught exception drains in-flight requests and exits so Docker (`restart: unless-stopped`), pm2 or systemd starts a fresh process. Always run under one of those in production.
- **Database startup:** the server retries the database connection for about a minute before giving up, and Postgres connection errors on checked-out clients are handled instead of crashing.
- **Slow model:** Gemini calls are capped at 20 seconds, then the rule-based fallback answers.
- **Limits:** request bodies are capped at 256 KB, inputs are validated and truncated, per-business data is bounded, and login/signup/code attempts are rate-limited.
- **Frontend:** an error boundary shows a Reload button instead of a blank page if a screen fails to render.

- **Technician portal**: Technician-role users get a mobile "My Jobs" screen with only their assigned jobs (see FEATURES_SETUP.md).

## Plans: what each one unlocks

- **Starter:** AI answering (English + Spanish), lead CRM, transcripts, alerts, website chat widget, call quality analytics, text-consent tracking, recording notice/retention, CSV lead export.
- **Professional** adds: customer quotes, maintenance reminders and review requests, duplicate lead merge, online booking page, technician accounts ("My Jobs"), Google Calendar booking, missed-call text-back, ring-owner-first, webhooks, website knowledge import, texting links during calls.
- **Business** adds: multi-location routing, activity log, full JSON data export.
- The single source of truth is `FEATURE_MIN_PLAN` in `server/access.ts`. If you change a plan, also change the lists in `src/pages/public/HomePage.tsx` and `MarketingPages.tsx`.
- Enforced only when Stripe is configured (`server/access.ts`, `planAllows`). A free trial can try everything. Without Stripe nothing is locked.
- **Minutes:** calls are never cut off at the limit (emergencies must still be answered). The owner gets a notice at 80% and 100%. Used minutes reset to 0 when a new paid invoice arrives.
- **Business** also unlocks multi-location routing (Settings → Automation → Locations). **Professional+** also unlocks texting a booking link or directions during a call.
- **Locations:** each location has its own ZIP list, alert number and hours. A call, chat or booking is routed by ZIP (for phone calls, by a ZIP the caller said). Each ZIP can belong to one location; no match means the main number, as before.
- **Recording & Privacy:** an owner-set recording notice (said by the Test Agent; paste the same sentence into the Telnyx assistant greeting for real calls) and a retention period. When it expires only the audio is removed; transcript and lead stay. Owners can delete one recording from the call page.
- **Extra minutes:** shown in Billing at `OVERAGE_RATE_USD` (default $0.35). They are billed on the invoice only if you create a Stripe Billing Meter and set `STRIPE_OVERAGE_METER_EVENT` (not tested live).
- **Call quality** (Analytics): missed, hung up under 15s, needs callback, spam, Spanish calls, average length, leads by location. Real calls only.
- Run the tests with `npm test`.
