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
| Phone numbers, inbound calls, SMS | **Simulated.** No telephony provider is connected. Placeholder numbers always use the fictional 555-01XX range. |
| Billing / Stripe, Google Calendar | **Not implemented.** Plan changes are recorded locally; nobody is charged. |
| Authenticator-app 2FA | Not implemented. Emailed codes (below) are the second step instead. |

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
