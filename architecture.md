# Loyalty Backend — Architecture

## Overview
This repository is the standalone API service for the Loyalty / DreamTripClub web portal. It is a Node.js + Express application that exposes REST endpoints under `/api/*`.

Frontend (Next.js, deployed on Vercel) calls this backend via a configured base URL. This backend must be deployed separately (VM/container/PaaS) and is not bundled with the frontend.

## Tech Stack
- Node.js
- Express
- Middleware: CORS, cookie-parser, express-rate-limit
- Config: dotenv (.env)

## Runtime Entry
- `index.js` is the application entrypoint.
- Loads environment variables via `dotenv.config()`.
- Configures middleware in this order:
  1) `app.set('trust proxy', 1)`
  2) CORS with allowlist + `credentials: true`
  3) JSON / URL-encoded body parsers
  4) cookie parsing
  5) no-store headers for auth-sensitive paths
  6) rate limiters for sensitive endpoints
  7) route mounting under `/api/*`
  8) starts server on `PORT` (default 5000)

## CORS Policy
Allowed origins include:
- Local dev: `http://localhost:3000`
- Production domains: `https://member.dreamtripclub.com`, `https://www.dreamtripclub.com`, `https://dreamtripclub.com`
- IP-based: `http://128.77.24.76`, `https://128.77.24.76`
- Additionally allows any origin ending with `.dreamtripclub.com`

CORS is configured with:
- `credentials: true` (cookies / auth flows are allowed)
- Custom `origin()` callback rejects non-allowlisted domains.

## Security / Caching Controls
For sensitive API groups, responses set:
- `Cache-Control: no-store, no-cache, must-revalidate, private`
- `Pragma: no-cache`

Applied when path starts with:
- `/api/auth`
- `/api/user`
- `/api/booking`
- `/api/payments`
- `/api/review`

## Rate Limiting
- Password reset request limiter:
  - window: 3 minutes
  - max: 1
  - applied to: `/api/auth/request-password-reset`

- Review limiter exists in code but must be verified whether it is attached to any route (currently defined, but route usage should be checked in `routes/surveyRoutes.js`).

## Route Map (Mounted Prefixes)
Mounted in `index.js`:

Auth
- `/api/auth/signup` → `routes/signup.js`
- `/api/auth/reset-password` → `routes/reset-password.js`
- `/api/auth/request-password-reset` → `routes/request-password-reset.js` (rate limited)
- `/api/auth` → `routes/auth.js` (general auth)

User / Account
- `/api/user` → `routes/user.js`
- `/api/user` → `routes/accountSetting.js` (note: shares same base path; avoid conflicting route names)
- `/api/account` → `routes/account-update.js`

Booking / Payments
- `/api/booking` → `routes/booking.js`
- `/api/payments` → `routes/payments.js`

Other Features
- `/api/kext` → `routes/kext-external-ref.js`
- `/api/calendar` → `routes/calendar.js`
- `/api/uat-tools` → `routes/uat-tools.js`
- `/api/metgettoken` → `routes/metgettoken.js`
- `/api/review` → `routes/surveyRoutes.js`
- `/api/properties` → `routes/properties.js`

## Services Layer
The repository uses `services/*` as integration modules (examples from your folder):
- `services/getToken.js` (token fetching/signing)
- `services/getTokenUAT.js`
- `services/getTokenVc.js`
- `services/crmSurveyService.js`

Rule of thumb:
- `routes/*` should stay thin (validation, mapping, response shape)
- `services/*` contains external API calls and signing logic
- Keep response contracts stable for the frontend.

## Known Implementation Notes / Risks
1) Two routers mounted on `/api/user`:
   - `routes/user.js`
   - `routes/accountSetting.js`
   This is fine if route paths do not collide, but must be kept clean (ex: `/api/user/dashboard` vs `/api/user/settings`).

2) `trust proxy` is enabled:
   - correct when deployed behind a reverse proxy / TLS terminator
   - needed for correct IP and rate limiting behavior.

## Deployment Model
- Frontend: Next.js on Vercel
- Backend: separate service (Node process behind a reverse proxy, or a managed Node hosting)
- Required environment variables must be set on backend host.
- Ensure the frontend base URL is set to the backend public URL.

## Local Development
1) Install deps:
   - `npm install`
2) Create `.env`
3) Run:
   - `node index.js`
   - or `npm run dev` if defined in `package.json`
4) Frontend calls:
   - `http://localhost:5000` (or your chosen `PORT`)
