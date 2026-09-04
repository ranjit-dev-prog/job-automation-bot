// Runs the actual Easy Apply automation directly in the user's own logged-in LinkedIn tab — the
// content-script equivalent of automation/providers/linkedin.provider.ts's Playwright code, using
// plain DOM APIs and polling waits instead of Playwright locators/auto-waiting. Every backend call
// (profile/context, relevance scoring, screening-question answers, reporting a result) is relayed
// through background.js via chrome.runtime.sendMessage rather than fetched directly — see
// background.js's file comment for why (CORS bypass for host_permissions isn't reliably
// documented for content-script fetches, only for extension pages/the service worker).

const MAX_WIZARD_STEPS = 10;

/** Relays one backend call through the background service worker. Throws on any failure. */
async function backendCall(path, method, body) {
  const response = await chrome.runtime.sendMessage({ action: 'BACKEND_FETCH', path, method, body });
  if (!response?.ok) throw new Error(response?.error || 'Background relay failed');
  return response.data;
}

// --- Live status overlay ------------------------------------------------------------------
// A glowing page border + a small badge in the corner, so it's obvious at a glance whether the
// bot is idle, actively working a job, waiting out its pacing delay, or stuck on something that
// needs you. Driven by chrome.storage.onChanged (push, not polling) so it updates the instant
// background.js changes state — no setInterval loop needed for this.

const STATUS_LABELS = {
  idle: 'Job Bot — stopped',
  starting: 'Job Bot — starting…',
  searching: 'Job Bot — searching LinkedIn…',
  working: 'Job Bot — applying (Gemini-assisted)…',
  waiting_for_new_jobs: 'Job Bot — active, waiting for new listings',
  daily_cap_reached: 'Job Bot — daily application cap reached',
  manual_action_required: 'Job Bot — needs you (manual action required)',
  error: 'Job Bot — error, see popup',
};

function ensureOverlayElements() {
  let border = document.getElementById('jab-status-overlay');
  if (!border) {
    border = document.createElement('div');
    border.id = 'jab-status-overlay';
    document.documentElement.appendChild(border);
  }
  let badge = document.getElementById('jab-status-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'jab-status-badge';
    badge.innerHTML = '<span class="jab-dot"></span><span class="jab-label"></span>';
    document.documentElement.appendChild(badge);
  }
  return { border, badge };
}

function renderOverlay(running, status) {
  const { border, badge } = ensureOverlayElements();
  border.classList.remove('jab-active', 'jab-waiting', 'jab-alert');
  badge.classList.remove('jab-active', 'jab-alert', 'jab-visible');

  if (!running) return; // no overlay at all when automation isn't running

  const isAlert = status === 'error' || status === 'manual_action_required';
  const isActive = status === 'working' || status === 'searching' || status === 'starting';

  border.classList.add(isAlert ? 'jab-alert' : isActive ? 'jab-active' : 'jab-waiting');
  badge.classList.add('jab-visible', isAlert ? 'jab-alert' : 'jab-active');
  badge.querySelector('.jab-label').textContent = STATUS_LABELS[status] || `Job Bot — ${status}`;
}

async function initOverlay() {
  const { running, status } = await chrome.storage.local.get(['running', 'status']);
  renderOverlay(running, status || 'idle');
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('running' in changes || 'status' in changes) initOverlay();
});

initOverlay();

const BLOCKER_PATTERNS = [
  { pattern: /captcha/i, reason: 'a CAPTCHA challenge' },
  { pattern: /one[- ]?time password|verification code|\bOTP\b/i, reason: 'an OTP/verification code prompt' },
  { pattern: /credit card|debit card|card number|payment (details|information)|bank account number/i, reason: 'a payment/financial-details request' },
];

function detectBlocker(pageText) {
  for (const { pattern, reason } of BLOCKER_PATTERNS) {
    if (pattern.test(pageText)) return reason;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 120) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

/**
 * Waits for the page to actually change after an action (clicking Next, etc.) instead of a fixed
 * sleep — a MutationObserver fires the moment LinkedIn's re-render happens, which is usually much
 * faster than a conservative fixed delay, and a fixed delay would either be too slow (wasting
 * time on a fast render) or too fast (risking a stale-DOM read on a slow one). `minSettleMs`
 * still applies after the first mutation, since a multi-part re-render can fire several mutations
 * in quick succession and reading mid-render would see a half-updated form.
 */
function waitForDomChange(root, timeoutMs = 3000, minSettleMs = 180) {
  return new Promise((resolve) => {
    let settled = false;
    let settleTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(settleTimer);
      clearTimeout(timeoutTimer);
      observer.disconnect();
      resolve();
    };

    const observer = new MutationObserver(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, minSettleMs);
    });
    const timeoutTimer = setTimeout(finish, timeoutMs); // fallback if nothing ever mutates

    observer.observe(root, { childList: true, subtree: true, attributes: true });
  });
}

function isVisible(el) {
  return !!(el && el.offsetParent !== null && el.getClientRects().length > 0);
}

function findButtonsByText(regex) {
  return [...document.querySelectorAll('button')].filter((b) => isVisible(b) && regex.test((b.innerText || '').trim()));
}

function findButtonByText(regex) {
  return findButtonsByText(regex)[0] || null;
}

async function fetchScore(jobTitle, jobDescription) {
  return backendCall('/extension/score', 'POST', { jobTitle, jobDescription: (jobDescription || '').slice(0, 6000) });
}

async function fetchAnswer(question) {
  return backendCall('/extension/answer', 'POST', { question }); // { kind, value } or null
}

async function reportApplication(result) {
  // The backend's DTO validation rejects unknown fields (forbidNonWhitelisted) — strip the
  // internal `type` discriminator ('RESULT') before sending, only the actual Application fields.
  const { jobTitle, company, jobUrl, status, matchScore, errorMessage } = result;
  await backendCall('/extension/applications', 'POST', { jobTitle, company, jobUrl, status, matchScore, errorMessage }).catch(
    () => undefined, // best-effort — a failed report shouldn't crash the cycle
  );
}

// The backend resolves each question (Gemini first, deterministic rules as fallback — see
// extension.service.ts) so this is a thin pass-through, not a second decision point. Callers
// still pass `profile` for symmetry with fillKnownScreeningFields' other call sites; unused here.
async function resolveAnswer(_profile, label) {
  return fetchAnswer(label).catch(() => null);
}

function labelFor(el) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label && label.innerText) return label.innerText.trim();
  }
  return '';
}

async function fillKnownScreeningFields(profile) {
  const textInputs = [...document.querySelectorAll('input[type="text"], input[type="number"], textarea')].filter(isVisible);
  for (const input of textInputs) {
    if (input.value) continue;
    const label = labelFor(input);
    if (!label) continue;
    const answer = await resolveAnswer(profile, label);
    if (answer) {
      input.value = answer.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  const selects = [...document.querySelectorAll('select')].filter(isVisible);
  for (const select of selects) {
    const label = labelFor(select);
    if (!label) continue;
    const answer = await resolveAnswer(profile, label);
    if (!answer) continue;
    const option = [...select.options].find((o) => o.text.trim().toLowerCase() === answer.value.trim().toLowerCase());
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  const fieldsets = [...document.querySelectorAll('fieldset')].filter(isVisible);
  for (const fieldset of fieldsets) {
    if (fieldset.querySelector('input[type="radio"]:checked')) continue;
    const legend = fieldset.querySelector('legend');
    const legendText = legend ? legend.innerText.trim() : '';
    if (!legendText) continue;
    const answer = await resolveAnswer(profile, legendText);
    if (!answer) continue;
    const labels = [...fieldset.querySelectorAll('label')].filter(isVisible);
    const option = labels.find((l) => l.innerText.trim().toLowerCase() === answer.value.trim().toLowerCase());
    if (option) option.click();
  }
}

function findUnansweredRequiredField() {
  const required = [...document.querySelectorAll('input[required], select[required], textarea[required]')].filter(isVisible);
  for (const field of required) {
    if (field.type === 'radio' || field.type === 'checkbox') continue;
    if (!field.value) return labelFor(field) || 'an unlabeled required field';
  }
  const fieldsets = [...document.querySelectorAll('fieldset')].filter(isVisible);
  for (const fieldset of fieldsets) {
    const radios = fieldset.querySelectorAll('input[type="radio"]');
    if (radios.length === 0) continue;
    if (!fieldset.querySelector('input[type="radio"]:checked')) {
      const legend = fieldset.querySelector('legend');
      return (legend && legend.innerText.trim()) || 'an unanswered question';
    }
  }
  return null;
}

async function runWizardStep(profile) {
  const blocker = detectBlocker(document.body.innerText);
  if (blocker) return { done: false, blocked: blocker };

  await fillKnownScreeningFields(profile);

  const submitButton = findButtonByText(/^Submit application$/);
  if (submitButton) {
    submitButton.click();
    return { done: true };
  }
  const nextButton = findButtonByText(/^(Next|Review|Continue)$/);
  if (nextButton) {
    nextButton.click();
    await waitForDomChange(document.body); // faster than a fixed sleep once LinkedIn's re-render settles
    return { done: false };
  }
  const unanswered = findUnansweredRequiredField();
  if (unanswered) return { done: false, unanswered };
  return { done: false, stuck: true };
}

function getJobCards() {
  const links = [...document.querySelectorAll('a[href*="/jobs/view/"]')];
  const seen = new Set();
  const cards = [];
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const url = new URL(href, location.origin).toString().split('?')[0];
    if (seen.has(url)) continue;
    const title = (link.innerText || '').trim().split('\n')[0].trim();
    if (!title) continue;
    const card = link.closest('li');
    const cardText = card ? card.innerText || '' : '';
    const lines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);
    const titleIdx = lines.indexOf(title);
    const company = titleIdx >= 0 && lines[titleIdx + 1] ? lines[titleIdx + 1] : undefined;
    seen.add(url);
    cards.push({ link, title, company, url, hasEasyApplyBadge: /Easy Apply/i.test(cardText) });
  }
  return cards;
}

function getJobDescriptionText() {
  const el = document.querySelector('.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text');
  return el ? el.innerText : '';
}

async function runCycle() {
  let context;
  try {
    context = await backendCall('/extension/context', 'GET');
  } catch (err) {
    return { type: 'ERROR', message: err.message };
  }
  if (!context.filter) return { type: 'ERROR', message: 'No active job filter configured in the dashboard.' };

  const recentUrls = new Set(context.recentUrls || []);
  const cards = getJobCards();
  const candidate = cards.find(
    (c) => !recentUrls.has(c.url) && (!context.filter.easyApplyOnly || c.hasEasyApplyBadge),
  );
  if (!candidate) return { type: 'NO_CANDIDATE' };

  candidate.link.click(); // SPA navigation to the detail pane — the page itself doesn't reload
  await waitFor(() => findButtonByText(/Easy Apply/i) || getJobDescriptionText(), 8000);

  let matchScore;
  if (!context.filter.directApply) {
    const description = getJobDescriptionText();
    try {
      const scoreResult = await fetchScore(candidate.title, description);
      matchScore = scoreResult.score;
    } catch (err) {
      return { type: 'ERROR', message: `Relevance scoring failed: ${err.message}` };
    }
    if (matchScore < context.filter.minMatchScore) {
      const result = {
        type: 'RESULT',
        status: 'SKIPPED',
        jobTitle: candidate.title,
        company: candidate.company,
        jobUrl: candidate.url,
        matchScore,
        errorMessage: `Not relevant — scored ${matchScore}% (minimum ${context.filter.minMatchScore}%).`,
      };
      await reportApplication(result);
      return result;
    }
  }

  const easyApplyButton = findButtonByText(/Easy Apply/i);
  if (!easyApplyButton) {
    const result = {
      type: 'RESULT',
      status: 'SKIPPED',
      jobTitle: candidate.title,
      company: candidate.company,
      jobUrl: candidate.url,
      matchScore,
      errorMessage: 'No "Easy Apply" button — this job requires applying on an external site.',
    };
    await reportApplication(result);
    return result;
  }

  easyApplyButton.click();
  const modalOpened = await waitFor(() => findButtonByText(/^(Next|Review|Continue|Submit application)$/), 10000);
  if (!modalOpened) {
    const result = {
      type: 'RESULT',
      status: 'FAILED',
      jobTitle: candidate.title,
      company: candidate.company,
      jobUrl: candidate.url,
      matchScore,
      errorMessage: 'Clicked "Easy Apply" but the application form never appeared.',
    };
    await reportApplication(result);
    return result;
  }

  const profile = context.profile;
  for (let step = 0; step < MAX_WIZARD_STEPS; step++) {
    let outcome;
    try {
      outcome = await runWizardStep(profile);
    } catch (err) {
      const result = {
        type: 'RESULT',
        status: 'FAILED',
        jobTitle: candidate.title,
        company: candidate.company,
        jobUrl: candidate.url,
        matchScore,
        errorMessage: `Wizard step failed: ${err.message}`,
      };
      await reportApplication(result);
      return result;
    }
    if (outcome.blocked) {
      const result = {
        type: 'RESULT',
        status: 'MANUAL_ACTION_REQUIRED',
        jobTitle: candidate.title,
        company: candidate.company,
        jobUrl: candidate.url,
        matchScore,
        errorMessage: `Easy Apply step appears to require ${outcome.blocked} — needs manual completion.`,
      };
      await reportApplication(result);
      return result;
    }
    if (outcome.done) {
      const result = { type: 'RESULT', status: 'APPLIED', jobTitle: candidate.title, company: candidate.company, jobUrl: candidate.url, matchScore };
      await reportApplication(result);
      return result;
    }
    if (outcome.unanswered) {
      const result = {
        type: 'RESULT',
        status: 'MANUAL_ACTION_REQUIRED',
        jobTitle: candidate.title,
        company: candidate.company,
        jobUrl: candidate.url,
        matchScore,
        errorMessage: `Easy Apply has a required question the bot can't answer from your profile: "${outcome.unanswered}".`,
      };
      await reportApplication(result);
      return result;
    }
    if (outcome.stuck) {
      const result = {
        type: 'RESULT',
        status: 'SKIPPED',
        jobTitle: candidate.title,
        company: candidate.company,
        jobUrl: candidate.url,
        matchScore,
        errorMessage: 'Easy Apply form has extra required fields this bot cannot fill in automatically.',
      };
      await reportApplication(result);
      return result;
    }
  }
  const result = {
    type: 'RESULT',
    status: 'SKIPPED',
    jobTitle: candidate.title,
    company: candidate.company,
    jobUrl: candidate.url,
    matchScore,
    errorMessage: 'Could not complete the Easy Apply flow within the expected number of steps.',
  };
  await reportApplication(result);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'RUN_CYCLE') {
    runCycle()
      .then(sendResponse)
      .catch((err) => sendResponse({ type: 'ERROR', message: err.message }));
    return true; // async response
  }
  return false;
});
