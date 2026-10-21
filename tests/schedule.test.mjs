import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, findCurrentPhase, formatTime, inferLessonCount, lessonEndingAtFiveLessons, lessonEndingAtSixLessons, lessonStart, toMinutes } from '../public/schedule.js';

test('первый урок начинается в 08:30 и длится 45 минут', () => {
  assert.equal(lessonStart(1), 510);
  const first = buildTimeline([{ lessonNumber: 1, subject: 'Математика' }])[0];
  assert.equal(first.startText, '08:30');
  assert.equal(first.endText, '09:15');
});

test('перемены соответствуют длительности после 1–6 уроков', () => {
  const timeline = buildTimeline([]);
  assert.deepEqual(timeline.filter(x => x.type === 'break').map(x => x.duration), [10, 10, 15, 15, 10, 5]);
  assert.deepEqual(timeline.filter(x => x.type === 'lesson').map(x => [x.startText, x.endText]), [
    ['08:30', '09:15'], ['09:25', '10:10'], ['10:20', '11:05'], ['11:20', '12:05'], ['12:20', '13:05'], ['13:15', '14:00'],
  ]);
});

test('пять уроков заканчиваются в 13:05, шесть — в 14:00', () => {
  assert.equal(formatTime(lessonEndingAtFiveLessons()), '13:05');
  assert.equal(formatTime(lessonEndingAtSixLessons()), '14:00');
});

test('live-переключение на урок и перемену происходит на точных границах', () => {
  assert.equal(findCurrentPhase(8 * 60 + 29).phase, 'before');
  assert.equal(findCurrentPhase(8 * 60 + 30).phase, 'lesson');
  assert.equal(findCurrentPhase(9 * 60 + 14).phase, 'lesson');
  assert.equal(findCurrentPhase(9 * 60 + 15).phase, 'break');
  assert.equal(findCurrentPhase(9 * 60 + 24).phase, 'break');
  assert.equal(findCurrentPhase(9 * 60 + 25).lessonNumber, 2);
  assert.equal(findCurrentPhase(13 * 60 + 59).lessonNumber, 6);
  assert.equal(findCurrentPhase(14 * 60).phase, 'break');
  assert.equal(findCurrentPhase(14 * 60 + 4).phase, 'break');
  assert.equal(findCurrentPhase(14 * 60 + 5).phase, 'finished');
});

test('пятипредметное расписание заканчивает занятия после пятого урока в 13:05', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ lessonNumber: i + 1, subject: `Предмет ${i + 1}` }));
  assert.equal(inferLessonCount(entries), 5);
  const timeline = buildTimeline(entries);
  assert.equal(timeline.filter(x => x.type === 'lesson').at(-1).endText, '13:05');
  assert.equal(timeline.filter(x => x.type === 'break').at(-1).startText, '13:05');
  assert.equal(timeline.filter(x => x.type === 'break').at(-1).endText, '13:15');
});

test('пустой импорт не выдумывает предметы, расписание содержит только метки уроков', () => {
  const timeline = buildTimeline([]);
  assert.equal(timeline.find(x => x.type === 'lesson').subject, 'Урок 1');
  assert.equal(toMinutes('08:30'), 510);
  assert.equal(toMinutes('27:90'), null);
  assert.equal(toMinutes('8.30'), null);
});
