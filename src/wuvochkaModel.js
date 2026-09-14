import { ROSTER } from './scheduleModel.js';

// Same team roster as "Расписание", plus a few extra Telegram usernames the
// user asked to let in — this app isn't team-scheduling, so it doesn't need
// to stay in lockstep with ROSTER itself, just start from it.
export const WUVOCHKA_ROSTER = [...ROSTER, 'alasssssska', 'andimandi03', 'hovin076'];
