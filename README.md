# Job Automation Bot

A personal job-application tool: track and auto-apply to jobs across LinkedIn, Naukri, Indeed,
and Hirist, with auto-login, a configurable delay + daily cap before applying, multi-user
accounts (email/password or "Login with Google"), and a profile section to store your personal
details and resume.

- **Backend**: NestJS + Prisma + SQLite (`backend/`)
- **Frontend**: Angular, standalone components (`frontend/`)

## Setup

### 1. Backend

```bash
cd backend
npm install
npx prisma migrate dev   # creates prisma/dev.db and applies the schema
npm run start:dev        # http://localhost:3000
```

Copy `.env.example` to `.env` and fill in real values (an `.env` with generated `JWT_SECRET` /
`ENCRYPTION_KEY` is already set up for local dev). To enable "Login with Google":

1. In [Google Cloud Console](https://console.cloud.google.com/), create an OAuth consent screen
   and an OAuth Client ID (type "Web application").
2. Set the authorized redirect URI to `http://localhost:3000/auth/google/callback`.
3. Put the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` and restart
   the backend.

Without those values, the rest of the app works fine — the Google button just won't complete a
real sign-in.

### 2. Frontend

```bash
cd frontend
npm install
npx ng serve   # http://localhost:4200
```

### 3. Try it

Register a user, fill in your profile and upload a resume, connect a platform login under
**Platform Logins**, create a filter under **Filters & Auto-Apply** (keywords, platform(s), delay
between applications, daily cap), then hit **Start auto-apply**. The **Dashboard** shows live
status and the applications log.

## Auto-fill profile from resume

Uploading a resume on the **Profile & Resume** page extracts its text (PDF via `pdf-parse`, DOCX
via `mammoth` — legacy `.doc` isn't reliably parseable without extra native tooling, so it's
stored but not parsed) and runs a heuristic pass to suggest: name, phone, skills, years of
experience, and an education block. Suggestions are shown for review, never saved automatically —
click "Use these details" to fill the form, then "Save details" to keep them. This is regex/
heading-based extraction, not a trained resume parser, so treat it as a time-saving first pass,
not ground truth.

## How auto-apply works

Each `JobFilter` picks platforms + search terms + pacing (`delaySeconds`, `maxApplicationsPerDay`).
Starting automation launches a headless Playwright browser, logs into each connected platform
using your encrypted saved credentials, searches for matching jobs, and queues them. A background
worker then applies to one queued job at a time, waiting at least `delaySeconds` between each and
stopping once the daily cap is hit — this is the "delay filter" / "custom filter" behavior.

Platform integrations live in `backend/src/automation/providers/`, all implementing the same
`JobPlatformProvider` interface (`login`, `searchJobs`, `applyToJob`).

## Important: scope of the platform integrations

**LinkedIn** (`linkedin.provider.ts`) is a real reference implementation — the login flow and
Easy Apply flow are wired up against LinkedIn's markup as of when this was built.

**Naukri, Indeed, and Hirist are skeletons**, not working scrapers. They implement the same
interface but their selectors are placeholders — real login/search/apply automation against those
sites needs to be inspected live (e.g. `npx playwright codegen <site-login-url>`) and filled in.
This wasn't something that could be verified end-to-end without live testing against those sites.

**Before running real auto-apply against any of these platforms:**
- Only use it against your own account.
- Job sites change their DOM often and actively detect automation (CAPTCHAs, rate limits, account
  flags/bans). Selectors will need maintenance over time.
- Review each platform's Terms of Service — automated login/apply may violate them. This is your
  call to make and monitor, not something baked into the code.
- Keep delays conservative and the daily cap low, especially at first.

## Security notes

- Job-site passwords are encrypted at rest (AES-256-GCM, key from `ENCRYPTION_KEY`) and are only
  decrypted in-memory when automation runs — they're never returned by any API response.
- Every endpoint is scoped to the authenticated user (JWT), so the single local SQLite file safely
  supports multiple accounts.
- `ENCRYPTION_KEY` and `JWT_SECRET` in `.env` are your local dev secrets — don't commit `.env` or
  reuse those values anywhere else (a fresh `.env` with generated secrets was created for you
  during setup; regenerate before any real/shared use).
