const BACKEND_URL = 'http://localhost:3000';
const DASHBOARD_URL = 'http://localhost:4200';

const loginView = document.getElementById('loginView');
const mainView = document.getElementById('mainView');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const statusBadge = document.getElementById('statusBadge');
const appliedCount = document.getElementById('appliedCount');
const lastError = document.getElementById('lastError');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardLink = document.getElementById('dashboardLink');
const logoutBtn = document.getElementById('logoutBtn');

dashboardLink.href = DASHBOARD_URL;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function showView(loggedIn) {
  loginView.hidden = loggedIn;
  mainView.hidden = !loggedIn;
}

async function refreshStatus() {
  const state = await sendMessage({ action: 'GET_STATUS' });
  if (!state || !state.token) {
    showView(false);
    return;
  }
  showView(true);
  statusBadge.textContent = state.running ? state.status.replace(/_/g, ' ') : 'stopped';
  statusBadge.className = 'badge' + (state.running && state.status !== 'error' ? ' running' : '') + (state.status === 'error' || state.status === 'manual_action_required' ? ' ' + state.status : '');
  appliedCount.textContent = `${state.appliedCount} applied today's session`;
  if (state.lastError) {
    lastError.textContent = state.lastError;
    lastError.hidden = false;
  } else {
    lastError.hidden = true;
  }
  startBtn.hidden = state.running;
  stopBtn.hidden = !state.running;
}

loginBtn.addEventListener('click', async () => {
  loginError.hidden = true;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    loginError.textContent = 'Enter both email and password.';
    loginError.hidden = false;
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';
  try {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Login failed (${res.status})`);
    }
    const { accessToken } = await res.json();
    await sendMessage({ action: 'SET_TOKEN', token: accessToken });
    passwordInput.value = '';
    await refreshStatus();
  } catch (err) {
    loginError.textContent = err.message || 'Could not reach the backend — is it running on localhost:3000?';
    loginError.hidden = false;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log in';
  }
});

startBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'START' });
  await refreshStatus();
});

stopBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'STOP' });
  await refreshStatus();
});

logoutBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'LOGOUT' });
  showView(false);
});

refreshStatus();
const pollTimer = setInterval(refreshStatus, 1500);
window.addEventListener('unload', () => clearInterval(pollTimer));
