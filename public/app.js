import { buildTimeline, findCurrentPhase, formatTime, inferLessonCount, localDateKey, weekdayShort, toMinutes } from '/schedule.js';

const STORAGE_KEY = 'moja-shkola.v1';
const CLOUD_KEY = 'moja-shkola.cloud-token.v1';
let cloudTimer = null;
let cloudBusy = false;
let applyingCloudData = false;
const COLORS = [
  { name: 'Фиолетовый', value: '#8b7bff' }, { name: 'Синий', value: '#4d83ff' },
  { name: 'Голубой', value: '#34b9e8' }, { name: 'Бирюзовый', value: '#28cbb6' },
  { name: 'Зелёный', value: '#45c778' }, { name: 'Лайм', value: '#a4cc43' },
  { name: 'Янтарный', value: '#f0ad4e' }, { name: 'Оранжевый', value: '#f18b52' },
  { name: 'Розовый', value: '#ec78b5' }, { name: 'Красный', value: '#ee6e87' },
];
const REMINDER_LINES = [
  'Через пять минут урок. Мозгу пора включить режим «я всё понял».',
  'До урока пять минут. Тетрадь уже почти скучает.',
  'Скоро урок! Карандаш просит не оставлять его без дела.',
  'Пять минут до старта. Можно успеть найти ручку, это уже победа.',
  'Урок скоро начнётся. Пусть сегодня вопрос «а что задали?» не пригодится.',
  'Пять минут! Самое время закрыть портал в бесконечную ленту.',
  'Скоро звонок. Мозгу пора обновить вкладку.',
  'Урок через пять минут. Спокойно, даже понедельник когда-нибудь заканчивается.',
  'Пора готовиться к уроку. Ручка, тетрадь — команда на месте?',
  'Пять минут до урока. Успеваем собраться без олимпиады по панике.',
  'Звонок скоро. Пусть единственная контрольная сегодня будет над временем.',
  'Скоро урок — твой шанс задать тот самый хороший вопрос.',
];
const PREP_STEPS = [
  { title: 'Подождите…', description: 'Сохраняем выбранные настройки.', percent: 12 },
  { title: 'Мы готовим для вас лучшее…', description: 'Применяем выбранные цвета и тему.', percent: 27 },
  { title: 'Настраиваем рабочее пространство', description: 'Собираем нижние вкладки приложения.', percent: 40 },
  { title: 'Готовим Live-расписание', description: 'Подключаем расчёт уроков и перемен.', percent: 54 },
  { title: 'Проверяем ваши материалы', description: 'Загружаем сохранённые задания из этого браузера.', percent: 68 },
  { title: 'Настраиваем напоминания', description: 'Учитываем выданные разрешения браузера.', percent: 80 },
  { title: 'Проверяем разделы', description: 'Подготавливаем главную, расписание и домашние задания.', percent: 92 },
  { title: 'Почти готово — наводим красоту', description: 'Последний штрих. Сейчас откроется приложение.', percent: 100 },
];
const DAY_KEYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const tomorrowKey = () => { const date = new Date(); date.setDate(date.getDate() + 1); return localDateKey(date); };
const todayKey = () => localDateKey(new Date());
const defaultData = () => ({
  version: 1,
  onboarded: false,
  profile: { name: '', surname: '', themeMode: 'auto', accent: '#8b7bff', secondaryAccent: '#5adacb', manualMode: false },
  selectedClass: '7А',
  timetable: [],
  homework: [],
  notificationEnabled: false,
  cameraPermission: false,
  lastCheck: null,
});
let data = loadData();
let currentView = 'home';
let currentAiMode = 'homework';
let currentHomeworkFilter = 'tomorrow';
let selectedDay = DAY_KEYS.includes(weekdayShort()) ? weekdayShort() : 'Пн';
let pendingHomeworkImage = null;
let pendingScheduleImage = null;
let pendingAdminImage = null;
let homeworkAnalysis = null;
let scheduleAnalysis = null;
let revealedSolutions = new Set();
let preparingIds = new Set();
let onboardingStep = 0;
let onboardingDraft = null;
let selectedAccent = data.profile.accent || COLORS[0].value;
let selectedSecondaryAccent = data.profile.secondaryAccent || '#5adacb';
let selectedTheme = data.profile.themeMode || 'auto';
let selectedManualMode = !!data.profile.manualMode;
let cameraStream = null;
let clockTimer = null;
let materialTimer = null;
let reminderTimer = null;
let lastReminderKey = '';

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return { ...defaultData(), ...parsed, profile: { ...defaultData().profile, ...(parsed.profile || {}) }, timetable: Array.isArray(parsed.timetable) ? parsed.timetable : [], homework: Array.isArray(parsed.homework) ? parsed.homework : [] };
  } catch { return defaultData(); }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!applyingCloudData && getCloudToken()) scheduleCloudPush();
  } catch { toast('Не удалось сохранить данные. Возможно, хранилище браузера заполнено.', 'error'); }
}
function getCloudToken() { try { return localStorage.getItem(CLOUD_KEY) || ''; } catch { return ''; } }
function setCloudStatus(text) { const el = document.getElementById('cloud-sync-status'); if (el) el.textContent = text; setSyncLabel(text); }
function scheduleCloudPush() {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => syncCloud('push'), 900);
}
async function syncCloud(mode = 'pull', token = getCloudToken()) {
  if (!token || cloudBusy || !navigator.onLine) return false;
  cloudBusy = true; setCloudStatus('Синхронизация…');
  try {
    const response = await fetch('/.netlify/functions/cloud-sync', {
      method: mode === 'push' ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Token': token },
      body: mode === 'push' ? JSON.stringify({ data }) : JSON.stringify({ action: 'pull' }),
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 && mode === 'pull') { cloudBusy = false; return await syncCloud('push', token); }
    if (!response.ok) throw new Error(body.error || `Облачное хранилище ответило ${response.status}`);
    if (mode === 'pull' && body.data && typeof body.data === 'object') {
      applyingCloudData = true;
      data = { ...defaultData(), ...body.data, profile: { ...defaultData().profile, ...(body.data.profile || {}) }, timetable: Array.isArray(body.data.timetable) ? body.data.timetable : [], homework: Array.isArray(body.data.homework) ? body.data.homework : [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); applyingCloudData = false;
      applyTheme(); renderClassSelectors(); renderHome(); renderSchedule(); renderHomework(); hydrateSettings();
    }
    setCloudStatus('Облако синхронизировано');
    return true;
  } catch (error) {
    applyingCloudData = false;
    setCloudStatus('Нет связи с облаком');
    console.warn('Cloud sync failed:', error);
    return false;
  } finally { cloudBusy = false; }
}
async function setupCloudSync() {
  const input = document.getElementById('cloud-sync-code');
  const existing = getCloudToken();
  if (existing) {
    if (input) input.value = existing;
    const ok = await syncCloud('push', existing);
    toast(ok ? 'Локальные данные отправлены в облако.' : 'Не удалось подключить облако. Проверь публикацию Netlify и соединение.', ok ? 'success' : 'error');
    return;
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(CLOUD_KEY, token);
  if (input) input.value = token;
  const ok = await syncCloud('push', token);
  toast(ok ? 'Облако создано. Сохрани код и введи его на другом устройстве.' : 'Код создан, но сервер облака пока недоступен. После публикации попробуй ещё раз.', ok ? 'success' : 'error');
}
async function connectCloudSync() {
  const input = document.getElementById('cloud-sync-code');
  const token = (input?.value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) { toast('Введи полный облачный код из 64 символов.', 'error'); return; }
  if (getCloudToken() && !confirm('Подключить другой облачный профиль? Текущие локальные данные будут заменены данными из облака.')) return;
  localStorage.setItem(CLOUD_KEY, token);
  const ok = await syncCloud('pull', token);
  toast(ok ? 'Код облака сохранён на этом устройстве.' : 'Не удалось загрузить данные. Проверь код и публикацию Netlify.', ok ? 'success' : 'error');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function currentTheme() {
  if (data.profile.themeMode === 'auto') return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return ['light', 'dark', 'navy'].includes(data.profile.themeMode) ? data.profile.themeMode : 'dark';
}
function applyTheme() {
  const theme = currentTheme();
  document.body.dataset.theme = theme;
  document.documentElement.style.setProperty('--accent', data.profile.accent || '#8b7bff');
  document.documentElement.style.setProperty('--accent-secondary', data.profile.secondaryAccent || '#5adacb');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5fc' : theme === 'navy' ? '#07172b' : '#11132b');
  renderThemeControls();
}
function renderThemeControls() {
  document.querySelectorAll('[data-theme]').forEach(button => button.classList.toggle('active', button.dataset.theme === data.profile.themeMode));
  document.querySelectorAll('[data-accent]').forEach(button => button.classList.toggle('active', button.dataset.accent.toLowerCase() === (data.profile.accent || '').toLowerCase()));
  const palette = document.getElementById('color-palette');
  if (palette) palette.innerHTML = COLORS.map(color => `<button class="color-swatch ${color.value.toLowerCase() === (data.profile.accent || '').toLowerCase() ? 'active' : ''}" data-accent="${color.value}" title="${escapeHtml(color.name)}" aria-label="${escapeHtml(color.name)}" style="background:${color.value}"></button>`).join('');
  const onboardPalette = document.querySelector('#onboarding-content .onboard-color-grid');
  if (onboardPalette) onboardPalette.innerHTML = COLORS.map(color => `<button class="onboard-color ${color.value.toLowerCase() === selectedAccent.toLowerCase() ? 'selected' : ''}" data-onboard-accent="${color.value}" aria-label="${escapeHtml(color.name)}" title="${escapeHtml(color.name)}" style="--swatch:${color.value}"></button>`).join('');
  const custom = document.getElementById('custom-color'); if (custom) custom.value = data.profile.accent || '#8b7bff';
  const secondary = document.getElementById('custom-secondary-color'); if (secondary) secondary.value = data.profile.secondaryAccent || '#5adacb';
}
function greetingPart(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}
function dateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}
function selectedClass() { return data.selectedClass || '7А'; }
function entriesFor(classLabel = selectedClass(), day = selectedDay) {
  return data.timetable.filter(item => (!item.classLabel || item.classLabel === classLabel) && (!item.day || item.day === day));
}
function lessonCountFor(classLabel = selectedClass(), day = selectedDay) {
  return inferLessonCount(entriesFor(classLabel, day));
}
function isRealSubject(subject) { return subject && !/^Урок \d+$/.test(subject); }
function addDaysKey(key, amount) {
  const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + amount); return localDateKey(date);
}
function dueLabel(key) {
  if (key === todayKey()) return 'Сегодня';
  if (key === tomorrowKey()) return 'Завтра';
  const date = new Date(`${key}T12:00:00`);
  if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
  return 'Дата не указана';
}
function toast(message, kind = '') {
  const region = document.getElementById('toast-region');
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = message;
  region.append(el); setTimeout(() => el.remove(), 4400);
}
function setSyncLabel(label) { const el = document.getElementById('sync-label'); if (el) el.textContent = label; }

function openView(view) {
  if (!['home', 'schedule', 'ai', 'homework', 'settings'].includes(view)) return;
  currentView = view;
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.nav === view));
  if (view === 'home') renderHome();
  if (view === 'schedule') renderSchedule();
  if (view === 'homework') renderHomework();
  if (view === 'settings') hydrateSettings();
  if (view === 'ai') renderClassSelectors();
}

function renderClassSelectors() {
  const known = new Set(['7А', '7Б', '2', '3', data.selectedClass]);
  data.timetable.forEach(item => item.classLabel && known.add(item.classLabel));
  data.homework.forEach(item => item.classLabel && known.add(item.classLabel));
  const options = [...known].filter(Boolean).map(label => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('');
  ['class-selector', 'homework-class'].forEach(id => { const el = document.getElementById(id); if (el) { const old = el.value; el.innerHTML = options; el.value = [...known].includes(old) ? old : data.selectedClass; } });
}

function renderHome() {
  const name = (data.profile.name || '').trim();
  const title = document.getElementById('greeting-title');
  title.innerHTML = name ? `Привет, ${escapeHtml(name)}! <span class="script-accent">Пора сиять.</span>` : `Привет! <span class="script-accent">Пора сиять.</span>`;
  document.getElementById('greeting-subtitle').textContent = name ? 'Твой учебный день — без лишнего шума.' : 'Всё важное для учёбы — в одном месте.';
  document.getElementById('today-label').textContent = `${dateLabel().toLocaleUpperCase('ru-RU')}`;
  document.getElementById('hero-date').textContent = dateLabel();
  const letter = name ? name.charAt(0).toLocaleUpperCase('ru-RU') : 'У';
  document.getElementById('avatar-letter').textContent = letter;
  document.getElementById('settings-avatar').textContent = letter;
  const art = document.getElementById('weather-art');
  const hour = new Date().getHours();
  art.dataset.period = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 21 ? 'evening' : 'night';
  const today = weekdayShort();
  const actualDay = DAY_KEYS.includes(today) ? today : 'Пн';
  const now = new Date();
  const currentEntries = entriesFor(selectedClass(), actualDay);
  const phase = findCurrentPhase(now, currentEntries, { classLabel: selectedClass(), day: actualDay, lessonCount: lessonCountFor(selectedClass(), actualDay) });
  document.getElementById('hero-clock').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let kicker = 'СЕЙЧАС'; let titleText = ''; let description = '';
  if (phase.phase === 'lesson') {
    const subject = isRealSubject(phase.subject) ? phase.subject : `Урок ${phase.lessonNumber}`;
    kicker = 'ИДЁТ УРОК'; titleText = subject;
    const haveSubjects = currentEntries.some(item => isRealSubject(item.subject));
    description = haveSubjects ? `До конца урока ${Math.max(0, phase.end - now.getHours() * 60 - now.getMinutes())} мин. · ${phase.startText}—${phase.endText}` : `Урок №${phase.lessonNumber} · ${phase.startText}—${phase.endText}. Добавь своё расписание, чтобы увидеть предмет.`;
  } else if (phase.phase === 'break') {
    const nextLesson = phase.timeline.find(item => item.type === 'lesson' && item.lessonNumber === phase.afterLesson + 1);
    kicker = 'МОЖНО ВЫДОХНУТЬ'; titleText = `Перемена · ${phase.duration} минут`;
    const nextName = nextLesson && isRealSubject(nextLesson.subject) ? nextLesson.subject : `урок ${phase.afterLesson + 1}`;
    description = `До ${phase.endText}. Потом — ${nextName}. Вода, плечи размять, и дальше.`;
  } else if (phase.phase === 'before') {
    kicker = 'ДО ПЕРВОГО ЗВОНКА'; titleText = 'Есть время спокойно собраться'; description = `Первый урок начинается в ${phase.startText}.`;
  } else {
    kicker = 'УЧЕБНЫЙ ДЕНЬ ЗАВЕРШЁН'; titleText = 'На сегодня всё!'; description = 'Выдохни. Если осталось ДЗ — оно собрано в отдельной вкладке.';
  }
  document.getElementById('phase-kicker').textContent = kicker;
  document.getElementById('hero-phase-title').textContent = titleText;
  document.getElementById('hero-phase-desc').textContent = description;
  const assignments = data.homework.filter(item => item.dueDate === tomorrowKey() && !item.completed);
  const tomorrowCard = document.getElementById('tomorrow-card');
  if (assignments.length) {
    const subjects = [...new Set(assignments.map(item => item.subject || 'Задание'))];
    tomorrowCard.innerHTML = `<div class="empty-illustration"><span class="empty-icon">✳</span></div><div class="tomorrow-copy"><strong>${assignments.length} ${assignments.length === 1 ? 'задание' : assignments.length < 5 ? 'задания' : 'заданий'} на завтра</strong><p>${escapeHtml(subjects.slice(0, 3).join(' · '))}${subjects.length > 3 ? ' и ещё' : ''}. Решения скрыты до твоего выбора.</p></div><button class="soft-button" data-action="homework">Открыть ДЗ</button>`;
  } else {
    tomorrowCard.innerHTML = `<div class="empty-illustration"><span class="empty-icon">✦</span></div><div class="tomorrow-copy"><strong>Сначала загрузим задания</strong><p>Добавь скриншот домашнего задания. Помощник разберёт его, а решение по умолчанию останется скрытым.</p></div><button class="soft-button" data-action="ai"><span class="button-spark">✳</span> Добавить ДЗ</button>`;
  }
  document.getElementById('last-check-label').textContent = data.lastCheck ? `Последняя проверка: ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(data.lastCheck))}. Только материалы внутри приложения.` : 'Пока проверены только задания внутри приложения.';
  if (currentView === 'home') maybeUpdatePeriodScene(art.dataset.period);
}

function renderSchedule() {
  renderClassSelectors();
  const classSelect = document.getElementById('class-selector');
  if (classSelect) classSelect.value = data.selectedClass;
  const dayIsToday = selectedDay === weekdayShort();
  document.querySelectorAll('.day-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.day === selectedDay));
  const entries = entriesFor(data.selectedClass, selectedDay);
  const count = inferLessonCount(entries);
  const timeline = buildTimeline(entries, { classLabel: data.selectedClass, day: selectedDay, lessonCount: count });
  const now = new Date();
  const phase = dayIsToday ? findCurrentPhase(now, entries, { classLabel: data.selectedClass, day: selectedDay, lessonCount: count }) : null;
  const summaryTitle = phase?.phase === 'lesson' ? (isRealSubject(phase.subject) ? phase.subject : `Урок ${phase.lessonNumber}`) : phase?.phase === 'break' ? `Перемена · ${phase.duration} минут` : entries.length ? `${count} ${count === 1 ? 'урок' : count < 5 ? 'урока' : 'уроков'} в плане` : 'Расписание не загружено';
  document.getElementById('summary-title').textContent = summaryTitle;
  document.getElementById('summary-label').textContent = dayIsToday ? 'СЕЙЧАС · ЖИВОЙ РЕЖИМ' : `ПЛАН НА ${selectedDay.toLocaleUpperCase('ru-RU')}`;
  const finalLesson = timeline.find(item => item.type === 'lesson' && item.lessonNumber === count);
  document.getElementById('summary-time').textContent = `08:30—${finalLesson?.endText || '14:00'}`;
  const list = document.getElementById('schedule-list');
  list.innerHTML = timeline.map(item => {
    const current = phase && phase.type === item.type && (item.type === 'lesson' ? phase.lessonNumber === item.lessonNumber : phase.afterLesson === item.afterLesson);
    if (item.type === 'break') return `<div class="schedule-item break-item ${current ? 'current' : ''}" data-break-after="${item.afterLesson}"><div class="schedule-time"><strong>${item.startText}</strong><small>${item.duration} мин</small></div><div class="timeline-track"><span class="timeline-dot"></span></div><div class="break-card"><span class="break-symbol">☕</span><strong>Перемена</strong><small>${item.duration} минут</small></div></div>`;
    const subject = isRealSubject(item.subject) ? item.subject : `Урок ${item.lessonNumber}`;
    const subtitle = item.room ? `Кабинет ${escapeHtml(item.room)}` : isRealSubject(item.subject) ? `Урок ${item.lessonNumber} · ${item.startText}—${item.endText}` : 'Загрузи своё расписание в Настройках';
    return `<div class="schedule-item ${current ? 'current' : ''}" data-lesson="${item.lessonNumber}"><div class="schedule-time"><strong>${item.startText}</strong><small>${item.endText}</small></div><div class="timeline-track"><span class="timeline-dot"></span></div><div class="lesson-card"><span class="lesson-number">${item.lessonNumber}</span><span class="lesson-copy"><strong>${escapeHtml(subject)}</strong><small>${subtitle}</small></span>${current ? '<span class="lesson-state">СЕЙЧАС</span>' : ''}</div></div>`;
  }).join('');
  if (!entries.some(item => isRealSubject(item.subject))) {
    list.insertAdjacentHTML('afterbegin', `<div class="schedule-empty-notice" style="padding:10px 12px;margin:0 0 10px;border:1px solid var(--accent-border);border-radius:12px;background:var(--accent-wash);font-size:9px;color:var(--muted)">Это нейтральная сетка времени, не школьное расписание. Импортируй своё расписание в Настройках — предметы появятся здесь.</div>`);
  }
}

function homeworkEmptyMessage() {
  return `<div class="no-homework"><span class="empty-icon">✦</span><strong>Пока чистый лист</strong><p>Добавь фото или текст задания во вкладке ИИ-помощник. Как только задания будут добавлены, они появятся здесь.</p><button class="soft-button" data-action="ai" style="margin-top:13px">Добавить задание</button></div>`;
}
function renderHomework() {
  const list = document.getElementById('homework-list');
  const tomorrowItems = data.homework.filter(item => item.dueDate === tomorrowKey() && !item.completed);
  document.getElementById('tomorrow-count').textContent = String(tomorrowItems.length);
  document.querySelectorAll('[data-hw-filter]').forEach(button => button.classList.toggle('active', button.dataset.hwFilter === currentHomeworkFilter));
  let items = [...data.homework];
  if (currentHomeworkFilter === 'tomorrow') items = items.filter(item => item.dueDate === tomorrowKey() && !item.completed);
  if (currentHomeworkFilter === 'done') items = items.filter(item => item.completed);
  items.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!items.length) { list.innerHTML = homeworkEmptyMessage(); return; }
  list.innerHTML = items.map(item => {
    const visible = revealedSolutions.has(item.id);
    const solution = item.solution;
    const solutionHtml = visible && solution ? `<div class="answer-panel"><strong>РЕШЕНИЕ · ПОКАЗАНО ПО ТВОЕМУ ВЫБОРУ</strong><p>${escapeHtml(solution.answer || '')}</p>${solution.explanation ? `<p>${escapeHtml(solution.explanation)}</p>` : ''}${Array.isArray(solution.steps) && solution.steps.length ? `<p>${solution.steps.map((step, i) => `${i + 1}. ${escapeHtml(step)}`).join('\n')}</p>` : ''}${solution.check ? `<p><b>Проверь себя:</b> ${escapeHtml(solution.check)}</p>` : ''}</div>` : '';
    return `<article class="homework-card ${item.completed ? 'done' : ''}" data-hw-id="${escapeHtml(item.id)}"><div class="homework-topline"><span class="subject-pill">${escapeHtml(item.subject || 'Задание')} · ${escapeHtml(item.classLabel || data.selectedClass)}</span><span class="due-pill">${escapeHtml(dueLabel(item.dueDate))}</span></div><h3>${escapeHtml(item.title || item.subject || 'Домашнее задание')}</h3><p>${escapeHtml(item.task || '')}</p>${item.attempted ? '<p style="margin-top:7px;color:var(--good)">✓ Отметил(а), что попробовал(а) сам</p>' : ''}${solutionHtml}<div class="homework-card-actions">${item.completed ? `<button class="soft-button" data-hw-action="reopen" data-id="${escapeHtml(item.id)}">Вернуть в список</button>` : `<button class="soft-button" data-hw-action="attempted" data-id="${escapeHtml(item.id)}">Я попробовал сам</button><button class="primary-button" style="padding:8px 10px" data-hw-action="show" data-id="${escapeHtml(item.id)}">${visible ? 'Скрыть решение' : solution ? 'Показать решение' : 'Подготовить решение'}</button><button class="text-button danger-text" data-hw-action="done" data-id="${escapeHtml(item.id)}">Готово ✓</button>`}</div></article>`;
  }).join('');
}

function hydrateSettings() {
  const name = document.getElementById('profile-name'); const surname = document.getElementById('profile-surname');
  if (document.activeElement !== name) name.value = data.profile.name || '';
  if (document.activeElement !== surname) surname.value = data.profile.surname || '';
  document.getElementById('settings-schedule-class').value = data.selectedClass || '7А';
  const cloudCode = document.getElementById('cloud-sync-code'); if (cloudCode && document.activeElement !== cloudCode) cloudCode.value = getCloudToken();
  const toggle = document.getElementById('notification-toggle');
  toggle.setAttribute('aria-checked', String(!!data.notificationEnabled && 'Notification' in window && Notification.permission === 'granted'));
  document.getElementById('notification-status').textContent = data.notificationEnabled && 'Notification' in window && Notification.permission === 'granted' ? 'Разрешено. Напоминание сработает, пока приложение открыто.' : 'Выключено. Браузер может отправлять уведомления после разрешения.';
  document.getElementById('camera-status').textContent = data.cameraPermission ? 'Разрешение подтверждено; камера включается только по действию.' : 'Камера не включена; фотографии можно выбирать из галереи.';
  renderThemeControls(); renderClassSelectors();
}

function maybeUpdatePeriodScene(period) {
  const art = document.getElementById('weather-art');
  if (art) art.dataset.period = period;
}
function updateClockAndLive() {
  const now = new Date();
  const clock = document.getElementById('hero-clock');
  if (clock) clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = DAY_KEYS.includes(weekdayShort(now)) ? weekdayShort(now) : 'Пн';
  if (currentView === 'home' || currentView === 'schedule') {
    if (currentView === 'home') renderHome(); else if (day === selectedDay) renderSchedule();
  }
}

async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Выбери изображение (JPG, PNG, WEBP).');
  if (file.size > 18 * 1024 * 1024) throw new Error('Файл больше 18 МБ. Выбери меньший скриншот.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Изображение не открывается.')); img.src = url; });
    const scale = Math.min(1, 1600 / image.width, 1600 / image.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d', { alpha: false }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const converted = canvas.toDataURL('image/jpeg', 0.82);
    const [, mimeType, base64] = converted.match(/^data:([^;]+);base64,(.*)$/) || [];
    if (!base64) throw new Error('Не удалось подготовить изображение.');
    if (base64.length > 4_000_000) throw new Error('Скриншот всё ещё слишком большой. Обрежь его и попробуй снова.');
    return { base64, mimeType, dataUrl: converted, name: file.name, originalSize: file.size };
  } finally { URL.revokeObjectURL(url); }
}
function setFilePreview(containerId, image, stateSetter) {
  const container = document.getElementById(containerId);
  if (!image) { container.classList.add('hidden'); container.innerHTML = ''; return; }
  container.classList.remove('hidden');
  container.innerHTML = `<img src="${image.dataUrl}" alt="Предпросмотр изображения" data-open-image="${containerId}"><span>${escapeHtml(image.name)} · готово к анализу</span><button data-remove-image="${containerId}" aria-label="Убрать изображение">×</button>`;
  container.querySelector('img')?.addEventListener('click', () => openImageModal(image.dataUrl));
  container.querySelector('[data-remove-image]')?.addEventListener('click', () => { stateSetter(null); setFilePreview(containerId, null, stateSetter); });
}
function openImageModal(src) { document.getElementById('modal-image').src = src; document.getElementById('image-modal').classList.remove('hidden'); }
function closeImageModal() { document.getElementById('image-modal').classList.add('hidden'); document.getElementById('modal-image').src = ''; }

async function callAI(payload) {
  const response = await fetch('/.netlify/functions/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : { error: 'Netlify Function недоступна. Для настоящего ИИ разверни пакет через Netlify Git или CLI, чтобы функции были опубликованы вместе с сайтом.' };
  if (!response.ok || !body.ok) {
    const error = new Error(body.error || `Запрос завершился с кодом ${response.status}.`); error.code = body.code; error.status = response.status; throw error;
  }
  return body.result;
}
function showRequestError(container, error, manualCallback) {
  container.classList.remove('hidden');
  let addManually = '';
  if (manualCallback) addManually = `<div class="result-actions"><button class="soft-button" data-manual-add="${manualCallback}">Сохранить текст без ИИ</button></div>`;
  container.innerHTML = `<h3>Не получилось подключить ИИ</h3><p style="font-size:10px;line-height:1.6;color:var(--muted)">${escapeHtml(error.message)}</p>${addManually}`;
}

function parseHomeworkTextLocally(text, classLabel) {
  const lines = String(text || '').split(/\n|;(?=\s*[\p{L}А-ЯЁ])/u).map(line => line.trim()).filter(Boolean);
  const assignments = lines.map(line => { const match = line.match(/^([^:—–-]{2,36})\s*[:—–-]\s*(.+)$/u); return { subject: match ? match[1].trim() : 'Задание', task: match ? match[2].trim() : line, classLabel, dueDate: 'tomorrow', notes: 'Локальный разбор, без ИИ.' }; }).filter(item => item.task);
  return { assignments, notes: 'Это разбор текста по шаблону, не нейросеть. Проверь данные перед сохранением.' };
}
function parseScheduleTextLocally(text, fallbackDay, classLabel) {
  const result = []; const dayNames = { пн:'Пн',понедельник:'Пн',вт:'Вт',вторник:'Вт',ср:'Ср',среда:'Ср',чт:'Чт',четверг:'Чт',пт:'Пт',пятница:'Пт',сб:'Сб',суббота:'Сб',вс:'Вс',воскресенье:'Вс' };
  for (const line of String(text || '').split(/\n/).map(x => x.trim()).filter(Boolean)) {
    const dm = line.match(/^(пн|понедельник|вт|вторник|ср|среда|чт|четверг|пт|пятница|сб|суббота|вс|воскресенье)\s*[:—–-]\s*(.*)$/iu);
    const day = dm ? dayNames[dm[1].toLowerCase()] : fallbackDay; const content = dm ? dm[2] : line;
    const matches = [...content.matchAll(/(?:^|[,;]\s*|\s)([1-6])\s*[.)\-:]\s*([^,;]+?)(?=(?:[,;]\s*[1-6]\s*[.)\-:]|$))/gu)];
    for (const m of matches) { const subject = m[2].trim().replace(/\s+(?:каб\.?|кабинет)\s*\d+.*$/iu, '').trim(); if (subject) result.push({ day, lessonNumber:Number(m[1]), subject, room:'', classLabel }); }
  }
  return { classLabel, scheduleItems:result, notes:'Локальный разбор текста, не ИИ. Проверь предметы и номера уроков.' };
}

async function analyzeHomework() {
  const text = document.getElementById('homework-text').value.trim();
  if (!pendingHomeworkImage && !text) { toast('Добавь скриншот или введи текст задания.', 'error'); return; }
  const button = document.getElementById('analyze-homework'); const resultContainer = document.getElementById('homework-analysis-result');
  button.disabled = true; button.textContent = '✳ Анализируем…';
  try {
    const result = await callAI({ type: 'analyze_homework', classLabel: document.getElementById('homework-class').value, text, ...(pendingHomeworkImage ? { imageBase64: pendingHomeworkImage.base64, mimeType: pendingHomeworkImage.mimeType } : {}) });
    homeworkAnalysis = { ...result, classLabel: document.getElementById('homework-class').value, dueDate: selectedDueDate() };
    const assignments = Array.isArray(result.assignments) ? result.assignments : [];
    resultContainer.classList.remove('hidden');
    resultContainer.innerHTML = `<h3>Вот что удалось распознать</h3>${assignments.length ? assignments.map((item, i) => `<div class="analysis-item"><strong>${escapeHtml(item.subject || `Задание ${i + 1}`)}</strong><p>${escapeHtml(item.task || '')}</p>${item.notes ? `<p>Примечание: ${escapeHtml(item.notes)}</p>` : ''}</div>`).join('') : '<p style="font-size:10px;color:var(--muted)">Список не распознан. Попробуй более чёткое фото или вставь текст.</p>'}<p class="helper-text">Распознанный текст пока не сохранён. Проверь его перед добавлением.</p><div class="result-actions"><button class="primary-button" data-result-action="save-homework" ${assignments.length ? '' : 'disabled'}>Добавить в ДЗ</button><button class="soft-button" data-result-action="clear-homework">Отмена</button></div>${result.notes ? `<p class="helper-text">${escapeHtml(result.notes)}</p>` : ''}`;
    toast(`Распознано заданий: ${assignments.length}. Проверь текст до сохранения.`, 'success');
  } catch (error) {
    if (error.code === 'AI_NOT_CONFIGURED' && text && !pendingHomeworkImage) {
      const result = parseHomeworkTextLocally(text, document.getElementById('homework-class').value);
      homeworkAnalysis = { ...result, classLabel: document.getElementById('homework-class').value, dueDate: selectedDueDate() };
      const assignments = result.assignments; resultContainer.classList.remove('hidden');
      resultContainer.innerHTML = `<h3>Черновик разбора · без ИИ</h3>${assignments.length ? assignments.map((item,i) => `<div class="analysis-item"><strong>${escapeHtml(item.subject || `Задание ${i+1}`)}</strong><p>${escapeHtml(item.task)}</p></div>`).join('') : '<p class="helper-text">Не удалось выделить строки. Раздели задания переносами строк.</p>'}<p class="helper-text">${escapeHtml(result.notes)}</p><div class="result-actions"><button class="primary-button" data-result-action="save-homework" ${assignments.length ? '' : 'disabled'}>Добавить в ДЗ</button><button class="soft-button" data-result-action="clear-homework">Отмена</button></div>`;
      document.getElementById('ai-availability').textContent = 'ИИ-сервер не настроен. Текст можно разобрать локально; распознавание фото и ответы нейросети требуют подключённого ИИ.';
      toast('Создан черновик из текста. Проверь перед сохранением.', 'success');
    } else { showRequestError(resultContainer, error, text ? 'homework' : null); if (error.code === 'AI_NOT_CONFIGURED') document.getElementById('ai-availability').textContent = 'Настоящий ИИ не подключён: для нейросетевых ответов нужен OPENAI_API_KEY в Netlify.'; toast(error.message, 'error'); }
  } finally { button.disabled = false; button.innerHTML = '<span>✳</span> Анализировать задание'; }
}
function selectedDueDate() {
  const mode = document.getElementById('homework-due').value;
  if (mode === 'today') return todayKey();
  if (mode === 'custom') return document.getElementById('homework-custom-due').value || tomorrowKey();
  return tomorrowKey();
}
function addHomeworkItems() {
  if (!homeworkAnalysis?.assignments?.length) { toast('Сначала распознай задание.', 'error'); return; }
  const now = new Date().toISOString();
  homeworkAnalysis.assignments.forEach((item, index) => {
    const task = String(item.task || '').trim(); if (!task) return;
    data.homework.push({ id: crypto.randomUUID(), title: item.title || item.subject || `Задание ${index + 1}`, subject: item.subject || 'Задание', task, dueDate: homeworkAnalysis.dueDate || selectedDueDate(), classLabel: item.classLabel || homeworkAnalysis.classLabel || data.selectedClass, createdAt: now, completed: false, attempted: false, solution: null, source: pendingHomeworkImage ? 'image' : 'text' });
  });
  persist(); renderHomework(); renderHome(); toast('Задания добавлены. Подготовка решений останется скрытой.', 'success');
  const added = data.homework.filter(item => item.dueDate === tomorrowKey() && !item.solution && !item.completed);
  if (added.length) prepareDueAssignments(false);
  homeworkAnalysis = null; document.getElementById('homework-analysis-result').classList.add('hidden'); document.getElementById('homework-text').value = ''; pendingHomeworkImage = null; setFilePreview('homework-file-preview', null, value => pendingHomeworkImage = value);
  openView('homework');
}
function addHomeworkAsRawText() {
  const text = document.getElementById('homework-text').value.trim();
  if (!text) { toast('Введи текст задания, чтобы сохранить его вручную.', 'error'); return; }
  data.homework.push({ id: crypto.randomUUID(), title: 'Задание из текста', subject: 'Не разобрано', task: text, dueDate: selectedDueDate(), classLabel: document.getElementById('homework-class').value, createdAt: new Date().toISOString(), completed: false, attempted: false, solution: null, source: 'manual' });
  persist(); renderHomework(); renderHome(); toast('Текст сохранён без анализа ИИ.', 'success'); document.getElementById('homework-text').value = ''; openView('homework');
}

async function solveAssignment(id) {
  const item = data.homework.find(entry => entry.id === id);
  if (!item) return;
  if (item.solution) { revealedSolutions.has(id) ? revealedSolutions.delete(id) : revealedSolutions.add(id); renderHomework(); return; }
  if (preparingIds.has(id)) return;
  preparingIds.add(id); renderHomework();
  try {
    const solution = await callAI({ type: 'solve_homework', classLabel: item.classLabel, text: `${item.subject}: ${item.task}` });
    item.solution = solution; item.solutionCreatedAt = new Date().toISOString(); persist(); revealedSolutions.add(id); renderHomework(); toast('Решение готово. Оно показано по твоему запросу.', 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { preparingIds.delete(id); renderHomework(); }
}
async function prepareDueAssignments(showToast = true) {
  const targets = data.homework.filter(item => item.dueDate === tomorrowKey() && !item.completed && !item.solution && !preparingIds.has(item.id) && String(item.task || '').trim());
  if (!targets.length) { if (showToast) toast('Все задания на завтра уже подготовлены или пока отсутствуют.'); return; }
  if (showToast) toast(`Готовлю скрытые решения: ${targets.length} ${targets.length === 1 ? 'задание' : 'задания'}.`);
  for (const item of targets) {
    preparingIds.add(item.id); renderHomework();
    try {
      const solution = await callAI({ type: 'solve_homework', classLabel: item.classLabel, text: `${item.subject}: ${item.task}` });
      item.solution = solution; item.solutionCreatedAt = new Date().toISOString();
      persist();
    } catch (error) {
      if (error.code !== 'AI_NOT_CONFIGURED' && showToast) toast(`Не удалось подготовить решение: ${error.message}`, 'error');
      break;
    } finally { preparingIds.delete(item.id); }
    renderHomework(); renderHome();
  }
  if (showToast) toast('Готово: доступные решения сохранены и скрыты.', 'success');
}
function checkAccessibleMaterials() {
  data.lastCheck = new Date().toISOString(); persist(); renderHome();
  setSyncLabel('Материалы проверены');
  const due = data.homework.filter(item => item.dueDate === tomorrowKey() && !item.completed && !item.solution);
  if (due.length) prepareDueAssignments(false);
  if (navigator.onLine) setSyncLabel('Материалы проверены'); else setSyncLabel('Офлайн');
}

async function analyzeSchedule(image = pendingScheduleImage || pendingAdminImage, text = '', fromSettings = false) {
  const classInput = document.getElementById(fromSettings ? 'settings-schedule-class' : 'schedule-class');
  const classLabel = (classInput?.value || data.selectedClass || '7А').trim();
  const adminPin = fromSettings ? document.getElementById('schedule-pin').value : ''; 
  if (!image && !text.trim()) { toast('Сначала выбери изображение или введи текст расписания.', 'error'); return; }
  if (fromSettings && !adminPin) { toast('Введи PIN импорта в Настройках. Он проверяется на сервере.', 'error'); openView('settings'); document.getElementById('schedule-pin').focus(); return; }
  const button = document.getElementById('analyze-schedule'); const adminButton = document.getElementById('admin-import');
  if (button) { button.disabled = true; button.textContent = 'Проверяем и распознаём…'; }
  if (adminButton) { adminButton.disabled = true; adminButton.textContent = 'Проверяем PIN…'; }
  const output = document.getElementById(fromSettings ? 'admin-schedule-analysis-result' : 'schedule-analysis-result'); const status = document.getElementById('admin-import-status');
  try {
    const result = await callAI({ type: 'analyze_schedule', classLabel, ...(fromSettings ? { adminPin, adminImport: true } : {}), text, ...(image ? { imageBase64: image.base64, mimeType: image.mimeType } : {}) });
    const items = Array.isArray(result.scheduleItems) ? result.scheduleItems : [];
    scheduleAnalysis = { items, classLabel, notes: result.notes || '' };
    if (status) status.textContent = `Распознано строк: ${items.length}. Проверь результат и сохрани.`;
    output.classList.remove('hidden');
    output.innerHTML = `<h3>Распознанное расписание · ${escapeHtml(result.classLabel || classLabel)}</h3>${items.length ? items.map(item => `<div class="analysis-item"><strong>${escapeHtml(item.day || 'День не определён')} · урок ${escapeHtml(item.lessonNumber || '?')}</strong><p>${escapeHtml(item.subject || 'Предмет не распознан')}${item.room ? ` · кабинет ${escapeHtml(item.room)}` : ''}</p></div>`).join('') : '<p class="helper-text">Предметы не распознаны. Добавь более чёткое фото.</p>'}<div class="result-actions"><button class="primary-button" data-result-action="save-schedule" ${items.length ? '' : 'disabled'}>Сохранить расписание</button><button class="soft-button" data-result-action="clear-schedule">Отмена</button></div>${result.notes ? `<p class="helper-text">${escapeHtml(result.notes)}</p>` : ''}`;
    toast(`Расписание распознано: ${items.length} строк. Сохраняй только после проверки.`, 'success');
    document.getElementById('schedule-pin').value = '';
  } catch (error) {
    if (error.code === 'AI_NOT_CONFIGURED' && !fromSettings && text.trim()) {
      const parsed = parseScheduleTextLocally(text, document.getElementById('schedule-day').value, classLabel); scheduleAnalysis = { items: parsed.scheduleItems, classLabel, notes: parsed.notes };
      output.classList.remove('hidden'); output.innerHTML = `<h3>Черновик расписания · без ИИ</h3>${scheduleAnalysis.items.length ? scheduleAnalysis.items.map(item => `<div class="analysis-item"><strong>${escapeHtml(item.day)} · урок ${escapeHtml(item.lessonNumber)}</strong><p>${escapeHtml(item.subject)}</p></div>`).join('') : '<p class="helper-text">Формат: Пн — 1. Математика, 2. Русский язык.</p>'}<p class="helper-text">${escapeHtml(parsed.notes)}</p><div class="result-actions"><button class="primary-button" data-result-action="save-schedule" ${scheduleAnalysis.items.length ? '' : 'disabled'}>Сохранить расписание</button><button class="soft-button" data-result-action="clear-schedule">Отмена</button></div>`;
      if (status) status.textContent = `Локально выделено уроков: ${scheduleAnalysis.items.length}. Проверь данные.`; toast('Создан черновик расписания из текста.', 'success');
    } else { if (status) status.textContent = error.message; showRequestError(output, error, null); toast(error.message, 'error'); }
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Распознать и сохранить'; }
    if (adminButton) { adminButton.disabled = false; adminButton.textContent = 'Проверить PIN и распознать'; }
  }
}
function saveScheduleResult() {
  if (!scheduleAnalysis?.items?.length) return;
  const knownDays = new Set(DAY_KEYS);
  let saved = 0;
  for (const item of scheduleAnalysis.items) {
    const number = Number(item.lessonNumber);
    const day = DAY_KEYS.includes(item.day) ? item.day : selectedDay;
    const subject = String(item.subject || '').trim();
    if (!Number.isInteger(number) || number < 1 || number > 6 || !subject || (item.day && !knownDays.has(item.day))) continue;
    data.timetable = data.timetable.filter(entry => !(entry.classLabel === (item.classLabel || scheduleAnalysis.classLabel) && entry.day === day && Number(entry.lessonNumber) === number));
    data.timetable.push({ classLabel: item.classLabel || scheduleAnalysis.classLabel, day, lessonNumber: number, subject, room: String(item.room || '') }); saved += 1;
  }
  data.selectedClass = scheduleAnalysis.classLabel || data.selectedClass; selectedDay = scheduleAnalysis.items[0].day || selectedDay;
  persist(); renderClassSelectors(); renderSchedule(); renderHome(); toast(`Сохранено строк расписания: ${saved}.`, 'success');
  scheduleAnalysis = null; document.getElementById('schedule-analysis-result').classList.add('hidden'); document.getElementById('admin-schedule-analysis-result').classList.add('hidden'); pendingScheduleImage = null; pendingAdminImage = null; setFilePreview('schedule-file-preview', null, value => pendingScheduleImage = value); setFilePreview('admin-schedule-file-preview', null, value => pendingAdminImage = value);
  openView('schedule');
}

async function sendChatMessage(event) {
  event.preventDefault();
  const input = document.getElementById('chat-input'); const text = input.value.trim(); if (!text) return;
  const messages = document.getElementById('chat-messages');
  messages.insertAdjacentHTML('beforeend', `<div class="chat-message user-message">${escapeHtml(text)}</div>`);
  input.value = ''; messages.scrollTop = messages.scrollHeight;
  const pending = document.createElement('div'); pending.className = 'chat-message assistant-message'; pending.textContent = 'Думаю над ответом…'; messages.append(pending);
  try {
    const result = await callAI({ type: 'chat', classLabel: data.selectedClass, question: text });
    pending.textContent = `${result.answer || ''}${result.explanation ? `\n\n${result.explanation}` : ''}${Array.isArray(result.steps) && result.steps.length ? `\n\n${result.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}` : ''}`;
  } catch (error) { pending.textContent = error.message; pending.classList.add('error'); }
  messages.scrollTop = messages.scrollHeight;
}

function startNotificationTimer() {
  clearInterval(reminderTimer);
  reminderTimer = setInterval(checkLessonReminder, 15_000);
}
function nextLessonStartingSoon() {
  const now = new Date(); const today = weekdayShort(now);
  if (!DAY_KEYS.includes(today)) return null;
  const entries = entriesFor(data.selectedClass, today);
  const timeline = buildTimeline(entries, { classLabel: data.selectedClass, day: today, lessonCount: lessonCountFor(data.selectedClass, today) });
  for (const item of timeline.filter(entry => entry.type === 'lesson')) {
    const startDate = new Date(now); startDate.setHours(Math.floor(item.start / 60), item.start % 60, 0, 0);
    const delta = startDate.getTime() - now.getTime();
    if (delta >= 4 * 60_000 + 45_000 && delta <= 5 * 60_000 + 10_000) return { item, delta, dateKey: localDateKey(now) };
  }
  return null;
}
function checkLessonReminder() {
  if (!data.notificationEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const upcoming = nextLessonStartingSoon(); if (!upcoming) return;
  const key = `${upcoming.dateKey}-${upcoming.item.lessonNumber}-${data.selectedClass}`;
  if (key === lastReminderKey) return;
  lastReminderKey = key;
  const subject = isRealSubject(upcoming.item.subject) ? upcoming.item.subject : `урок №${upcoming.item.lessonNumber}`;
  const line = REMINDER_LINES[Math.floor(Math.random() * REMINDER_LINES.length)];
  try { new Notification(`Скоро ${subject}`, { body: line, tag: key, icon: '/icon.svg', timestamp: Date.now() }); } catch { /* Some browsers block notifications in in-app views. */ }
}
async function enableNotifications() {
  if (!('Notification' in window)) { toast('Этот браузер не поддерживает системные уведомления.', 'error'); return false; }
  let permission = Notification.permission;
  Soonpermission !== 'granted') permission = await Notification.requestPermission();
  if (permission !== 'granted') { data.notificationEnabled = false; persist(); hydrateSettings(); toast('Разрешение не выдано. Его можно включить в настройках браузера.', 'error'); return false; }
  data.notificationEnabled = true; persist(); hydrateSettings(); toast('Уведомления включены. Напоминания работают, пока приложение открыто.', 'success'); checkLessonReminder(); return true;
}
async function checkCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Камера недоступна в этом браузере. Можно загружать фото из галереи.', 'error'); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    cameraStream.getTracks().forEach(track => track.stop()); cameraStream = null;
    data.cameraPermission = true; persist(); hydrateSettings(); toast('Разрешение камеры подтверждено. Камера не остаётся включённой.', 'success');
  } catch (error) { toast(error?.name === 'NotAllowedError' ? 'Доступ к камере не разрешён. Фото можно выбрать из галереи.' : 'Не удалось проверить камеру. Можно загружать фото из галереи.', 'error'); }
}

function showOnboarding() {
  onboardingStep = 0; onboardingDraft = { name: data.profile.name || '', surname: data.profile.surname || '', manualMode: false, themeMode: data.profile.themeMode || 'auto', accent: data.profile.accent || COLORS[0].value, notifications: false, camera: false };
  selectedAccent = onboardingDraft.accent; selectedSecondaryAccent = data.profile.secondaryAccent || '#5adacb'; selectedTheme = onboardingDraft.themeMode; selectedManualMode = false;
  document.getElementById('onboarding-layer').classList.remove('hidden'); renderOnboarding();
}
function renderOnboarding() {
  const content = document.getElementById('onboarding-content');
  document.getElementById('onboard-progress-fill').style.width = `${((onboardingStep + 1) / 3) * 100}%`;
  SoononboardingStep === 0) {
    content.innerHTML = `<div class="onboard-step-count">ШАГ 1 ИЗ 3 · ЗНАКОМСТВО</div><h1 class="onboard-title" id="onboarding-title">Давай знакомиться<span class="gradient-text">.</span></h1><p class="onboard-copy">Настроим твоё учебное пространство так, чтобы в нём было спокойно, красиво и понятно.</p><div class="onboard-fields"><label class="onboard-field">Как тебя зовут? <input id="onboard-name" class="input-control" value="${escapeHtml(onboardingDraft.name)}" maxlength="30" autocomplete="given-name" placeholder="Например, Саша" required></label><label class="onboard-field">Фамилия <span class="muted">(необязательно)</span><input id="onboard-surname" class="input-control" value="${escapeHtml(onboardingDraft.surname)}" maxlength="50" autocomplete="family-name" placeholder="Можно пропустить"></label></div><div class="onboard-actions"><button class="onboard-back" data-onboard-action="skip">Позже</button><button class="primary-button" data-onboard-action="next">Продолжить <span>→</span></button></div>`;
  } else if (onboardingStep === 1) {
    content.innerHTML = `<div class="onboard-step-count">ШАГ 2 ИЗ 3 · ВНЕШНИЙ ВИД</div><h1 class="onboard-title" id="onboarding-title">Выбери свой стиль<span class="gradient-text">.</span></h1><p class="onboard-copy">Можно оставить автоматическую настройку или аккуратно собрать собственный интерфейс. Цвета можно поменять позже.</p><button class="mode-choice ${!selectedManualMode ? 'selected' : ''}" data-onboard-mode="auto"><span class="mode-radio"></span><span><strong>Автоматическая <small class="recommended-tag">Рекомендуем</small></strong><small>Приложение подберёт спокойную палитру на основе настроек устройства.</small></span></button><button class="mode-choice ${selectedManualMode ? 'selected' : ''}" data-onboard-mode="manual"><span class="mode-radio"></span><span><strong>Выбрать самому</strong><small>10 цветов акцента, своя палитра и светлая, тёмная или тёмно-синяя тема.</small></span></button>${selectedManualMode ? `<p class="mini-label" style="margin:14px 0 8px">ЦВЕТ АКЦЕНТА</p><div class="onboard-color-grid">${COLORS.map(c => `<button class="onboard-color ${c.value.toLowerCase() === selectedAccent.toLowerCase() ? 'selected' : ''}" data-onboard-accent="${c.value}" title="${escapeHtml(c.name)}" style="--swatch:${c.value}"></button>`).join('')}</div><div class="own-color-row"><span>Создать свою палитру</span><label class="color-input-wrap">Главный<input type="color" id="onboard-custom-color" value="${selectedAccent}" aria-label="Главный цвет палитры"></label><label class="color-input-wrap">Доп.<input type="color" id="onboard-custom-secondary-color" value="${selectedSecondaryAccent}" aria-label="Дополнительный цвет палитры"></label></div><p class="mini-label" style="margin:15px 0 7px">ТЕМА</p><div class="onboard-theme-row">${[['light','Светлая','light-preview'],['dark','Тёмная','dark-preview'],['navy','Тёмно-синяя','navy-preview']].map(([theme,label,preview]) => `<button class="theme-option ${selectedTheme === theme ? 'active' : ''}" data-onboard-theme="${theme}"><span class="theme-preview ${preview}"></span><strong>${label}</strong></button>`).join('')}</div>` : ''}<div class="onboard-actions"><button class="onboard-back" data-onboard-action="back">← Назад</button><button class="primary-button" data-onboard-action="next">Далее <span>→</span></button></div>`;
  } else {
    content.innerHTML = `<div class="onboard-step-count">ШАГ 3 ИЗ 3 · РАЗРЕШЕНИЯ</div><h1 class="onboard-title" id="onboarding-title">Последние настройки<span class="gradient-text">.</span></h1><p class="onboard-copy">Ничего не включается незаметно. Выбери, чем разрешить пользоваться приложению — можно пропустить и настроить позже.</p><div class="onboard-permission"><span class="onboard-permission-icon">♧</span><div class="onboard-permission-copy"><strong>Уведомления об уроках</strong><p id="onboard-notif-status">Смешное, но ненавязчивое напоминание за 5 минут.</p></div><button class="permission-inline-button" data-onboard-action="notifications">${onboardingDraft.notifications ? 'Включены ✓' : 'Разрешить'}</button></div><div class="onboard-permission"><span class="onboard-permission-icon">▣</span><div class="onboard-permission-copy"><strong>Камера</strong><p id="onboard-camera-status">Для фото заданий. Камера выключится сразу после проверки разрешения.</p></div><button class="permission-inline-button" data-onboard-action="camera">${onboardingDraft.camera ? 'Разрешена ✓' : 'Разрешить'}</button></div><p class="helper-text">Для уведомлений при закрытом сайте нужен отдельно настроенный push-сервис. Задания из официального дневника без API не загружаются автоматически.</p><div class="onboard-actions"><button class="onboard-back" data-onboard-action="back">← Назад</button><button class="primary-button" data-onboard-action="finish">Готово · открыть приложение <span>✳</span></button></div>`;
  }
  renderThemeControls();
}
function collectOnboardFields() {
  if (onboardingStep === 0) {
    onboardingDraft.name = document.getElementById('onboard-name')?.value.trim() || '';
    onboardingDraft.surname = document.getElementById('onboard-surname')?.value.trim() || '';
  }
}
async function onBoardAction(action) {
  if (action === 'skip') { onboardingDraft.name = ''; onboardingDraft.surname = ''; }
  if (action === 'back') { collectOnboardFields(); onboardingStep = Math.max(0, onboardingStep - 1); renderOnboarding(); return; }
  if (action === 'next') {
    collectOnboardFields();
    if (onboardingStep === 0 && !onboardingDraft.name) { toast('Введи имя или нажми «Позже».', 'error'); document.getElementById('onboard-name')?.focus(); return; }
    if (onboardingStep < 2) { onboardingStep += 1; renderOnboarding(); return; }
  }
  if (action === 'notifications') {
    const enabled = await enableNotifications(); onboardingDraft.notifications = enabled; renderOnboarding(); return;
  }
  if (action === 'camera') {
    await checkCameraPermission(); onboardingDraft.camera = data.cameraPermission; renderOnboarding(); return;
  }
  if (action === 'finish' || action === 'skip') {
    collectOnboardFields();
    if (!onboardingDraft.name && !action.endsWith('skip')) { /* A profile name is optional after an explicit skip. */ }
    data.profile = { ...data.profile, name: onboardingDraft.name, surname: onboardingDraft.surname, themeMode: selectedManualMode ? selectedTheme : 'auto', accent: selectedAccent || '#8b7bff', secondaryAccent: selectedSecondaryAccent || '#5adacb', manualMode: selectedManualMode };
    data.notificationEnabled = !!onboardingDraft.notifications && 'Notification' in window && Notification.permission === 'granted';
    data.cameraPermission = !!onboardingDraft.camera;
    data.onboarded = true; persist(); applyTheme();
    document.getElementById('onboarding-layer').classList.add('hidden');
    await runPreparation(); await runWelcome();
  }
}
async function runPreparation() {
  const layer = document.getElementById('preparation-layer'); layer.classList.remove('hidden');
  const fill = document.getElementById('prep-track-fill'); const title = document.getElementById('prep-title'); const description = document.getElementById('prep-description');
  // Every progress step is a real local initialization operation; no artificial 5–13 minute wait.
  renderClassSelectors(); renderSchedule(); renderHomework(); renderHome(); hydrateSettings();
  for (let i = 0; i < PREP_STEPS.length; i += 1) {
    const step = PREP_STEPS[i]; title.textContent = step.title; description.textContent = step.description; fill.style.width = `${step.percent}%`;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  layer.classList.add('hidden');
}
async function runWelcome() {
  const scene = document.getElementById('welcome-scene'); const name = data.profile.name.trim();
  const time = greetingPart();
  document.getElementById('welcome-time').textContent = `${time}${name ? ',' : ''}`;
  document.getElementById('welcome-name').textContent = name ? `${name}, добро пожаловать!` : 'Рады тебя видеть.';
  const sky = scene.querySelector('.welcome-sky'); const hour = new Date().getHours();
  sky.classList.toggle('day', hour >= 10 && hour < 17); sky.classList.toggle('evening', hour >= 17 && hour < 21); sky.classList.toggle('night', hour >= 21 || hour < 5);
  scene.classList.remove('hidden'); await new Promise(resolve => setTimeout(resolve, 2300)); scene.classList.add('hidden');
  openView('home'); startRuntimeTimers(); toast(name ? `Хорошо, ${name}! Всё готово.` : 'Всё готово. Удачной учёбы!', 'success');
  checkAccessibleMaterials();
}
function startRuntimeTimers() {
  clearInterval(clockTimer); clearInterval(materialTimer);
  clockTimer = setInterval(updateClockAndLive, 15_000);
  materialTimer = setInterval(checkAccessibleMaterials, 10 * 60_000);
  startNotificationTimer();
}

function saveProfile() {
  data.profile.name = document.getElementById('profile-name').value.trim();
  data.profile.surname = document.getElementById('profile-surname').value.trim();
  persist(); renderHome(); hydrateSettings(); toast('Профиль сохранён.', 'success');
}
function saveAppearance() {
  data.profile.accent = selectedAccent || data.profile.accent;
  persist(); applyTheme(); renderHome(); renderSchedule(); toast('Тема применена.', 'success');
}
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `moja-shkola-${todayKey()}.json`; anchor.click(); URL.revokeObjectURL(url); toast('Экспорт подготовлен.', 'success');
}

function wireFileInput(inputId, setPending, previewId) {
  const input = document.getElementById(inputId);
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    try { const image = await compressImage(file); setPending(image); setFilePreview(previewId, image, setPending); toast('Изображение подготовлено. Оно ещё не отправлено на сервер.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
    finally { input.value = ''; }
  });
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-nav]'); if (nav) { openView(nav.dataset.nav); return; }
  const actionEl = event.target.closest('[data-action]'); if (actionEl) { const action = actionEl.dataset.action; openView(action === 'settings' ? 'settings' : action); return; }
  const onboardAction = event.target.closest('[data-onboard-action]'); if (onboardAction) { await onBoardAction(onboardAction.dataset.onboardAction); return; }
  const onboardMode = event.target.closest('[data-onboard-mode]'); if (onboardMode) { selectedManualMode = onboardMode.dataset.onboardMode === 'manual'; onboardingDraft.manualMode = selectedManualMode; renderOnboarding(); return; }
  const onboardAccent = event.target.closest('[data-onboard-accent]'); if (onboardAccent) { selectedAccent = onboardAccent.dataset.onboardAccent; data.profile.accent = selectedAccent; renderThemeControls(); if (selectedManualMode) { document.querySelectorAll('[data-onboard-accent]').forEach(button => button.classList.toggle('selected', button.dataset.onboardAccent.toLowerCase() === selectedAccent.toLowerCase())); } return; }
  const onboardTheme = event.target.closest('[data-onboard-theme]'); if (onboardTheme) { selectedTheme = onboardTheme.dataset.onboardTheme; document.querySelectorAll('[data-onboard-theme]').forEach(button => button.classList.toggle('active', button.dataset.onboardTheme === selectedTheme)); return; }
  const themeButton = event.target.closest('.theme-option[data-theme]'); if (themeButton) { data.profile.themeMode = themeButton.dataset.theme; selectedTheme = data.profile.themeMode; persist(); applyTheme(); renderHome(); return; }
  const accentButton = event.target.closest('[data-accent]'); if (accentButton) { selectedAccent = accentButton.dataset.accent; data.profile.accent = selectedAccent; persist(); applyTheme(); return; }
  const dayButton = event.target.closest('[data-day]'); if (dayButton) { selectedDay = dayButton.dataset.day; renderSchedule(); return; }
  const aiMode = event.target.closest('[data-ai-mode]'); if (aiMode) { currentAiMode = aiMode.dataset.aiMode; document.querySelectorAll('[data-ai-mode]').forEach(button => button.classList.toggle('active', button.dataset.aiMode === currentAiMode)); document.querySelectorAll('[data-ai-pane]').forEach(pane => pane.classList.toggle('active', pane.dataset.aiPane === currentAiMode)); return; }
  if (event.target.closest('#load-local-model')) {
    const frame = document.getElementById('local-ai-frame');
    const wrap = document.getElementById('local-ai-frame-wrap');
    const status = document.getElementById('local-ai-status');
    if (!frame || !wrap || !status) return;
    if (!frame.dataset.started) {
      frame.dataset.started = 'true';
      status.textContent = 'Загружаем интерфейс анализатора. Скачивание весов модели может начаться внутри него и занять время; мы не можем показать его внутренний прогресс из-за изоляции сайтов.';
      frame.src = frame.dataset.src;
      frame.addEventListener('load', () => {
        status.textContent = 'Интерфейс анализатора открылся. Дождись его собственного сообщения о готовности модели, затем выбери фото внутри окна.';
      }, { once: true });
    } else {
      status.textContent = 'Анализатор уже запущен. Если модель ещё загружается, дождись сообщения о готовности внутри окна.';
    }
    wrap.classList.remove('hidden');
    document.getElementById('load-local-model').textContent = 'Анализатор запущен';
    return;
  }
  const hwFilter = event.target.closest('[data-hw-filter]'); if (hwFilter) { currentHomeworkFilter = hwFilter.dataset.hwFilter; renderHomework(); return; }
  const hwAction = event.target.closest('[data-hw-action]'); if (hwAction) {
    const id = hwAction.dataset.id; const item = data.homework.find(entry => entry.id === id); if (!item) return;
    if (hwAction.dataset.hwAction === 'show') { await solveAssignment(id); return; }
    if (hwAction.dataset.hwAction === 'attempted') { item.attempted = !item.attempted; persist(); renderHomework(); toast(item.attempted ? 'Отлично. Когда захочешь, можно открыть проверку.' : 'Отметка снята.'); return; }
    if (hwAction.dataset.hwAction === 'done') { item.completed = true; revealedSolutions.delete(id); persist(); renderHomework(); renderHome(); toast('Задание отмечено выполненным.', 'success'); return; }
    if (hwAction.dataset.hwAction === 'reopen') { item.completed = false; persist(); renderHomework(); renderHome(); return; }
  }
  const resultAction = event.target.closest('[data-result-action]'); if (resultAction) {
    if (resultAction.dataset.resultAction === 'save-homework') addHomeworkItems();
    if (resultAction.dataset.resultAction === 'save-schedule') saveScheduleResult();
    if (resultAction.dataset.resultAction === 'clear-homework') { homeworkAnalysis = null; document.getElementById('homework-analysis-result').classList.add('hidden'); }
    if (resultAction.dataset.resultAction === 'clear-schedule') { scheduleAnalysis = null; document.getElementById('schedule-analysis-result').classList.add('hidden'); }
    return;
  }
  const manualAdd = event.target.closest('[data-manual-add]'); if (manualAdd?.dataset.manualAdd === 'homework') { addHomeworkAsRawText(); return; }
  if (event.target.closest('#check-now')) { checkAccessibleMaterials(); toast('Проверены задания, сохранённые в приложении. Дневник не подключён.', 'success'); return; }
  if (event.target.closest('#save-profile')) { saveProfile(); return; }
  if (event.target.closest('#save-appearance')) { saveAppearance(); return; }
  if (event.target.closest('#notification-toggle')) {
    const on = event.target.closest('#notification-toggle').getAttribute('aria-checked') === 'true';
    if (on) { data.notificationEnabled = false; persist(); hydrateSettings(); toast('Напоминания выключены.'); }
    else await enableNotifications(); return;
  }
  if (event.target.closest('#camera-permission')) { await checkCameraPermission(); return; }
  if (event.target.closest('#analyze-homework')) { await analyzeHomework(); return; }
  if (event.target.closest('#analyze-schedule')) { await analyzeSchedule(pendingScheduleImage, document.getElementById('schedule-text').value); return; }
  if (event.target.closest('#admin-import')) { await analyzeSchedule(pendingAdminImage, '', true); return; }
  if (event.target.closest('#prepare-tomorrow')) { await prepareDueAssignments(true); return; }
  if (event.target.closest('#export-data')) { exportData(); return; }
  if (event.target.closest('#create-cloud-sync')) { await setupCloudSync(); return; }
  if (event.target.closest('#connect-cloud-sync')) { await connectCloudSync(); return; }
  if (event.target.closest('#copy-cloud-code')) { const code = document.getElementById('cloud-sync-code')?.value || getCloudToken(); if (code && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(code); toast('Облачный код скопирован.', 'success'); } else toast('Выдели и скопируй код вручную.', 'error'); return; }
  if (event.target.closest('#close-image-modal') || event.target.id === 'image-modal') { closeImageModal(); return; }
});

document.getElementById('chat-form').addEventListener('submit', sendChatMessage);
document.getElementById('homework-due').addEventListener('change', () => document.getElementById('custom-due-wrap').classList.toggle('hidden', document.getElementById('homework-due').value !== 'custom'));
document.getElementById('class-selector').addEventListener('change', event => { data.selectedClass = event.target.value; persist(); renderSchedule(); renderHome(); });
document.getElementById('homework-class').addEventListener('change', event => { data.selectedClass = event.target.value; persist(); });
document.getElementById('custom-color').addEventListener('input', event => { selectedAccent = event.target.value; data.profile.accent = selectedAccent; applyTheme(); });
document.getElementById('custom-color').addEventListener('change', () => saveAppearance());
document.getElementById('custom-secondary-color').addEventListener('input', event => { selectedSecondaryAccent = event.target.value; document.documentElement.style.setProperty('--accent-secondary', selectedSecondaryAccent); });
document.getElementById('custom-secondary-color').addEventListener('change', () => saveAppearance());
document.getElementById('onboarding-layer').addEventListener('input', event => {
  if (event.target.id === 'onboard-custom-color') { selectedAccent = event.target.value; document.querySelectorAll('[data-onboard-accent]').forEach(button => button.classList.toggle('selected', button.dataset.onboardAccent.toLowerCase() === selectedAccent.toLowerCase())); }
  if (event.target.id === 'onboard-custom-secondary-color') { selectedSecondaryAccent = event.target.value; document.documentElement.style.setProperty('--accent-secondary', selectedSecondaryAccent); }
});
wireFileInput('homework-file', value => pendingHomeworkImage = value, 'homework-file-preview');
wireFileInput('schedule-file', value => pendingScheduleImage = value, 'schedule-file-preview');
wireFileInput('settings-schedule-file', value => pendingAdminImage = value, 'admin-schedule-file-preview');

// Do not silently request camera or notification permissions: only explicit button actions can trigger prompts.
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (data.profile.themeMode === 'auto') { applyTheme(); renderHome(); } });
applyTheme(); renderClassSelectors(); renderHome(); renderSchedule(); renderHomework(); hydrateSettings();
if (!data.onboarded) showOnboarding();
else { openView('home'); startRuntimeTimers(); checkAccessibleMaterials(); if (getCloudToken()) syncCloud('pull'); }

window.addEventListener('online', () => { setSyncLabel('Онлайн'); checkAccessibleMaterials(); if (getCloudToken()) syncCloud('push'); });
window.addEventListener('offline', () => setSyncLabel('Офлайн'));
window.addEventListener('pagehide', () => { if (cameraStream) cameraStream.getTracks().forEach(track => track.stop()); clearInterval(clockTimer); clearInterval(materialTimer); clearInterval(reminderTimer); });
