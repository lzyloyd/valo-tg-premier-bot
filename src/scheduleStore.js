import { currentTeam, refreshTeamRoster } from './scheduleTeams.js';
import { serial, readJson, atomicJson } from './schedulePersistence.js';
import { teamDays, daysForWeek, currentWeekStart, weekDeadline, weekStartFromIso, mskIsoDate } from './scheduleModel.js';
function emptyWeek(weekStart) {
  return { weekStart: mskIsoDate(weekStart), responses: {}, daysOff: [], customSlots: {}, customSlotNames: {}, premierTimesVersion: 2, lastSaved: {}, edits: [], summaryMessageId: null };
}
async function loadUnlocked(now) {
  await refreshTeamRoster();
  const wanted = mskIsoDate(currentWeekStart(now));
  const stored = await readJson(currentTeam().schedulePath, null);
  if (stored && stored.premierTimesVersion !== 2) {
    // Availability for 20/22 does not imply availability for 21/23.
    const allowed = daysForWeek(stored).find(d => d.key === 'sat').slots;
    for (const answers of Object.values(stored.responses || {})) {
      if (answers.sat?.avail !== 'yes') continue;
      answers.sat.slots = answers.sat.slots.filter(time => allowed.includes(time));
      if (!answers.sat.slots.length) delete answers.sat;
    }
    stored.premierTimesVersion = 2;
    await atomicJson(currentTeam().schedulePath, stored);
  }
  if (stored?.weekStart === wanted) {
    // A yes for the old kickoff is not consent to the new time. Keep custom
    // slots and answers for every other day when Clarity's defaults change.
    if (currentTeam().id === 'team2') {
      let changed = false;
      for (const day of daysForWeek(stored).filter(d => ['thu','sat','sun'].includes(d.key))) {
        for (const answers of Object.values(stored.responses || {})) {
          const answer = answers[day.key];
          if (answer?.avail !== 'yes') continue;
          const slots = answer.slots.filter(time => day.slots.includes(time));
          if (slots.length === answer.slots.length) continue;
          if (slots.length) answer.slots = slots;
          else delete answers[day.key];
          changed = true;
        }
      }
      if (changed) await atomicJson(currentTeam().schedulePath, stored);
    }
    return stored;
  }
  if (stored && mskIsoDate(new Date(weekStartFromIso(stored.weekStart).getTime() - 86400000)) === wanted) {
    stored.weekStart = wanted;
    await atomicJson(currentTeam().schedulePath, stored);
    return stored;
  }
  const fresh = emptyWeek(currentWeekStart(now));
  await atomicJson(currentTeam().schedulePath, fresh);
  return fresh;
}
export function loadCurrentWeek(now = new Date()) {
  return serial(currentTeam().schedulePath, () => loadUnlocked(now));
}
function mutateWeek(now, work) {
  return serial(currentTeam().schedulePath, async () => {
    const week = await loadUnlocked(now);
    const result = await work(week);
    await atomicJson(currentTeam().schedulePath, week);
    return result ?? week;
  });
}
export function resetToNextWeek(nextWeekStart) {
  return serial(currentTeam().schedulePath, async () => {
    const week = emptyWeek(nextWeekStart);
    await atomicJson(currentTeam().schedulePath, week);
    return week;
  });
}
export async function runWeeklyReset() {
  const week = await resetToNextWeek(currentWeekStart());
  console.log(`[schedule] ${currentTeam().id}: reset to week ${week.weekStart}`);
  return week;
}
export function setResponse(username, day, avail, slots, now = new Date()) {
  return mutateWeek(now, week => {
    const definition = daysForWeek(week).find(d => d.key === day);
    if (!definition || !definition.slots.length || !['yes','no',null].includes(avail) || !Array.isArray(slots) || slots.some(s => !definition.slots.includes(s)) || (avail === 'yes' && !slots.length)) throw new Error('Некорректное время сборов. Обнови расписание.');
    const isPostDeadlineEdit = now > weekDeadline(currentWeekStart(now));
    week.responses[username] ??= {};
    const previous = week.responses[username][day];
    if (avail === null) delete week.responses[username][day];
    else week.responses[username][day] = {avail, slots: avail === 'yes' ? [...new Set(slots)] : []};
    week.lastSaved ??= {};
    week.lastSaved[username] = now.toISOString();
    week.edits ??= [];
    if (isPostDeadlineEdit) {
      week.edits.unshift({username, day, before: previous ?? null, after: week.responses[username][day] ?? null, at: now.toISOString()});
      week.edits = week.edits.slice(0,50);
    }
    return {week, isPostDeadlineEdit};
  });
}
export function addCustomSlot(day, time, expectedWeekStart, name, now = new Date()) {
  return mutateWeek(now, week => {
    if (expectedWeekStart !== week.weekStart) throw new Error('Началась новая неделя. Обнови расписание.');
    if (!teamDays().some(d => d.key === day) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Укажи время в формате ЧЧ:ММ (МСК).');
    name = typeof name === 'string' ? name.trim().replace(/\s+/g,' ') : '';
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Укажи название сбора, до 60 символов.');
    const definition = daysForWeek(week).find(d => d.key === day);
    if (week.daysOff?.includes(day)) throw new Error('На этот день отмечен выходной.');
    if (definition.slots.includes(time)) throw new Error('Это время уже есть в расписании.');
    if (definition.slots.length >= 12) throw new Error('На день можно добавить не больше 12 вариантов времени.');
    week.customSlots ??= {};
    week.customSlots[day] = [...(week.customSlots[day] || []), time].sort();
    week.customSlotNames ??= {};
    week.customSlotNames[day] ??= {};
    week.customSlotNames[day][time] = name;
  });
}
export function setDayOff(day, isOff, now = new Date()) {
  return mutateWeek(now, week => {
    if (!teamDays().some(d => d.key === day)) throw new Error('Неизвестный день.');
    week.daysOff = isOff ? [...new Set([...(week.daysOff || []),day])] : (week.daysOff || []).filter(d => d !== day);
  });
}
export function saveSummaryMessageId(messageId) {
  return mutateWeek(new Date(), week => { week.summaryMessageId = messageId; });
}

export function removeCustomSlot(day, time, expectedWeekStart, now = new Date()) {
  return mutateWeek(now, week => {
    if (expectedWeekStart !== week.weekStart) throw new Error('Началась новая неделя. Обнови расписание.');
    const definition = teamDays().find(d => d.key === day);
    if (!definition || !(week.customSlots?.[day] || []).includes(time)) throw new Error('Можно удалять только кастомные сборы.');
    week.customSlots[day] = week.customSlots[day].filter(slot => slot !== time);
    if (week.customSlotNames?.[day]) delete week.customSlotNames[day][time];
    if (!definition.slots.includes(time)) {
      for (const answers of Object.values(week.responses)) {
        const answer = answers[day];
        if (answer?.avail === 'yes') {
          answer.slots = answer.slots.filter(slot => slot !== time);
          if (!answer.slots.length) delete answers[day];
        }
      }
    }
  });
}
