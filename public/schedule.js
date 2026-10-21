export const LESSON_MINUTES = 45;
export const FIRST_LESSON_START = 8 * 60 + 30;
export const BREAK_AFTER_LESSON = Object.freeze([10, 10, 15, 15, 10, 5]);
export const WEEK_DAYS = Object.freeze(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);

export function toMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function lessonStart(lessonNumber) {
  if (!Number.isInteger(lessonNumber) || lessonNumber < 1 || lessonNumber > 6) {
    throw new RangeError('Номер урока должен быть от 1 до 6');
  }
  let start = FIRST_LESSON_START;
  for (let number = 1; number < lessonNumber; number += 1) {
    start += LESSON_MINUTES + BREAK_AFTER_LESSON[number - 1];
  }
  return start;
}

export function inferLessonCount(entries = []) {
  const max = entries.reduce((highest, entry) => {
    const number = Number(entry.lessonNumber ?? entry.lesson ?? 0);
    return Number.isInteger(number) && number > highest ? number : highest;
  }, 0);
  return Math.min(6, Math.max(1, max || 6));
}

export function buildTimeline(entries = [], options = {}) {
  const count = Math.min(6, Math.max(1, Number(options.lessonCount) || inferLessonCount(entries)));
  const classLabel = options.classLabel || '';
  const day = options.day || '';
  const lessons = [];
  let cursor = FIRST_LESSON_START;
  for (let number = 1; number <= count; number += 1) {
    const match = entries.find((entry) => Number(entry.lessonNumber ?? entry.lesson) === number && (!entry.classLabel || entry.classLabel === classLabel) && (!entry.day || entry.day === day));
    const end = cursor + LESSON_MINUTES;
    lessons.push({
      type: 'lesson', lessonNumber: number, start: cursor, end,
      startText: formatTime(cursor), endText: formatTime(end),
      subject: match?.subject?.trim() || `Урок ${number}`,
      room: match?.room || '', teacher: match?.teacher || '', classLabel, day,
    });
    cursor = end;
    const duration = BREAK_AFTER_LESSON[number - 1];
    const breakEnd = cursor + duration;
    lessons.push({
      type: 'break', afterLesson: number, duration, start: cursor, end: breakEnd,
      startText: formatTime(cursor), endText: formatTime(breakEnd),
      subject: 'Перемена', classLabel, day,
    });
    cursor = breakEnd;
  }
  return lessons;
}

export function findCurrentPhase(now = new Date(), entries = [], options = {}) {
  const minutes = typeof now === 'number' ? now : now.getHours() * 60 + now.getMinutes();
  const timeline = buildTimeline(entries, options);
  const current = timeline.find((item) => minutes >= item.start && minutes < item.end);
  if (current) return { ...current, phase: current.type === 'break' ? 'break' : 'lesson', timeline };
  if (minutes < FIRST_LESSON_START) return { type: 'before', phase: 'before', start: FIRST_LESSON_START, startText: formatTime(FIRST_LESSON_START), timeline };
  const lastLesson = timeline.find((item) => item.type === 'lesson' && item.lessonNumber === inferLessonCount(timeline.filter((x) => x.type === 'lesson')));
  const lastEnd = lastLesson?.end ?? FIRST_LESSON_START;
  if (minutes >= lastEnd + BREAK_AFTER_LESSON[(lastLesson?.lessonNumber ?? 1) - 1]) {
    return { type: 'finished', phase: 'finished', end: lastEnd, endText: formatTime(lastEnd), timeline };
  }
  return { type: 'finished', phase: 'finished', end: lastEnd, endText: formatTime(lastEnd), timeline };
}

export function lessonEndingAtFiveLessons() {
  return lessonStart(5) + LESSON_MINUTES;
}

export function lessonEndingAtSixLessons() {
  return lessonStart(6) + LESSON_MINUTES;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function weekdayShort(date = new Date()) {
  return WEEK_DAYS[(date.getDay() + 6) % 7];
}
