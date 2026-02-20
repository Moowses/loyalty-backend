# Codex Agent Guide — Loyalty Backend (Node/Express)

## Mission
Help maintain and extend this backend safely without breaking production integrations or frontend expectations.

This is a standalone Node/Express API that the Next.js frontend (separate repo) consumes. Never assume code changes in the frontend exist unless explicitly provided.

## Non-Negotiables
- Do NOT rename existing routes or change their response shapes unless explicitly instructed.
- Do NOT remove existing exports/functions in routes/services (even if unused) without confirming impact.
- Prefer additive changes: new endpoints, new fields (optional), new helper functions.
- Keep comments minimal and practical.
- Keep secrets out of code. Use `.env` variables.

## Repo Mental Model
- `index.js` wires middleware + mounts routers.
- `routes/*` define API endpoints (Express Router).
- `services/*` integrates with external APIs (token signing, CRM calls, etc.).
- `data/*` includes static data (ex: CSVs).

## Coding Standards
- Node.js CommonJS style (`require`, `module.exports`) to match current codebase.
- Use async/await with proper try/catch.
- Always return consistent JSON:
  - `{ success: true, data: ... }` or `{ success: false, message: ... }`
  - If a file already uses a different contract, match that file’s existing style.

## Error Handling Rules
- Never leak raw upstream error bodies that might contain secrets.
- Log server-side with enough detail for debugging.
- Client response should be safe and consistent.

## Auth / Cookies / CORS Rules
- CORS has a strict allowlist + supports cookies (`credentials: true`).
- Any new frontend origin must be added to the allowlist in `index.js` if required.
- Cookie parsing is already enabled globally.
- For new auth-sensitive endpoints, ensure no-store headers apply:
  - Prefer placing them under `/api/auth`, `/api/user`, `/api/booking`, `/api/payments`, or `/api/review`
  - Or extend the no-store middleware condition if adding a new sensitive base path.

## Rate Limiting Rules
- Password reset request endpoint is rate-limited.
- If you add new endpoints that trigger emails, OTPs, password resets, or public forms:
  - Add a dedicated limiter.
  - Keep limits conservative.

## Route Hygiene
- Avoid route collisions under the same mount prefix.
  - Note: there are currently multiple routers mounted at `/api/user`.
- When adding new endpoints, pick descriptive subpaths:
  - `/api/user/settings/*`
  - `/api/user/dashboard`
  - `/api/booking/search`
  - `/api/payments/intent`
  - etc.

## How to Implement a New Endpoint (Checklist)
1) Identify correct router:
   - auth → `routes/auth.js` or new `routes/*`
   - user → `routes/user.js` or `routes/accountSetting.js`
2) Add a small route handler:
   - validate input
   - call a `services/*` function for external work
   - return stable JSON
3) Add minimal tests (if none exist, add a basic smoke script or Postman notes in PR description)
4) Confirm no CORS issues for frontend origin.
5) Ensure secrets only come from `.env`.

## When Editing Existing Code
- Maintain existing patterns in that file.
- Do not “refactor everything” unless asked.
- If you detect duplicated logic, create small helper functions but keep behavior identical.

## Environment Variables
- Read secrets via `process.env.*`.
- Never print secrets to logs.
- If you introduce a new env var:
  - Document it in `README` or `architecture.md`
  - Provide a safe default only when appropriate.

## Output Expectations
When asked to "update the file", provide:
- the full updated file content
- no extra scaffolding
- minimal comments
- ensure it runs as-is

When asked for guidance, provide:
- exact file paths
- exact code blocks
- quick verification steps (curl/Postman)

## Fast Verification Commands
- `node index.js`
- `curl -i http://localhost:5000/health` (only if a health route exists; otherwise suggest adding it)
- Verify CORS by calling from the frontend origin and confirming credentials behavior.
