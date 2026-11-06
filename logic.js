// Status Keeper: pure scheduling logic shared by the service worker and the popup.
// No Chrome APIs in this file, so it can be unit tested with plain Node.

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  useSchedule: true,
  // Monday first: Mon, Tue, Wed, Thu, Fri, Sat, Sun
  days: [true, true, true, true, true, false, false],
  start: "09:00",
  end: "17:30",
  lunchOn: true,
  lunchStart: "12:00",
  lunchEnd: "12:45",
  pauseOnLock: true,
  nudgeMin: 2,
  timerEnd: null,
  timerMin: null
});

export function withDefaults(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (!Array.isArray(s.days) || s.days.length !== 7) s.days = [...DEFAULT_SETTINGS.days];
  if (![1, 2, 4].includes(Number(s.nudgeMin))) s.nudgeMin = DEFAULT_SETTINGS.nudgeMin;
  return s;
}

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Monday = 0 ... Sunday = 6
export function dayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function atMinutes(date, minutes) {
  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

// The working blocks for one calendar day, as [startMin, endMin) pairs.
export function blocksForDay(s, date) {
  if (!s.days[dayIndex(date)]) return [];
  const start = toMinutes(s.start), end = toMinutes(s.end);
  if (start === null || end === null || end <= start) return [];
  const ls = toMinutes(s.lunchStart), le = toMinutes(s.lunchEnd);
  if (s.lunchOn && ls !== null && le !== null && le > ls && ls < end && le > start) {
    const blocks = [];
    if (ls > start) blocks.push([start, ls]);
    if (end > le) blocks.push([le, end]);
    return blocks;
  }
  return [[start, end]];
}

// Is `now` inside work hours? If so, when does the current block end?
export function scheduleNow(s, now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const [a, b] of blocksForDay(s, now)) {
    if (mins >= a && mins < b) return { inside: true, until: atMinutes(now, b) };
  }
  return { inside: false, until: null };
}

// Next time work hours begin, searching up to 8 days ahead.
export function nextStart(s, now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    for (const [a] of blocksForDay(s, day)) {
      if (offset > 0 || a > mins) return atMinutes(day, a);
    }
  }
  return null;
}

/**
 * What Status Keeper should be doing right now.
 * kind: "manual" (switched off), "locked" (paused), "timer", "active", "off" (outside hours)
 */
export function computeState(saved, now = new Date(), locked = false) {
  const s = withDefaults(saved);
  if (!s.enabled) return { kind: "manual", nudging: false };
  if (s.pauseOnLock && locked) return { kind: "locked", nudging: false };
  if (s.timerEnd && now.getTime() < s.timerEnd) {
    return { kind: "timer", nudging: true, until: new Date(s.timerEnd) };
  }
  if (!s.useSchedule) return { kind: "active", nudging: true, until: null };
  const sch = scheduleNow(s, now);
  if (sch.inside) return { kind: "active", nudging: true, until: sch.until };
  return { kind: "off", nudging: false, nextStart: nextStart(s, now) };
}

export function formatClock(date) {
  if (!date) return "";
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "5:30 PM" today, "Tomorrow 9:00 AM", or "Mon 9:00 AM"
export function formatWhen(date, now = new Date(), long = false) {
  if (!date) return "";
  if (sameDay(date, now)) return formatClock(date);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return `${long ? "tomorrow at" : "Tomorrow"} ${formatClock(date)}`;
  const names = long ? DAY_LONG : DAY_SHORT;
  return `${names[dayIndex(date)]}${long ? " at" : ""} ${formatClock(date)}`;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The Teams web addresses the extension works on. Keep in sync with manifest.json.
export const TEAMS_URLS = [
  "https://teams.microsoft.com/*",
  "https://teams.cloud.microsoft/*",
  "https://teams.live.com/*"
];
