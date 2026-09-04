// Service worker: owns Start/Stop state, the LinkedIn tab lifecycle, and every call to the
// backend API. The DOM automation itself lives in content-script.js, but that script relays its
// backend calls through here (BACKEND_FETCH messages) rather than calling fetch() directly —
// MV3's CORS bypass for a declared host_permission is reliably documented for extension pages and
// the background service worker, not for content-script fetches (those still run in the page's
// network context), so routing everything through the background avoids a silent CORS failure.
// This file also ticks the LinkedIn tab on a schedule via chrome.alarms (setInterval doesn't
// survive MV3 service-worker suspension, alarms do).

const BACKEND_URL = 'http://localhost:3000';
const TICK_ALARM = 'automation-tick';
const DEFAULT_DELAY_SECONDS = 45;
const DEFAULT_SEARCH_INTERVAL_MINUTES = 5;

async function getState() {
  const { token, running, tabId, lastCycleAt, lastSearchAt, status, lastError, appliedCount } = await chrome.storage.local.get([
    'token',
    'running',
    'tabId',
    'lastCycleAt',
    'lastSearchAt',
    'status',
    'lastError',
    'appliedCount',
  ]);
  return {
    token: token ?? null,
    running: running ?? false,
    tabId: tabId ?? null,
    lastCycleAt: lastCycleAt ?? 0,
    lastSearchAt: lastSearchAt ?? 0,
    status: status ?? 'idle',
    lastError: lastError ?? null,
    appliedCount: appliedCount ?? 0,
  };
}

function setState(patch) {
  return chrome.storage.local.set(patch);
}

function buildSearchUrl(filter) {
  const params = new URLSearchParams({ keywords: filter.keywords });
  if (filter.location) params.set('location', filter.location);
  if (filter.remoteOnly) params.set('f_WT', '2');
  if (filter.easyApplyOnly) params.set('f_AL', 'true');
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function fetchContext(token) {
  const res = await fetch(`${BACKEND_URL}/extension/context`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Backend returned ${res.status} for /extension/context`);
  return res.json();
}

/**
 * Generic authenticated proxy for content-script → backend calls (see the file-level comment for
 * why this goes through the background instead of a direct content-script fetch). `path` is a
 * route under BACKEND_URL, e.g. "/extension/score".
 */
async function backendFetch(path, method, body) {
  const { token } = await getState();
  if (!token) throw new Error('Not signed in — open the extension popup and log in.');
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message || `Backend returned ${res.status} for ${path}`;
    throw new Error(Array.isArray(message) ? message.join('; ') : message);
  }
  return data;
}

/** Finds the extension's LinkedIn jobs tab if it's still open, else creates one. */
async function ensureLinkedInTab(searchUrl) {
  const { tabId } = await getState();
  if (tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) return tab;
  }
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });
  await setState({ tabId: tab.id });
  return tab;
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function runOneCycle() {
  const state = await getState();
  if (!state.running || !state.token) return;

  let context;
  try {
    context = await fetchContext(state.token);
  } catch (err) {
    await setState({ status: 'error', lastError: `Could not reach backend: ${err.message}` });
    return;
  }

  if (!context.filter) {
    await setState({ status: 'error', lastError: 'No active job filter — create one in the dashboard first.' });
    return;
  }
  if (context.appliedToday >= context.filter.maxApplicationsPerDay) {
    await setState({ status: 'daily_cap_reached', lastError: null });
    return;
  }

  const delayMs = (context.filter.delaySeconds || DEFAULT_DELAY_SECONDS) * 1000;
  if (Date.now() - state.lastCycleAt < delayMs) return; // still inside the pacing window

  const searchUrl = buildSearchUrl(context.filter);
  const tab = await ensureLinkedInTab(searchUrl);

  const onSearchPage = (tab.url || '').startsWith('https://www.linkedin.com/jobs/search/');
  // Re-issue the search (fresh navigation) either because the tab isn't even on the results page
  // yet, or because the last search has gone stale — same "queue is dry, look again periodically"
  // behavior as the Playwright bot's searchIntervalMinutes, since re-visiting the same loaded
  // results page forever would never pick up newly-posted jobs.
  const searchIntervalMs = (context.filter.searchIntervalMinutes || DEFAULT_SEARCH_INTERVAL_MINUTES) * 60_000;
  const searchIsStale = state.status === 'waiting_for_new_jobs' && Date.now() - state.lastSearchAt >= searchIntervalMs;
  if (!onSearchPage || searchIsStale) {
    await chrome.tabs.update(tab.id, { url: searchUrl });
    await waitForTabComplete(tab.id);
    await setState({ lastCycleAt: Date.now(), lastSearchAt: Date.now(), status: 'searching' });
    return; // content script will have just (re)injected; try the actual cycle on the next tick
  }

  await setState({ status: 'working' });
  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { action: 'RUN_CYCLE' });
  } catch (err) {
    // Most commonly: the content script hasn't loaded yet on a freshly (re)opened tab.
    await setState({ lastCycleAt: Date.now(), status: 'searching', lastError: `Tab not ready: ${err.message}` });
    return;
  }

  await setState({ lastCycleAt: Date.now() });

  if (!result) {
    await setState({ status: 'error', lastError: 'Content script returned no result' });
    return;
  }
  if (result.type === 'NO_CANDIDATE') {
    await setState({ status: 'waiting_for_new_jobs', lastError: null });
    return;
  }
  if (result.type === 'ERROR') {
    await setState({ status: 'error', lastError: result.message });
    return;
  }
  if (result.type === 'RESULT') {
    const nextCount = result.status === 'APPLIED' ? state.appliedCount + 1 : state.appliedCount;
    await setState({
      status: result.status === 'MANUAL_ACTION_REQUIRED' ? 'manual_action_required' : 'idle',
      lastError: result.status === 'MANUAL_ACTION_REQUIRED' ? result.errorMessage : null,
      appliedCount: nextCount,
      running: result.status === 'MANUAL_ACTION_REQUIRED' ? false : state.running, // same as the Playwright bot: pause on a blocker, don't keep hammering it
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) runOneCycle().catch((err) => setState({ status: 'error', lastError: err.message }));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.action === 'START') {
      await setState({ running: true, status: 'starting', lastError: null });
      await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
      runOneCycle().catch((err) => setState({ status: 'error', lastError: err.message }));
      sendResponse({ ok: true });
    } else if (message.action === 'STOP') {
      await setState({ running: false, status: 'idle' });
      await chrome.alarms.clear(TICK_ALARM);
      sendResponse({ ok: true });
    } else if (message.action === 'GET_STATUS') {
      sendResponse(await getState());
    } else if (message.action === 'SET_TOKEN') {
      await setState({ token: message.token });
      sendResponse({ ok: true });
    } else if (message.action === 'LOGOUT') {
      await setState({ token: null, running: false, status: 'idle' });
      await chrome.alarms.clear(TICK_ALARM);
      sendResponse({ ok: true });
    } else if (message.action === 'BACKEND_FETCH') {
      try {
        const data = await backendFetch(message.path, message.method, message.body);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    }
  })();
  return true; // keep the message channel open for the async response above
});
