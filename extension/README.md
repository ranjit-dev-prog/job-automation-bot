# Job Automation Bot — Chrome Extension

Runs the LinkedIn Easy Apply automation **inside your own logged-in browser tab**, using content
scripts instead of the Playwright bot. It still relies on your existing backend (running locally
at `http://localhost:3000`) for everything that isn't DOM interaction: your profile, AI relevance
scoring, screening-question answers, and recording each application.

## Why this exists instead of "converting" the whole app

Playwright and the NestJS backend cannot run inside a Chrome extension (no Node runtime, no raw
sockets, no external-browser control in a Manifest V3 service worker). This extension is a real
rewrite of just the apply-automation piece — the search/click/fill/submit logic — as plain DOM
code. The backend, database, Angular dashboard, outreach features, and Gmail sending are
**unchanged** and still require the backend server running as before.

## Prerequisites

- The backend running locally: `cd backend && npm run start:dev` (listens on `http://localhost:3000`).
- A job-automation-bot account (register via the Angular dashboard or `POST /auth/login`) with a
  saved **Profile** and at least one **active Job Filter** (`isActive: true`) — the extension reads
  these the same way the Playwright bot does.
- Chrome (or any Chromium-based browser with Manifest V3 support), logged into your LinkedIn
  account in a normal tab.

## No build step

This extension is plain HTML/CSS/JS — there's nothing to compile or bundle, so there are no
dependencies to install. The `extension/` folder itself is the thing you load.

## How to load in Chrome

1. Make sure the backend is running (`npm run start:dev` in `backend/`).
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked**.
5. Select the `extension/` folder (this folder — the one containing `manifest.json`).
6. The extension icon appears in the toolbar. Click it, log in with your job-automation-bot
   account, then click **Start**.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 config — permissions, content script registration, popup, icons. |
| `background.js` | Service worker: Start/Stop state, LinkedIn tab lifecycle, pacing (delay/search-interval/daily cap), and the only place that calls the backend (content-script calls are relayed through here). |
| `content-script.js` | Injected into `linkedin.com` pages. Finds job cards, checks the Easy Apply badge, clicks through the wizard, fills screening questions, submits. Mirrors `backend/src/automation/providers/linkedin.provider.ts`'s logic in plain DOM APIs. Also renders the live status overlay (see below). |
| `overlay.css` | Styles for the glowing page-border + corner badge that shows automation status directly on the LinkedIn tab. |
| `popup.html` / `popup.js` / `popup.css` | Toolbar popup: login, Start/Stop, live status, link to the full dashboard. |
| `icons/icon16.png`, `icon48.png`, `icon128.png` | Generated placeholder icons (solid badge design) — replace with your own art if you want. |

## Backend changes made to support this

- **`backend/src/extension/`** (new module) — `extension.module.ts`, `extension.controller.ts`,
  `extension.service.ts`, `dto/*.ts`. Exposes `GET /extension/context`, `POST /extension/score`,
  `POST /extension/answer`, `POST /extension/applications`, reusing the exact same matching
  (`job-matching.util.ts`), screening-rule (`screening-answer.util.ts`), and AI (`ai.service.ts`)
  logic the Playwright bot uses — so a job applied to via the extension is scored and answered
  identically to one applied to via the dashboard's automation, and both write to the same
  `Application` table.
- **`backend/src/app.module.ts`** — registered `ExtensionModule`.
- **`backend/src/main.ts`** — CORS now also allows `chrome-extension://` origins (a locally loaded
  "unpacked" extension gets a random id, so this can't be pinned to one exact origin).

No other backend files were changed — the Playwright automation, dashboard, outreach, and mail
features are untouched.

## How it works, end to end

1. You click **Start** in the popup. The service worker opens (or reuses) a LinkedIn tab and
   navigates it to a jobs-search URL built from your active filter (same query params the
   Playwright bot used: `keywords`, `location`, `f_WT=2` for remote, `f_AL=true` for Easy-Apply-only).
2. Every ~1 minute (`chrome.alarms`, the MV3-safe replacement for `setInterval`), the service
   worker asks the content script to run one cycle, but only if enough time has passed since the
   last one (your filter's `delaySeconds`).
3. The content script: fetches `/extension/context` (profile, filter, already-applied job URLs),
   picks the next un-applied Easy Apply card, clicks it (a normal in-page click — LinkedIn updates
   its detail pane without a full page reload), scores relevance via `/extension/score` (skipped
   entirely if your filter has "direct apply" on), and — if it clears your minimum match score —
   clicks "Easy Apply" and works through the wizard, resolving each screening question via the
   same deterministic rules the Playwright bot uses, falling back to `/extension/answer` (AI) only
   when the rules don't cover it.
4. Every outcome (APPLIED, SKIPPED, FAILED, MANUAL_ACTION_REQUIRED) is POSTed to
   `/extension/applications` and shows up in the dashboard's Applications tab exactly like a
   Playwright-driven application would.
5. A `MANUAL_ACTION_REQUIRED` result (CAPTCHA, OTP, a required question nothing can answer) stops
   automation the same way the Playwright bot does — it does not keep retrying a blocker.

## Live status overlay

While automation is running, the LinkedIn tab shows a glowing border (blue while actively working
or searching, dimmer blue while idle-but-active and waiting out the pacing delay, red if it hits
an error or needs manual action) plus a small badge in the bottom-right corner with a text status —
so it's obvious at a glance whether the bot is alive and what it's doing, without needing to open
the popup. It's driven by `chrome.storage.onChanged`, so it updates the instant `background.js`
changes state, and disappears entirely when automation isn't running.

## Speed

Wizard-step transitions (after clicking Next/Review/Continue) wait for LinkedIn's re-render to
actually finish (`MutationObserver`-based) instead of a fixed sleep, so a fast render doesn't
waste time waiting out a conservative fixed delay. Relevance scoring and screening-question
answers are Gemini-backed end to end (`/extension/score` and `/extension/answer` — see "How it
works" above) whenever `AI_PROVIDER=gemini` is configured in the backend's `.env`; the
deterministic rules in `screening-answer.util.ts` are checked first only because they're free and
instant, with Gemini as the fallback for anything they don't cover.

## Known limitations (read before relying on this)

- **Programmatic clicks can be detected.** Clicking DOM elements via `element.click()` produces an
  event with `isTrusted: false`. Most of LinkedIn's UI doesn't check this, but if a specific button
  ever does, that click will silently do nothing — this is an inherent limitation of any
  content-script-based automation, not something fixable without a different approach entirely.
- **LinkedIn's markup changes.** Like the Playwright provider, this targets stable-ish signals
  (`a[href*="/jobs/view/"]`, button text like "Easy Apply"/"Submit application") rather than
  generated class names, but LinkedIn redesigns occasionally and selectors may need updating.
- **One account at a time.** The extension automates whatever LinkedIn account is logged into that
  Chrome profile's tab — same as the Playwright bot only automating the credentials you gave it.
- **The backend must be running and reachable at `http://localhost:3000`.** If you change the
  backend's port or run it elsewhere, update `BACKEND_URL` at the top of `background.js`,
  `content-script.js`'s relay (it goes through `background.js`, so only that file needs it), and
  `popup.js`, and add the new origin to `host_permissions` in `manifest.json`.
- **Only Chromium-based browsers.** Manifest V3 with `chrome.alarms`/`chrome.storage`/service
  workers is Chrome/Edge/Brave-class; this will not load in Firefox without a separate MV2/MV3
  Firefox port.

## Common Chrome-extension errors and how this project avoids them

- **CSP violations** — no inline `<script>`/`onclick=` attributes anywhere; `popup.html` loads
  `popup.js` as an external file, which is all Manifest V3's default CSP allows.
- **Broken asset paths** — icons are referenced as `icons/icon16.png` etc., relative to the
  extension root, matching where `manifest.json` actually places them.
- **Service worker "not registered" errors** — `background.js` has no top-level `await` or
  long-lived timers (`setInterval`) that would keep it artificially alive or crash on suspend;
  everything is event-driven (`onMessage`, `onAlarm`) and re-reads state from `chrome.storage`
  each time, which is the correct MV3 pattern for a service worker that gets suspended and woken
  repeatedly.
- **CORS failures** — every backend call goes through the background service worker (which reliably
  gets the CORS bypass MV3 grants for declared `host_permissions`), not the content script (where
  that same bypass isn't consistently documented) — see the comment at the top of `background.js`.
  The backend's own CORS config was also updated to explicitly allow `chrome-extension://` origins,
  as a second layer.
- **Unsupported Node.js APIs** — none used. Both `background.js` and `content-script.js` are plain
  browser JS (`fetch`, `chrome.*`, DOM APIs) with zero Node-specific calls.
- **Over-broad permissions** — only `storage`, `tabs`, and `alarms`, each actually used (see the
  Files table above); `host_permissions` is limited to `linkedin.com` and the local backend, not
  `<all_urls>`.
