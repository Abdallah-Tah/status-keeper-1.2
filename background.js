// Status Keeper service worker: decides when to nudge, counts active time,
// and pauses when the computer is locked.
import { computeState, withDefaults, dayKey, TEAMS_URLS } from "./logic.js";

const TICK = "status-keeper-tick";
const LOCK_IDLE_SECONDS = 60;

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return withDefaults(settings);
}

async function getRuntime() {
  const { runtime } = await chrome.storage.local.get("runtime");
  return { lastNudge: 0, lastTick: 0, lastNudging: false, day: "", activeMs: 0, ...(runtime || {}) };
}

async function isLocked() {
  try {
    return (await chrome.idle.queryState(LOCK_IDLE_SECONDS)) === "locked";
  } catch {
    return false;
  }
}

async function teamsTabs() {
  try {
    return await chrome.tabs.query({ url: TEAMS_URLS });
  } catch {
    return [];
  }
}

async function nudgeTabs() {
  const tabs = await teamsTabs();
  let reached = 0;
  await Promise.all(tabs.map(async (tab) => {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "status-keeper-nudge" });
      if (res && res.ok) reached++;
    } catch {
      // Tab was open before the extension loaded; it connects after a reload.
    }
  }));
  return reached;
}

let running = null;
async function tick() {
  // Never run two ticks at once.
  if (running) return running;
  running = (async () => {
    const now = new Date();
    const settings = await getSettings();
    const runtime = await getRuntime();
    const locked = await isLocked();

    // A finished timer hands back to the schedule.
    if (settings.timerEnd && now.getTime() >= settings.timerEnd) {
      settings.timerEnd = null;
    settings.timerMin = null;
      await chrome.storage.local.set({ settings });
    }

    const state = computeState(settings, now, locked);

    // Count active time for today.
    const today = dayKey(now);
    if (runtime.day !== today) {
      runtime.day = today;
      runtime.activeMs = 0;
    } else if (runtime.lastNudging && runtime.lastTick) {
      const gap = now.getTime() - runtime.lastTick;
      if (gap > 0 && gap <= 3 * 60 * 1000) runtime.activeMs += gap;
    }

    if (state.nudging) {
      const due = runtime.lastNudge + settings.nudgeMin * 60 * 1000 - 5000;
      if (!runtime.lastNudging || now.getTime() >= due) {
        await nudgeTabs();
        runtime.lastNudge = now.getTime();
      }
    }

    runtime.lastTick = now.getTime();
    runtime.lastNudging = state.nudging;
    await chrome.storage.local.set({ runtime });
    await updateAction(state);
    return { state, runtime, settings };
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function updateAction(state) {
  const titles = {
    active: "Status Keeper: keeping you active",
    timer: "Status Keeper: timer running",
    locked: "Status Keeper: paused while your computer is locked",
    off: "Status Keeper: outside your work hours",
    manual: "Status Keeper: off"
  };
  try {
    await chrome.action.setTitle({ title: titles[state.kind] || "Status Keeper" });
  } catch {}
}

function ensureAlarm() {
  chrome.alarms.get(TICK, (alarm) => {
    if (!alarm) chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: withDefaults(settings) });
  ensureAlarm();
  tick();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  tick();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) tick();
});

chrome.idle.setDetectionInterval(LOCK_IDLE_SECONDS);
chrome.idle.onStateChanged.addListener(() => tick());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) tick();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "status-keeper-state") {
    tick().then((result) => sendResponse({
      kind: result.state.kind,
      until: result.state.until ? result.state.until.getTime() : null,
      nextStart: result.state.nextStart ? result.state.nextStart.getTime() : null,
      lastNudge: result.runtime.lastNudge,
      activeMs: result.runtime.activeMs
    }));
    return true;
  }
  return false;
});

ensureAlarm();
