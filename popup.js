import { withDefaults, toMinutes, formatClock, formatWhen, formatDuration, TEAMS_URLS } from "./logic.js";

const $ = (id) => document.getElementById(id);
let settings = withDefaults(null);
let view = null;      // last state from the service worker
let tabInfo = { found: false, connected: false };

function hhmmToDate(hhmm) {
  const m = toMinutes(hhmm);
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
}
const short = (hhmm) => formatClock(hhmmToDate(hhmm)).replace(" AM", "").replace(" PM", "");

async function load() {
  const { settings: saved } = await chrome.storage.local.get("settings");
  settings = withDefaults(saved);
}

async function save(patch) {
  settings = withDefaults({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
  await refresh();
}

async function checkTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: TEAMS_URLS }); } catch {}
  tabInfo = { found: tabs.length > 0, connected: false };
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "status-keeper-ping" });
      if (res && res.ok) { tabInfo.connected = true; break; }
    } catch {}
  }
}

async function refresh() {
  try {
    view = await chrome.runtime.sendMessage({ type: "status-keeper-state" });
  } catch {
    view = null;
  }
  await checkTabs();
  render();
}

function nudgeCountdown() {
  if (!view || !view.lastNudge) return "";
  const next = view.lastNudge + settings.nudgeMin * 60000;
  const secs = Math.max(0, Math.round((next - Date.now()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function renderStatus() {
  const now = new Date();
  const kind = view ? view.kind : "active";
  const status = $("status");
  status.dataset.kind = kind;
  const openBtn = $("open-teams");
  openBtn.hidden = true;

  let label = "", head = "", sub = "", l2 = "Stops at", v2 = "–";
  if (kind === "active" || kind === "timer") {
    label = "KEEPING YOU AVAILABLE";
    if (kind === "timer") {
      head = "Timer running";
      l2 = "Timer ends";
      v2 = view.until ? formatWhen(new Date(view.until), now) : "–";
    } else {
      head = "You're showing as active";
      if (view && view.until) { l2 = "Stops at"; v2 = formatWhen(new Date(view.until), now); }
      else { l2 = "Schedule"; v2 = "Always on"; }
    }
    if (!tabInfo.found) {
      sub = "Open Teams in a browser tab to start";
      openBtn.hidden = false;
    } else if (!tabInfo.connected) {
      sub = "Reload your Teams tab to connect";
    } else {
      const c = nudgeCountdown();
      sub = c ? `Teams tab found · next nudge in ${c}` : "Teams tab found";
    }
  } else if (kind === "locked") {
    label = "PAUSED";
    head = "Your computer is locked";
    sub = "Resumes when you unlock it";
  } else if (kind === "off") {
    label = "OFF";
    head = "Outside your work hours";
    const next = view && view.nextStart ? new Date(view.nextStart) : null;
    sub = next ? `Starts again ${formatWhen(next, now, true)}` : "No work days set";
    l2 = "Next start";
    v2 = next ? formatWhen(next, now) : "–";
  } else {
    label = "TURNED OFF";
    head = "Status Keeper is off";
    sub = "Turn it on to keep your status active";
    l2 = "Schedule";
    v2 = "Paused";
  }
  $("s-label").textContent = label;
  $("s-head").textContent = head;
  $("s-sub").textContent = sub;
  $("s-today").textContent = formatDuration(view ? view.activeMs : 0);
  $("s-l2").textContent = l2;
  $("s-v2").textContent = v2;
}

function render() {
  $("master").setAttribute("aria-checked", String(settings.enabled));
  $("popup").classList.toggle("is-off", !settings.enabled);
  $("lockpause").setAttribute("aria-checked", String(settings.pauseOnLock));

  const timerOn = settings.timerEnd && Date.now() < settings.timerEnd;
  document.querySelectorAll(".chip[data-min]").forEach((c) => {
    c.setAttribute("aria-pressed", String(!!timerOn && Number(c.dataset.min) === settings.timerMin));
  });
  $("t-sched").setAttribute("aria-pressed", String(!timerOn));
  $("t-sched").textContent = settings.useSchedule ? "Schedule" : "Always";

  document.querySelectorAll(".day").forEach((d) => {
    d.setAttribute("aria-pressed", String(!!settings.days[Number(d.dataset.i)]));
  });
  $("hours-text").textContent = settings.useSchedule
    ? `${formatClock(hhmmToDate(settings.start))} – ${formatClock(hhmmToDate(settings.end))}`
    : "Any time";
  $("lunch-text").textContent = settings.useSchedule && settings.lunchOn
    ? `Lunch off ${short(settings.lunchStart)}–${short(settings.lunchEnd)}`
    : "";
  document.querySelectorAll(".seg button").forEach((b) => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.n) === settings.nudgeMin));
  });
  renderStatus();
}

function openEditor(open) {
  $("editor").hidden = !open;
  $("edit").setAttribute("aria-expanded", String(open));
  $("edit").textContent = open ? "Close" : "Edit";
  $("editor-error").hidden = true;
  if (open) {
    $("use-schedule").checked = settings.useSchedule;
    $("start").value = settings.start;
    $("end").value = settings.end;
    $("lunch-on").checked = settings.lunchOn;
    $("lunch-start").value = settings.lunchStart;
    $("lunch-end").value = settings.lunchEnd;
  }
}

function wire() {
  $("master").addEventListener("click", () => save({ enabled: !settings.enabled }));
  $("lockpause").addEventListener("click", () => save({ pauseOnLock: !settings.pauseOnLock }));

  document.querySelectorAll(".chip[data-min]").forEach((c) => c.addEventListener("click", () => {
    const min = Number(c.dataset.min);
    save({ enabled: true, timerMin: min, timerEnd: Date.now() + min * 60000 });
  }));
  $("t-sched").addEventListener("click", () => save({ timerEnd: null, timerMin: null }));

  document.querySelectorAll(".day").forEach((d) => d.addEventListener("click", () => {
    const days = [...settings.days];
    const i = Number(d.dataset.i);
    days[i] = !days[i];
    save({ days });
  }));

  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => save({ nudgeMin: Number(b.dataset.n) })));

  $("edit").addEventListener("click", () => openEditor($("editor").hidden));
  $("cancel").addEventListener("click", () => openEditor(false));
  $("editor").addEventListener("submit", (e) => {
    e.preventDefault();
    const start = $("start").value, end = $("end").value;
    const lunchOn = $("lunch-on").checked;
    const ls = $("lunch-start").value, le = $("lunch-end").value;
    const err = $("editor-error");
    let msg = "";
    if (toMinutes(start) === null || toMinutes(end) === null) msg = "Enter a start and end time.";
    else if (toMinutes(end) <= toMinutes(start)) msg = "End time must be after the start time.";
    else if (lunchOn && (toMinutes(ls) === null || toMinutes(le) === null || toMinutes(le) <= toMinutes(ls))) msg = "Lunch must end after it starts.";
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    save({ useSchedule: $("use-schedule").checked, start, end, lunchOn, lunchStart: ls || settings.lunchStart, lunchEnd: le || settings.lunchEnd });
    openEditor(false);
  });

  $("open-teams").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://teams.microsoft.com/" });
    window.close();
  });
}

(async function init() {
  await load();
  wire();
  render();
  await refresh();
  setInterval(renderStatus, 1000);
  setInterval(refresh, 15000);
})();
