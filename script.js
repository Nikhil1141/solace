/**
 * SOLACE — Personal Diary & Task Manager
 * script.js | Supabase cloud edition
 *
 * ╔══════════════════════════════════════════════════════╗
 * ║  SETUP — Replace the two values below with yours    ║
 * ║  1. Go to https://supabase.com → New Project        ║
 * ║  2. Settings → API → copy URL + anon public key     ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Sections:
 *  0. Supabase config & client
 *  1. State
 *  2. Boot
 *  3. Auth (sign up / sign in / sign out)
 *  4. Navigation
 *  5. Lock / PIN
 *  6. Theme
 *  7. Dashboard
 *  8. Diary  (CRUD → Supabase)
 *  9. Todo   (CRUD → Supabase)
 * 10. Calendar
 * 11. Settings
 * 12. PDF Export
 * 13. Sync helpers
 * 14. Toast, Modal, Utilities
 */

/* ============================================================
   0. SUPABASE CONFIG
   ============================================================
   ⚠️  REPLACE these two strings with your own project values.
   Get them free at https://supabase.com
   ============================================================ */
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // e.g. https://xyzabc.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // long JWT string starting with eyJ…

// ── Initialise Supabase client ──────────────────────────────
const CONFIGURED = SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';

let supabase = null;
if (CONFIGURED) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ============================================================
   1. STATE
   ============================================================ */

// LocalStorage keys (only for UI prefs — NOT app data)
const LS = {
  theme:      'solace_theme',
  pinEnabled: 'solace_pin_enabled',
  passcode:   'solace_passcode',
};

let state = {
  user:            null,          // Supabase user object
  entries:         [],            // diary entries (in-memory, loaded from DB)
  todos:           [],            // todos        (in-memory, loaded from DB)
  currentPage:     'dashboard',
  editingEntryId:  null,
  diaryFilter:     '',
  todoFilter:      'all',
  calYear:         new Date().getFullYear(),
  calMonth:        new Date().getMonth(),
  calSelectedDate: null,
  autosaveTimer:   null,
  syncing:         false,
};

/* ============================================================
   2. BOOT
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  applyTheme();

  // Register auth UI listeners exactly once, here, at boot
  initAuthUI();
  initOfflineDetection();

  // Not configured — show auth screen with a setup notice, disable all actions
  if (!CONFIGURED) {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('app').classList.add('hidden');
    document.getElementById('configNotice').classList.remove('hidden');
    document.querySelector('.auth-tabs').style.visibility = 'hidden';
    document.getElementById('loginBtn').disabled  = true;
    document.getElementById('signupBtn').disabled = true;
    document.getElementById('forgotBtn').disabled = true;
    lucide.createIcons();
    return;
  }

  showLoadingOverlay();

  // Auth state listener — fires on sign-in, sign-out, token refresh
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      state.user = session.user;
      if (!state.booted) {
        state.booted = true;
        await bootApp();
      }
    } else if (event === 'SIGNED_OUT') {
      state.user   = null;
      state.booted = false;
      resetAppState();
      hideLoadingOverlay();
      // Show auth screen without re-calling initAuthUI
      document.getElementById('authScreen').style.display = 'flex';
      document.getElementById('app').classList.add('hidden');
    } else if (event === 'TOKEN_REFRESHED' && session) {
      state.user = session.user;
    }
  });

  // Check for an existing session on page load
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    hideLoadingOverlay();
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('app').classList.add('hidden');
  }
});

async function bootApp() {
  hideAuthScreen();
  checkLock();

  // Load data from Supabase
  await Promise.all([loadEntries(), loadTodos()]);

  // Init all modules
  initNav();
  initDashboard();
  initDiary();
  initTodo();
  initCalendar();
  initSettings();
  updateGreeting();
  updateStats();
  updateUserUI();
  subscribeRealtime();

  hideLoadingOverlay();
  document.getElementById('app').classList.remove('hidden');
  lucide.createIcons();
}

function resetAppState() {
  state.entries        = [];
  state.todos          = [];
  state.user           = null;
  state.editingEntryId = null;
}

/* ── Loading overlay ── */
function showLoadingOverlay() {
  if (document.getElementById('loadingOverlay')) return;
  const el = document.createElement('div');
  el.id = 'loadingOverlay';
  el.className = 'loading-overlay';
  el.innerHTML = `
    <div class="logo">
      <span class="logo-icon"><i data-lucide="feather"></i></span>
      <span class="logo-text">Solace</span>
    </div>
    <div class="loading-dots"><span></span><span></span><span></span></div>`;
  document.body.appendChild(el);
  lucide.createIcons();
}

function hideLoadingOverlay() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.remove();
}

/* ── Offline detection ── */
function initOfflineDetection() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.id = 'offlineBanner';
  banner.textContent = '⚡ You are offline — changes will sync when reconnected';
  document.body.prepend(banner);

  window.addEventListener('offline', () => banner.classList.add('show'));
  window.addEventListener('online',  () => {
    banner.classList.remove('show');
    // Re-sync when back online
    if (state.user) { loadEntries(); loadTodos(); }
  });
}

/* ============================================================
   3. AUTH
   ============================================================ */

function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('app').classList.add('hidden');
  // Reset form state cleanly without re-attaching listeners
  switchAuthTab('login');
}

function hideAuthScreen() {
  document.getElementById('authScreen').style.display = 'none';
}

/* switchAuthTab — called at boot and when user clicks a tab */
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.auth-form').forEach(f => {
    f.classList.toggle('active', f.id === `${tab}Form`);
  });
  // Clear errors when switching tabs
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('signupError').classList.add('hidden');
  document.getElementById('signupSuccess').classList.add('hidden');
}

function initAuthUI() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
  });

  // Sign In — button + Enter key
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  ['loginEmail', 'loginPassword'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  });

  // Sign Up — button + Enter key
  document.getElementById('signupBtn').addEventListener('click', handleSignup);
  ['signupName', 'signupEmail', 'signupPassword'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleSignup(); });
  });

  // Forgot password
  document.getElementById('forgotBtn').addEventListener('click', handleForgotPassword);
}

async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');

  if (!email || !password) { showAuthError(errEl, 'Please fill in all fields.'); return; }

  setAuthLoading('login', true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setAuthLoading('login', false);

  if (error) {
    showAuthError(errEl, friendlyAuthError(error.message));
  } else {
    errEl.classList.add('hidden');
  }
}

async function handleSignup() {
  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errEl    = document.getElementById('signupError');
  const okEl     = document.getElementById('signupSuccess');

  if (!email || !password) { showAuthError(errEl, 'Please fill in all fields.'); return; }
  if (password.length < 6) { showAuthError(errEl, 'Password must be at least 6 characters.'); return; }

  setAuthLoading('signup', true);
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  setAuthLoading('signup', false);

  if (error) {
    showAuthError(errEl, friendlyAuthError(error.message));
  } else {
    errEl.classList.add('hidden');
    okEl.textContent = '✓ Account created! Check your email to confirm, then sign in.';
    okEl.classList.remove('hidden');
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) { showAuthError(document.getElementById('loginError'), 'Enter your email address first.'); return; }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) {
    showAuthError(document.getElementById('loginError'), error.message);
  } else {
    showToast('📧 Password reset email sent!');
  }
}

async function handleSignOut() {
  await supabase.auth.signOut();
  // onAuthStateChange will handle the rest
}

function showAuthError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setAuthLoading(form, loading) {
  const btn  = document.getElementById(`${form}Btn`);
  const text = document.getElementById(`${form}BtnText`);
  const spin = document.getElementById(`${form}Spinner`);
  btn.disabled = loading;
  text.textContent = loading ? (form === 'login' ? 'Signing in…' : 'Creating account…') : (form === 'login' ? 'Sign In' : 'Create Account');
  spin.classList.toggle('hidden', !loading);
}

function friendlyAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.';
  if (msg.includes('Email not confirmed'))       return 'Please confirm your email first.';
  if (msg.includes('User already registered'))   return 'An account with this email already exists.';
  if (msg.includes('Password should be'))        return 'Password must be at least 6 characters.';
  return msg;
}

function updateUserUI() {
  const user = state.user;
  if (!user) return;

  const name  = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  const email = user.email || '';
  const init  = (name[0] || '?').toUpperCase();

  document.getElementById('userAvatar').textContent = init;
  document.getElementById('userName').textContent   = name;
  document.getElementById('userEmail').textContent  = email;
  document.getElementById('settingsEmail').textContent = email;

  // Sign out buttons
  document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
  document.getElementById('settingsSignOut').addEventListener('click', handleSignOut);
}

/* ============================================================
   4. NAVIGATION
   ============================================================ */

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
      closeSidebar();
    });
  });

  document.querySelectorAll('.text-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
  document.getElementById('lockBtn').addEventListener('click', () => {
    if (localStorage.getItem(LS.pinEnabled) === 'true') lockApp();
  });
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const navEl  = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl)  navEl.classList.add('active');

  const titles = { dashboard:'Dashboard', diary:'My Diary', todo:'Tasks', calendar:'Calendar', settings:'Settings' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  state.currentPage = page;

  if (page === 'dashboard') { updateStats(); renderDashTasks(); }
  if (page === 'diary')     renderEntries();
  if (page === 'todo')      renderTodos();
  if (page === 'calendar')  renderCalendar();
  if (page === 'settings')  syncSettingsUI();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.remove('hidden');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.add('hidden');
}

/* ============================================================
   5. LOCK / PIN
   ============================================================ */

let pinBuffer = '';

function checkLock() {
  const enabled = localStorage.getItem(LS.pinEnabled) === 'true';
  if (enabled && localStorage.getItem(LS.passcode)) showLockScreen();
}

function showLockScreen() {
  document.getElementById('lockScreen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function hideLockScreen() {
  document.getElementById('lockScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function lockApp() {
  pinBuffer = '';
  updatePinDots();
  document.getElementById('pinError').classList.add('hidden');
  showLockScreen();
}

document.querySelectorAll('.pin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.val;
    if (val === 'clear') {
      pinBuffer = pinBuffer.slice(0, -1);
    } else if (val === 'enter') {
      submitPin();
    } else if (pinBuffer.length < 4) {
      pinBuffer += val;
      if (pinBuffer.length === 4) submitPin();
    }
    updatePinDots();
  });
});

function updatePinDots() {
  document.querySelectorAll('#pinDots span').forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinBuffer.length);
  });
}

function submitPin() {
  const saved = localStorage.getItem(LS.passcode);
  if (pinBuffer === saved) {
    hideLockScreen();
    pinBuffer = '';
    updatePinDots();
    document.getElementById('pinError').classList.add('hidden');
  } else {
    document.getElementById('pinError').classList.remove('hidden');
    const card = document.querySelector('.lock-card');
    card.style.transition = 'transform 0.1s';
    card.style.transform = 'translateX(8px)';
    setTimeout(() => { card.style.transform = 'translateX(-8px)'; }, 100);
    setTimeout(() => { card.style.transform = ''; }, 200);
    pinBuffer = '';
    updatePinDots();
  }
}

/* ============================================================
   6. THEME
   ============================================================ */

function applyTheme() {
  const dark = localStorage.getItem(LS.theme) === 'true';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  updateThemeUI(dark);
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const newDark = !isDark;
  localStorage.setItem(LS.theme, newDark);
  document.documentElement.dataset.theme = newDark ? 'dark' : 'light';
  updateThemeUI(newDark);
}

function updateThemeUI(isDark) {
  const icon  = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  const tog   = document.getElementById('darkModeToggle');
  if (icon)  { icon.dataset.lucide = isDark ? 'sun' : 'moon'; lucide.createIcons(); }
  if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  if (tog)   tog.checked = isDark;
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

/* ============================================================
   7. DASHBOARD
   ============================================================ */

function initDashboard() {
  document.getElementById('quickSaveEntry').addEventListener('click', quickSaveDiary);
  document.getElementById('quickAddTask').addEventListener('click', quickAddTask);
  document.getElementById('quickTaskInput').addEventListener('keydown', e => { if (e.key === 'Enter') quickAddTask(); });
}

function updateGreeting() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const emoji = hour < 12 ? '✨' : hour < 17 ? '☀️' : '🌙';
  document.getElementById('greeting').textContent = `${greet} ${emoji}`;
  document.getElementById('greetingDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function updateStats() {
  const today = todayStr();
  const completedToday = state.todos.filter(t => t.done && t.completed_date === today).length;
  const pending        = state.todos.filter(t => !t.done).length;
  document.getElementById('statCompleted').textContent = completedToday;
  document.getElementById('statPending').textContent   = pending;
  document.getElementById('statEntries').textContent   = state.entries.length;
  document.getElementById('statStreak').textContent    = calcStreak(state.entries);
}

function calcStreak(entries) {
  if (!entries.length) return 0;
  const dateset = new Set(entries.map(e => (e.created_at || e.date || '').slice(0, 10)));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (dateset.has(d.toISOString().slice(0, 10))) streak++;
    else break;
  }
  return streak;
}

async function quickSaveDiary() {
  const text = document.getElementById('quickDiaryText').value.trim();
  if (!text) { showToast('Write something first!'); return; }
  await insertEntry({ title: '', text, mood: '' });
  document.getElementById('quickDiaryText').value = '';
  updateStats();
  showToast('✍️ Entry saved!');
}

async function quickAddTask() {
  const input = document.getElementById('quickTaskInput');
  const text  = input.value.trim();
  if (!text) return;
  await insertTodo(text, 'normal');
  input.value = '';
  renderDashTasks();
  updateStats();
}

function renderDashTasks() {
  const list = document.getElementById('dashTaskList');
  const pending = state.todos.filter(t => !t.done).slice(0, 5);
  list.innerHTML = '';
  if (!pending.length) {
    list.innerHTML = '<li style="color:var(--text-3);font-size:0.85rem;padding:8px 0;">All caught up! 🎉</li>';
    return;
  }
  pending.forEach(todo => list.appendChild(buildTaskItem(todo, true)));
  lucide.createIcons();
}

/* ============================================================
   8. DIARY — Supabase CRUD
   ============================================================ */

/* ── Load all entries for this user ── */
async function loadEntries() {
  setSyncState('syncing');
  const { data, error } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('loadEntries:', error); setSyncState('error'); return; }
  state.entries = data || [];
  setSyncState('ok');
}

/* ── Insert new entry ── */
async function insertEntry({ title, text, mood }) {
  setSyncState('syncing');
  const { data, error } = await supabase
    .from('diary_entries')
    .insert([{ user_id: state.user.id, title, text, mood }])
    .select()
    .single();

  if (error) { console.error('insertEntry:', error); setSyncState('error'); showToast('❌ Save failed'); return null; }
  state.entries.unshift(data);
  setSyncState('ok');
  return data;
}

/* ── Update existing entry ── */
async function updateEntry(id, { title, text, mood }) {
  setSyncState('syncing');
  const { data, error } = await supabase
    .from('diary_entries')
    .update({ title, text, mood, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', state.user.id)
    .select()
    .single();

  if (error) { console.error('updateEntry:', error); setSyncState('error'); showToast('❌ Update failed'); return null; }
  const idx = state.entries.findIndex(e => e.id === id);
  if (idx !== -1) state.entries[idx] = data;
  setSyncState('ok');
  return data;
}

/* ── Delete entry ── */
async function deleteEntryDB(id) {
  setSyncState('syncing');
  const { error } = await supabase
    .from('diary_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', state.user.id);

  if (error) { console.error('deleteEntry:', error); setSyncState('error'); showToast('❌ Delete failed'); return false; }
  state.entries = state.entries.filter(e => e.id !== id);
  setSyncState('ok');
  return true;
}

/* ── Diary UI ── */
function initDiary() {
  document.getElementById('newEntryBtn').addEventListener('click', openNewEditor);
  document.getElementById('cancelEntry').addEventListener('click', closeEditor);
  document.getElementById('saveEntry').addEventListener('click', saveCurrentEntry);
  document.getElementById('diarySearch').addEventListener('input', e => {
    state.diaryFilter = e.target.value.toLowerCase();
    renderEntries();
  });
  document.getElementById('entryText').addEventListener('input', scheduleAutosave);
  document.getElementById('entryTitle').addEventListener('input', scheduleAutosave);
  renderEntries();
}

function openNewEditor() {
  state.editingEntryId = null;
  document.getElementById('entryTitle').value = '';
  document.getElementById('entryText').value  = '';
  document.getElementById('entryMood').value  = '';
  document.getElementById('editorDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  showEditor();
}

function openEditEditor(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  state.editingEntryId = id;
  document.getElementById('entryTitle').value = entry.title || '';
  document.getElementById('entryText').value  = entry.text  || '';
  document.getElementById('entryMood').value  = entry.mood  || '';
  document.getElementById('editorDate').textContent = new Date(entry.created_at).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  showEditor();
  document.getElementById('entryText').focus();
}

function showEditor() {
  document.getElementById('entryEditor').classList.remove('hidden');
  document.getElementById('autosaveHint').textContent = '';
  document.getElementById('entryEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  document.getElementById('entryEditor').classList.add('hidden');
  state.editingEntryId = null;
  clearTimeout(state.autosaveTimer);
}

async function saveCurrentEntry() {
  const title = document.getElementById('entryTitle').value.trim();
  const text  = document.getElementById('entryText').value.trim();
  const mood  = document.getElementById('entryMood').value;

  if (!text) { showToast('Write something to save!'); return; }

  const btn = document.getElementById('saveEntry');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  if (state.editingEntryId) {
    await updateEntry(state.editingEntryId, { title, text, mood });
    showToast('✅ Entry updated!');
  } else {
    await insertEntry({ title, text, mood });
    showToast('✍️ Entry saved!');
  }

  btn.disabled = false;
  btn.textContent = 'Save Entry';

  closeEditor();
  renderEntries();
  updateStats();
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  document.getElementById('autosaveHint').textContent = 'Autosaving…';
  state.autosaveTimer = setTimeout(() => {
    const text  = document.getElementById('entryText').value.trim();
    const title = document.getElementById('entryTitle').value.trim();
    if (text) {
      localStorage.setItem('solace_draft', JSON.stringify({ title, text, ts: Date.now() }));
      document.getElementById('autosaveHint').textContent = 'Draft autosaved locally';
    }
  }, 1500);
}

function deleteEntry(id) {
  showConfirm('Delete this diary entry? This cannot be undone.', async () => {
    const ok = await deleteEntryDB(id);
    if (ok) { renderEntries(); updateStats(); showToast('🗑️ Entry deleted'); }
  });
}

function renderEntries() {
  const list   = document.getElementById('diaryEntriesList');
  const empty  = document.getElementById('diaryEmpty');
  const filter = state.diaryFilter;

  let entries = state.entries;
  if (filter) {
    entries = entries.filter(e =>
      (e.title && e.title.toLowerCase().includes(filter)) ||
      (e.text  && e.text.toLowerCase().includes(filter))
    );
  }

  list.innerHTML = '';

  if (!entries.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  entries.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.id = entry.id;

    const titleText = entry.title || 'Untitled Entry';
    const preview   = entry.text.slice(0, 180).replace(/\n/g, ' ');
    const dateStr   = new Date(entry.created_at).toLocaleDateString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric', year: 'numeric'
    });

    const hl = str => {
      if (!filter) return str;
      return str.replace(new RegExp(`(${escapeRegex(filter)})`, 'gi'), '<mark class="highlight">$1</mark>');
    };

    card.innerHTML = `
      <div class="entry-card-header">
        <div class="entry-card-title">${hl(titleText)}</div>
        ${entry.mood ? `<span class="entry-card-mood">${entry.mood}</span>` : ''}
      </div>
      <div class="entry-card-date">${dateStr}</div>
      <div class="entry-card-preview">${hl(preview)}${entry.text.length > 180 ? '…' : ''}</div>
      <div class="entry-card-actions">
        <button class="entry-action-btn edit-btn"><i data-lucide="pencil"></i> Edit</button>
        <button class="entry-action-btn danger del-btn"><i data-lucide="trash-2"></i> Delete</button>
        <button class="entry-action-btn export-single-btn"><i data-lucide="download"></i> PDF</button>
      </div>`;

    card.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); openEditEditor(entry.id); });
    card.querySelector('.del-btn').addEventListener('click', e => { e.stopPropagation(); deleteEntry(entry.id); });
    card.querySelector('.export-single-btn').addEventListener('click', e => { e.stopPropagation(); exportSingleEntry(entry); });
    card.addEventListener('click', () => openEditEditor(entry.id));

    list.appendChild(card);
  });

  lucide.createIcons();
}

/* ============================================================
   9. TODO — Supabase CRUD
   ============================================================ */

async function loadTodos() {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('loadTodos:', error); return; }
  state.todos = data || [];
}

async function insertTodo(text, priority) {
  const { data, error } = await supabase
    .from('todos')
    .insert([{ user_id: state.user.id, text, priority, done: false }])
    .select()
    .single();

  if (error) { console.error('insertTodo:', error); showToast('❌ Save failed'); return null; }
  state.todos.unshift(data);
  setSyncState('ok');
  return data;
}

async function toggleTodoDB(id) {
  const todo = state.todos.find(t => t.id === id);
  if (!todo) return;
  const newDone = !todo.done;
  const { data, error } = await supabase
    .from('todos')
    .update({ done: newDone, completed_date: newDone ? todayStr() : null })
    .eq('id', id)
    .eq('user_id', state.user.id)
    .select()
    .single();

  if (error) { console.error('toggleTodo:', error); return; }
  const idx = state.todos.findIndex(t => t.id === id);
  if (idx !== -1) state.todos[idx] = data;
  updateStats();
  renderTodos();
  if (state.currentPage === 'dashboard') renderDashTasks();
}

async function deleteTodoDB(id) {
  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id)
    .eq('user_id', state.user.id);

  if (error) { console.error('deleteTodo:', error); showToast('❌ Delete failed'); return; }
  state.todos = state.todos.filter(t => t.id !== id);
  renderTodos();
  updateStats();
  if (state.currentPage === 'dashboard') renderDashTasks();
}

function initTodo() {
  document.getElementById('addTodoBtn').addEventListener('click', async () => {
    const input    = document.getElementById('todoInput');
    const priority = document.getElementById('todoPriority').value;
    const text     = input.value.trim();
    if (!text) return;
    input.value = '';
    await insertTodo(text, priority);
    renderTodos();
    updateStats();
  });

  document.getElementById('todoInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('addTodoBtn').click();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.todoFilter = btn.dataset.filter;
      renderTodos();
    });
  });

  renderTodos();
}

function renderTodos() {
  const list  = document.getElementById('todoList');
  const empty = document.getElementById('todoEmpty');
  let todos   = state.todos;

  if (state.todoFilter === 'pending')   todos = todos.filter(t => !t.done);
  if (state.todoFilter === 'completed') todos = todos.filter(t =>  t.done);

  list.innerHTML = '';
  if (!todos.length) { empty.classList.remove('hidden'); updateProgress(); return; }
  empty.classList.add('hidden');

  todos.forEach(todo => list.appendChild(buildTaskItem(todo, false)));
  lucide.createIcons();
  updateProgress();
}

function buildTaskItem(todo, compact) {
  const li = document.createElement('li');
  li.className = `task-item${todo.done ? ' done' : ''}`;

  const checkbox = document.createElement('div');
  checkbox.className = `task-checkbox${todo.done ? ' checked' : ''}`;
  checkbox.addEventListener('click', () => toggleTodoDB(todo.id));

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = todo.text;

  const priority = document.createElement('span');
  priority.className = `task-priority priority-${todo.priority}`;
  priority.textContent = todo.priority === 'high' ? '↑ High' : todo.priority === 'low' ? '↓ Low' : '';

  const del = document.createElement('button');
  del.className = 'task-delete';
  del.innerHTML = '<i data-lucide="x"></i>';
  del.addEventListener('click', () => deleteTodoDB(todo.id));

  li.appendChild(checkbox);
  li.appendChild(text);
  if (!compact) li.appendChild(priority);
  li.appendChild(del);
  return li;
}

function updateProgress() {
  const total     = state.todos.length;
  const completed = state.todos.filter(t => t.done).length;
  const pct       = total ? Math.round((completed / total) * 100) : 0;
  document.getElementById('todoProgressLabel').textContent = `${completed} of ${total} completed`;
  document.getElementById('todoProgressPct').textContent   = `${pct}%`;
  document.getElementById('todoProgressFill').style.width  = `${pct}%`;
}

/* ============================================================
   10. CALENDAR
   ============================================================ */

function initCalendar() {
  document.getElementById('calPrev').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  });
}

function renderCalendar() {
  const year  = state.calYear;
  const month = state.calMonth;
  document.getElementById('calMonthLabel').textContent = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const entryDates = new Set(state.entries.map(e => (e.created_at || '').slice(0, 10)));
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO    = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day other-month';
    blank.textContent = new Date(year, month, 0).getDate() - firstDay + i + 1;
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isoDate = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEl = document.createElement('div');
    dayEl.className = 'cal-day';
    dayEl.textContent = d;
    if (isoDate === todayISO)           dayEl.classList.add('today');
    if (entryDates.has(isoDate))        dayEl.classList.add('has-entry');
    if (state.calSelectedDate === isoDate) dayEl.classList.add('selected');
    dayEl.addEventListener('click', () => { state.calSelectedDate = isoDate; renderCalendar(); showCalDayEntries(isoDate); });
    grid.appendChild(dayEl);
  }

  if (state.calSelectedDate) showCalDayEntries(state.calSelectedDate);
}

function showCalDayEntries(isoDate) {
  const titleEl = document.getElementById('calSelectedDate');
  const listEl  = document.getElementById('calDayEntries');

  titleEl.textContent = new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  const dayEntries = state.entries.filter(e => (e.created_at || '').slice(0, 10) === isoDate);
  listEl.innerHTML = '';
  if (!dayEntries.length) {
    listEl.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem;">No entries for this day.</p>';
    return;
  }

  dayEntries.forEach(entry => {
    const mini = document.createElement('div');
    mini.className = 'cal-entry-mini';
    mini.innerHTML = `
      <div class="cal-entry-mini-title">${entry.mood ? entry.mood + ' ' : ''}${entry.title || 'Untitled Entry'}</div>
      <div class="cal-entry-mini-preview">${entry.text}</div>`;
    mini.style.cursor = 'pointer';
    mini.addEventListener('click', () => { navigateTo('diary'); setTimeout(() => openEditEditor(entry.id), 100); });
    listEl.appendChild(mini);
  });
}

/* ============================================================
   11. SETTINGS
   ============================================================ */

function initSettings() {
  syncSettingsUI();

  document.getElementById('passcodeToggle').addEventListener('change', function () {
    if (this.checked) {
      document.getElementById('pinSetup').classList.remove('hidden');
      localStorage.setItem(LS.pinEnabled, 'true');
    } else {
      document.getElementById('pinSetup').classList.add('hidden');
      localStorage.removeItem(LS.pinEnabled);
      localStorage.removeItem(LS.passcode);
      showToast('Passcode lock disabled');
    }
  });

  document.getElementById('savePinBtn').addEventListener('click', () => {
    const pin = document.getElementById('newPinInput').value.trim();
    if (!/^\d{4}$/.test(pin)) { showToast('PIN must be exactly 4 digits'); return; }
    localStorage.setItem(LS.passcode, pin);
    localStorage.setItem(LS.pinEnabled, 'true');
    document.getElementById('pinSetMsg').classList.remove('hidden');
    document.getElementById('newPinInput').value = '';
    setTimeout(() => document.getElementById('pinSetMsg').classList.add('hidden'), 2500);
    showToast('🔒 PIN saved!');
  });

  document.getElementById('darkModeToggle').addEventListener('change', function () {
    localStorage.setItem(LS.theme, this.checked);
    document.documentElement.dataset.theme = this.checked ? 'dark' : 'light';
    updateThemeUI(this.checked);
  });

  document.getElementById('exportPdfBtn').addEventListener('click', exportAllDiaryPDF);

  document.getElementById('clearDataBtn').addEventListener('click', () => {
    showConfirm('⚠️ Permanently delete ALL diary entries and tasks from the cloud? This cannot be undone.', async () => {
      setSyncState('syncing');
      await supabase.from('diary_entries').delete().eq('user_id', state.user.id);
      await supabase.from('todos').delete().eq('user_id', state.user.id);
      state.entries = [];
      state.todos   = [];
      setSyncState('ok');
      updateStats();
      renderEntries();
      renderTodos();
      showToast('All data cleared from cloud');
    });
  });
}

function syncSettingsUI() {
  document.getElementById('passcodeToggle').checked = localStorage.getItem(LS.pinEnabled) === 'true';
  document.getElementById('darkModeToggle').checked = localStorage.getItem(LS.theme) === 'true';
  lucide.createIcons();
}

/* ============================================================
   12. PDF EXPORT
   ============================================================ */

function exportAllDiaryPDF() {
  if (!state.entries.length) { showToast('No entries to export'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 20, lineH = 7;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(122, 170, 138);
  doc.text('Solace', pageW / 2, 50, { align: 'center' });
  doc.setFontSize(14);
  doc.setTextColor(100, 100, 100);
  doc.text('My Personal Diary', pageW / 2, 62, { align: 'center' });
  doc.setFontSize(10);
  doc.text(`Exported on ${new Date().toLocaleDateString()}`, pageW / 2, 72, { align: 'center' });
  doc.text(`${state.entries.length} entries`, pageW / 2, 80, { align: 'center' });

  state.entries.forEach(entry => {
    doc.addPage();
    let y = margin;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + (entry.mood ? '  ' + entry.mood : ''), margin, y);
    y += lineH;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(44, 40, 37);
    doc.text(entry.title || 'Untitled Entry', margin, y);
    y += lineH * 1.6;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageW - margin, y);
    y += lineH;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(60, 56, 53);
    doc.splitTextToSize(entry.text, pageW - margin * 2).forEach(line => {
      if (y + lineH > pageH - margin) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += lineH;
    });
  });

  doc.save('solace-diary.pdf');
  showToast('📄 PDF exported!');
}

function exportSingleEntry(entry) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 20, lineH = 7;
  const pageW = doc.internal.pageSize.getWidth();
  let y = margin;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(150, 150, 150);
  doc.text(new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), margin, y); y += lineH;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(44, 40, 37);
  doc.text(entry.title || 'Untitled Entry', margin, y); y += lineH * 1.8;
  doc.setDrawColor(200, 200, 200); doc.line(margin, y, pageW - margin, y); y += lineH;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(60, 56, 53);
  doc.splitTextToSize(entry.text, pageW - margin * 2).forEach(line => { doc.text(line, margin, y); y += lineH; });
  doc.save(`${(entry.title || 'entry').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30)}.pdf`);
  showToast('📄 Entry exported!');
}

/* ============================================================
   13. SYNC HELPERS & REALTIME
   ============================================================ */

function setSyncState(status) {
  const dot    = document.getElementById('syncDot');
  const icon   = document.getElementById('syncStatus');
  const iconEl = document.getElementById('syncIcon');

  state.syncing = status === 'syncing';

  const map = {
    ok:      { dot: '',        cls: '',        lucide: 'cloud',          title: 'All changes saved' },
    syncing: { dot: 'syncing', cls: 'syncing', lucide: 'cloud-upload',   title: 'Syncing…' },
    error:   { dot: 'error',   cls: 'error',   lucide: 'cloud-off',      title: 'Sync error' },
  };

  const s = map[status] || map.ok;
  if (dot)    { dot.className = 'sync-dot' + (s.dot ? ' ' + s.dot : ''); }
  if (icon)   { icon.className = 'sync-status' + (s.cls ? ' ' + s.cls : ''); icon.title = s.title; }
  if (iconEl) { iconEl.dataset.lucide = s.lucide; lucide.createIcons(); }
}

/* Real-time subscription: re-fetch when another device writes */
function subscribeRealtime() {
  supabase
    .channel('solace-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'diary_entries', filter: `user_id=eq.${state.user.id}` },
      async () => { await loadEntries(); renderEntries(); updateStats(); if (state.currentPage === 'calendar') renderCalendar(); }
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos', filter: `user_id=eq.${state.user.id}` },
      async () => { await loadTodos(); renderTodos(); updateStats(); renderDashTasks(); }
    )
    .subscribe();
}

/* ============================================================
   14. TOAST, MODAL, UTILITIES
   ============================================================ */

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 350);
  }, 2500);
}

let confirmCallback = null;
function showConfirm(message, onOk) {
  confirmCallback = onOk;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmModal').classList.remove('hidden');
}

document.getElementById('confirmOk').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.add('hidden');
  if (confirmCallback) { confirmCallback(); confirmCallback = null; }
});

document.getElementById('confirmCancel').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.add('hidden');
  confirmCallback = null;
});

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }