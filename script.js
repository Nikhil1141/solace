/**
 * SOLACE — Personal Diary & Task Manager
 * script.js | Full application logic
 *
 * Sections:
 *  1. State & Storage helpers
 *  2. Init & Boot
 *  3. Navigation
 *  4. Lock / PIN Screen
 *  5. Theme
 *  6. Dashboard
 *  7. Diary
 *  8. Todo / Tasks
 *  9. Calendar
 * 10. Settings
 * 11. PDF Export
 * 12. Toast & Modal helpers
 * 13. Utility helpers
 */

/* ============================================================
   1. STATE & STORAGE HELPERS
   ============================================================ */

const KEYS = {
  entries:   'solace_entries',
  todos:     'solace_todos',
  theme:     'solace_theme',
  passcode:  'solace_passcode',
  pinEnabled:'solace_pin_enabled',
};

/** Load JSON from localStorage with a fallback */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

/** Save JSON to localStorage */
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ── In-memory working state ── */
let state = {
  entries: load(KEYS.entries, []),   // diary entries
  todos:   load(KEYS.todos,   []),   // todo items
  currentPage: 'dashboard',
  editingEntryId: null,
  diaryFilter: '',
  todoFilter: 'all',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  calSelectedDate: null,
  autosaveTimer: null,
};

/* ============================================================
   2. INIT & BOOT
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();          // render all lucide icons
  applyTheme();                  // apply saved theme first
  checkLock();                   // show lock screen if PIN enabled
  initNav();
  initDashboard();
  initDiary();
  initTodo();
  initCalendar();
  initSettings();
  updateGreeting();
  updateStats();
});

/* ============================================================
   3. NAVIGATION
   ============================================================ */

function initNav() {
  // Sidebar nav clicks
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
      closeSidebar();
    });
  });

  // "View All" text-btns on dashboard
  document.querySelectorAll('.text-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Mobile menu
  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // Lock button in topbar
  document.getElementById('lockBtn').addEventListener('click', () => {
    if (load(KEYS.pinEnabled, false)) lockApp();
  });
}

function navigateTo(page) {
  // Deactivate all
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  // Update topbar title
  const titles = { dashboard:'Dashboard', diary:'My Diary', todo:'Tasks', calendar:'Calendar', settings:'Settings' };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  state.currentPage = page;

  // Refresh page-specific data
  if (page === 'dashboard') { updateStats(); renderDashTasks(); }
  if (page === 'diary')     renderEntries();
  if (page === 'todo')      renderTodos();
  if (page === 'calendar')  renderCalendar();
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
   4. LOCK / PIN SCREEN
   ============================================================ */

let pinBuffer = '';

function checkLock() {
  const enabled = load(KEYS.pinEnabled, false);
  if (enabled && load(KEYS.passcode, null)) {
    showLockScreen();
  }
}

function showLockScreen() {
  document.getElementById('lockScreen').classList.remove('hidden');
  document.getElementById('app').style.display = 'none';
}

function hideLockScreen() {
  document.getElementById('lockScreen').classList.add('hidden');
  document.getElementById('app').style.display = '';
}

function lockApp() {
  pinBuffer = '';
  updatePinDots();
  document.getElementById('pinError').classList.add('hidden');
  showLockScreen();
}

// PIN pad
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
  const saved = load(KEYS.passcode, null);
  if (pinBuffer === saved) {
    hideLockScreen();
    pinBuffer = '';
    updatePinDots();
    document.getElementById('pinError').classList.add('hidden');
  } else {
    document.getElementById('pinError').classList.remove('hidden');
    document.getElementById('lockCard')?.classList.add('shake');
    pinBuffer = '';
    updatePinDots();
    // Shake animation via temporary class
    const card = document.querySelector('.lock-card');
    card.style.animation = 'none';
    card.style.transform = 'translateX(10px)';
    setTimeout(() => { card.style.transform = ''; card.style.transition = 'transform 0.15s'; }, 100);
    setTimeout(() => { card.style.transform = 'translateX(-8px)'; }, 200);
    setTimeout(() => { card.style.transform = ''; }, 300);
  }
}

/* ============================================================
   5. THEME
   ============================================================ */

function applyTheme() {
  const dark = load(KEYS.theme, false);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  updateThemeUI(dark);
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const newDark = !isDark;
  save(KEYS.theme, newDark);
  document.documentElement.dataset.theme = newDark ? 'dark' : 'light';
  updateThemeUI(newDark);
}

function updateThemeUI(isDark) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  const toggle = document.getElementById('darkModeToggle');
  if (icon)  { icon.dataset.lucide = isDark ? 'sun' : 'moon'; lucide.createIcons(); }
  if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  if (toggle) toggle.checked = isDark;
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

/* ============================================================
   6. DASHBOARD
   ============================================================ */

function initDashboard() {
  document.getElementById('quickSaveEntry').addEventListener('click', quickSaveDiary);
  document.getElementById('quickAddTask').addEventListener('click', quickAddTask);
  document.getElementById('quickTaskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') quickAddTask();
  });
}

function updateGreeting() {
  const hour = new Date().getHours();
  let greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const emoji = hour < 12 ? '✨' : hour < 17 ? '☀️' : '🌙';
  document.getElementById('greeting').textContent = `${greet} ${emoji}`;

  const now = new Date();
  document.getElementById('greetingDate').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function updateStats() {
  const today = todayStr();
  const entries = state.entries;
  const todos   = state.todos;

  const completedToday = todos.filter(t => t.done && t.completedDate === today).length;
  const pending        = todos.filter(t => !t.done).length;
  const totalEntries   = entries.length;

  // Streak: count consecutive days with an entry
  const streak = calcStreak(entries);

  document.getElementById('statCompleted').textContent = completedToday;
  document.getElementById('statPending').textContent   = pending;
  document.getElementById('statEntries').textContent   = totalEntries;
  document.getElementById('statStreak').textContent    = streak;
}

function calcStreak(entries) {
  if (!entries.length) return 0;
  const dateset = new Set(entries.map(e => e.date.slice(0,10)));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (dateset.has(d.toISOString().slice(0,10))) streak++;
    else break;
  }
  return streak;
}

function quickSaveDiary() {
  const text = document.getElementById('quickDiaryText').value.trim();
  if (!text) { showToast('Write something first!'); return; }
  const entry = createEntry('', text, '');
  state.entries.unshift(entry);
  save(KEYS.entries, state.entries);
  document.getElementById('quickDiaryText').value = '';
  updateStats();
  showToast('✍️ Entry saved!');
}

function quickAddTask() {
  const input = document.getElementById('quickTaskInput');
  const text = input.value.trim();
  if (!text) return;
  addTodo(text, 'normal');
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
  pending.forEach(todo => {
    list.appendChild(buildTaskItem(todo, true));
  });
  lucide.createIcons();
}

/* ============================================================
   7. DIARY
   ============================================================ */

function initDiary() {
  document.getElementById('newEntryBtn').addEventListener('click', openNewEditor);
  document.getElementById('cancelEntry').addEventListener('click', closeEditor);
  document.getElementById('saveEntry').addEventListener('click', saveCurrentEntry);
  document.getElementById('diarySearch').addEventListener('input', (e) => {
    state.diaryFilter = e.target.value.toLowerCase();
    renderEntries();
  });

  // Autosave on textarea input
  document.getElementById('entryText').addEventListener('input', scheduleAutosave);
  document.getElementById('entryTitle').addEventListener('input', scheduleAutosave);

  renderEntries();
}

function openNewEditor() {
  state.editingEntryId = null;
  document.getElementById('entryTitle').value = '';
  document.getElementById('entryText').value = '';
  document.getElementById('entryMood').value = '';
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
  document.getElementById('entryText').value = entry.text || '';
  document.getElementById('entryMood').value = entry.mood || '';
  document.getElementById('editorDate').textContent = new Date(entry.date).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  showEditor();
  document.getElementById('entryText').focus();
}

function showEditor() {
  const editor = document.getElementById('entryEditor');
  editor.classList.remove('hidden');
  document.getElementById('autosaveHint').textContent = '';
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  document.getElementById('entryEditor').classList.add('hidden');
  state.editingEntryId = null;
  clearTimeout(state.autosaveTimer);
}

function saveCurrentEntry() {
  const title = document.getElementById('entryTitle').value.trim();
  const text  = document.getElementById('entryText').value.trim();
  const mood  = document.getElementById('entryMood').value;

  if (!text) { showToast('Write something to save!'); return; }

  if (state.editingEntryId) {
    // Update existing
    const idx = state.entries.findIndex(e => e.id === state.editingEntryId);
    if (idx !== -1) {
      state.entries[idx] = { ...state.entries[idx], title, text, mood, updatedAt: new Date().toISOString() };
    }
    showToast('✅ Entry updated!');
  } else {
    // New entry
    const entry = createEntry(title, text, mood);
    state.entries.unshift(entry);
    showToast('✍️ Entry saved!');
  }

  save(KEYS.entries, state.entries);
  closeEditor();
  renderEntries();
  updateStats();
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  document.getElementById('autosaveHint').textContent = 'Autosaving…';
  state.autosaveTimer = setTimeout(() => {
    // Autosave to a draft key (not final entries)
    const title = document.getElementById('entryTitle').value.trim();
    const text  = document.getElementById('entryText').value.trim();
    if (text) {
      localStorage.setItem('solace_draft', JSON.stringify({ title, text, ts: Date.now() }));
      document.getElementById('autosaveHint').textContent = 'Draft autosaved';
    }
  }, 1500);
}

function deleteEntry(id) {
  showConfirm('Delete this diary entry? This cannot be undone.', () => {
    state.entries = state.entries.filter(e => e.id !== id);
    save(KEYS.entries, state.entries);
    renderEntries();
    updateStats();
    showToast('🗑️ Entry deleted');
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
    const dateStr   = new Date(entry.date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric', year: 'numeric'
    });

    // Highlight search terms
    const hl = (str) => {
      if (!filter) return str;
      const re = new RegExp(`(${escapeRegex(filter)})`, 'gi');
      return str.replace(re, '<mark class="highlight">$1</mark>');
    };

    card.innerHTML = `
      <div class="entry-card-header">
        <div class="entry-card-title">${hl(titleText)}</div>
        ${entry.mood ? `<span class="entry-card-mood">${entry.mood}</span>` : ''}
      </div>
      <div class="entry-card-date">${dateStr}</div>
      <div class="entry-card-preview">${hl(preview)}${entry.text.length > 180 ? '…' : ''}</div>
      <div class="entry-card-actions">
        <button class="entry-action-btn edit-btn">
          <i data-lucide="pencil"></i> Edit
        </button>
        <button class="entry-action-btn danger del-btn">
          <i data-lucide="trash-2"></i> Delete
        </button>
        <button class="entry-action-btn export-single-btn">
          <i data-lucide="download"></i> PDF
        </button>
      </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditEditor(entry.id);
    });

    card.querySelector('.del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteEntry(entry.id);
    });

    card.querySelector('.export-single-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      exportSingleEntry(entry);
    });

    card.addEventListener('click', () => openEditEditor(entry.id));

    list.appendChild(card);
  });

  lucide.createIcons();
}

function createEntry(title, text, mood) {
  return {
    id:        generateId(),
    title:     title,
    text:      text,
    mood:      mood,
    date:      new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/* ============================================================
   8. TODO / TASKS
   ============================================================ */

function initTodo() {
  document.getElementById('addTodoBtn').addEventListener('click', () => {
    const input = document.getElementById('todoInput');
    const priority = document.getElementById('todoPriority').value;
    const text = input.value.trim();
    if (!text) return;
    addTodo(text, priority);
    input.value = '';
    renderTodos();
    updateStats();
  });

  document.getElementById('todoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('addTodoBtn').click();
  });

  // Filter buttons
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

function addTodo(text, priority = 'normal') {
  const todo = {
    id:            generateId(),
    text:          text,
    done:          false,
    priority:      priority,
    createdAt:     new Date().toISOString(),
    completedDate: null,
  };
  state.todos.unshift(todo);
  save(KEYS.todos, state.todos);
  return todo;
}

function toggleTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.completedDate = todo.done ? todayStr() : null;
  save(KEYS.todos, state.todos);
  updateStats();
  renderTodos();
  if (state.currentPage === 'dashboard') renderDashTasks();
}

function deleteTodo(id) {
  state.todos = state.todos.filter(t => t.id !== id);
  save(KEYS.todos, state.todos);
  renderTodos();
  updateStats();
  if (state.currentPage === 'dashboard') renderDashTasks();
}

function renderTodos() {
  const list  = document.getElementById('todoList');
  const empty = document.getElementById('todoEmpty');
  let todos = state.todos;

  if (state.todoFilter === 'pending')   todos = todos.filter(t => !t.done);
  if (state.todoFilter === 'completed') todos = todos.filter(t => t.done);

  list.innerHTML = '';

  if (!todos.length) {
    empty.classList.remove('hidden');
    updateProgress();
    return;
  }
  empty.classList.add('hidden');

  todos.forEach(todo => list.appendChild(buildTaskItem(todo, false)));
  lucide.createIcons();
  updateProgress();
}

function buildTaskItem(todo, compact) {
  const li = document.createElement('li');
  li.className = `task-item${todo.done ? ' done' : ''}`;
  li.dataset.id = todo.id;

  const checkbox = document.createElement('div');
  checkbox.className = `task-checkbox${todo.done ? ' checked' : ''}`;
  checkbox.addEventListener('click', () => toggleTodo(todo.id));

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = todo.text;

  const priority = document.createElement('span');
  priority.className = `task-priority priority-${todo.priority}`;
  priority.textContent = todo.priority === 'high' ? '↑ High' : todo.priority === 'low' ? '↓ Low' : '';

  const del = document.createElement('button');
  del.className = 'task-delete';
  del.innerHTML = '<i data-lucide="x"></i>';
  del.addEventListener('click', () => deleteTodo(todo.id));

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
   9. CALENDAR
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

  // Update header
  document.getElementById('calMonthLabel').textContent = new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric'
  });

  // Build set of entry dates
  const entryDates = new Set(state.entries.map(e => e.date.slice(0,10)));

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  // Day-of-week headers
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayISO = today.toISOString().slice(0,10);

  // Blank cells before first day
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day other-month';
    // show prev month days
    const prevLastDay = new Date(year, month, 0).getDate();
    blank.textContent = prevLastDay - firstDay + i + 1;
    grid.appendChild(blank);
  }

  // Month days
  for (let d = 1; d <= daysInMonth; d++) {
    const isoDate = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEl = document.createElement('div');
    dayEl.className = 'cal-day';
    dayEl.textContent = d;

    if (isoDate === todayISO) dayEl.classList.add('today');
    if (entryDates.has(isoDate)) dayEl.classList.add('has-entry');
    if (state.calSelectedDate === isoDate) dayEl.classList.add('selected');

    dayEl.addEventListener('click', () => {
      state.calSelectedDate = isoDate;
      renderCalendar();
      showCalDayEntries(isoDate);
    });

    grid.appendChild(dayEl);
  }

  // Show entries for selected date
  if (state.calSelectedDate) showCalDayEntries(state.calSelectedDate);
}

function showCalDayEntries(isoDate) {
  const panel = document.getElementById('calEntriesPanel');
  const titleEl = document.getElementById('calSelectedDate');
  const listEl  = document.getElementById('calDayEntries');

  const displayDate = new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  titleEl.textContent = displayDate;

  const dayEntries = state.entries.filter(e => e.date.slice(0,10) === isoDate);
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
      <div class="cal-entry-mini-preview">${entry.text}</div>
    `;
    mini.style.cursor = 'pointer';
    mini.addEventListener('click', () => {
      navigateTo('diary');
      setTimeout(() => openEditEditor(entry.id), 100);
    });
    listEl.appendChild(mini);
  });
}

/* ============================================================
   10. SETTINGS
   ============================================================ */

function initSettings() {
  // Sync toggles to current state
  document.getElementById('passcodeToggle').checked = load(KEYS.pinEnabled, false);
  document.getElementById('darkModeToggle').checked = load(KEYS.theme, false);

  // Passcode toggle
  document.getElementById('passcodeToggle').addEventListener('change', function() {
    const pinSetup = document.getElementById('pinSetup');
    if (this.checked) {
      pinSetup.classList.remove('hidden');
      save(KEYS.pinEnabled, true);
    } else {
      pinSetup.classList.add('hidden');
      save(KEYS.pinEnabled, false);
      save(KEYS.passcode, null);
      showToast('Passcode lock disabled');
    }
  });

  // Save PIN
  document.getElementById('savePinBtn').addEventListener('click', () => {
    const pin = document.getElementById('newPinInput').value.trim();
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      showToast('PIN must be exactly 4 digits');
      return;
    }
    save(KEYS.passcode, pin);
    save(KEYS.pinEnabled, true);
    document.getElementById('pinSetMsg').classList.remove('hidden');
    document.getElementById('newPinInput').value = '';
    setTimeout(() => document.getElementById('pinSetMsg').classList.add('hidden'), 2500);
    showToast('🔒 PIN saved!');
  });

  // Dark mode toggle (settings page)
  document.getElementById('darkModeToggle').addEventListener('change', function() {
    save(KEYS.theme, this.checked);
    document.documentElement.dataset.theme = this.checked ? 'dark' : 'light';
    updateThemeUI(this.checked);
  });

  // Export PDF
  document.getElementById('exportPdfBtn').addEventListener('click', exportAllDiaryPDF);

  // Clear data
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    showConfirm('⚠️ This will permanently delete ALL diary entries and tasks. Are you sure?', () => {
      state.entries = [];
      state.todos   = [];
      save(KEYS.entries, []);
      save(KEYS.todos,   []);
      localStorage.removeItem('solace_draft');
      updateStats();
      renderEntries();
      renderTodos();
      showToast('All data cleared');
    });
  });
}

/* ============================================================
   11. PDF EXPORT
   ============================================================ */

function exportAllDiaryPDF() {
  if (!state.entries.length) { showToast('No entries to export'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const margin = 20;
  const lineH  = 7;
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  let y = margin;

  // Title page
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

  // Entries
  state.entries.forEach((entry, idx) => {
    doc.addPage();
    y = margin;

    // Date
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    const dateStr = new Date(entry.date).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    doc.text(dateStr + (entry.mood ? '  ' + entry.mood : ''), margin, y);
    y += lineH;

    // Title
    const title = entry.title || 'Untitled Entry';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(44, 40, 37);
    doc.text(title, margin, y);
    y += lineH * 1.6;

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageW - margin, y);
    y += lineH;

    // Body text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(60, 56, 53);
    const lines = doc.splitTextToSize(entry.text, pageW - margin * 2);
    lines.forEach(line => {
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
  const margin = 20;
  const lineH  = 7;
  const pageW  = doc.internal.pageSize.getWidth();
  let y = margin;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  const dateStr = new Date(entry.date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(dateStr, margin, y); y += lineH;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(44, 40, 37);
  doc.text(entry.title || 'Untitled Entry', margin, y); y += lineH * 1.8;

  doc.setDrawColor(200,200,200);
  doc.line(margin, y, pageW - margin, y); y += lineH;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(60, 56, 53);
  const lines = doc.splitTextToSize(entry.text, pageW - margin * 2);
  lines.forEach(line => { doc.text(line, margin, y); y += lineH; });

  const slug = (entry.title || 'entry').toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,30);
  doc.save(`${slug}.pdf`);
  showToast('📄 Entry exported!');
}

/* ============================================================
   12. TOAST & MODAL HELPERS
   ============================================================ */

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  // force reflow
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

/* ============================================================
   13. UTILITY HELPERS
   ============================================================ */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
