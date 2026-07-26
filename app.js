import { firebaseConfig } from "./firebase-config.js";
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, runTransaction,
  setDoc, deleteDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ---------------- config ---------------- */
const HOLD_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const SESSION_ID = getOrCreateSessionId();
const SLOT_TIMES = buildSlotTimes("09:00", "17:00", 30); // 30-min increments
const DAYS = buildDemoDays(); // matches the task's demo data window

const CATEGORY_COLORS = {
  "Meeting": "#5b7fbd",
  "Interview": "#7a5bbd",
  "Discussion": "#5fa777",
  "Important Meeting": "#e0a63a",
  "Consultation": "#bd5b8a"
};

/* ---------------- state ---------------- */
let selectedDay = DAYS[0].value;
let bookings = {};   // { "date_slot": {...} }
let holds = {};       // { "date_slot": {...expiresAt} }
let activeSlotKey = null; // slot currently open in the drawer
let countdownTimer = null;
let filterCategory = "All";
let filterPriority = "All";
let filterOpenOnly = false;

/* ---------------- boot ---------------- */
renderDayRail();
listenBookings();
listenHolds();
wireDrawer();
wireFilters();
setInterval(renderGrid, 1000); // keep countdowns live even w/o new snapshots

function wireFilters() {
  document.getElementById("filterCategory").addEventListener("change", (e) => {
    filterCategory = e.target.value;
    renderGrid();
  });
  document.getElementById("filterPriority").addEventListener("change", (e) => {
    filterPriority = e.target.value;
    renderGrid();
  });
  document.getElementById("filterOpenOnly").addEventListener("change", (e) => {
    filterOpenOnly = e.target.checked;
    renderGrid();
  });
}

/* ================= Firestore listeners ================= */
function listenBookings() {
  onSnapshot(collection(db, "bookings"), (snap) => {
    bookings = {};
    snap.forEach((d) => (bookings[d.id] = d.data()));
    renderDayRail();
    renderGrid();
  });
}

function listenHolds() {
  onSnapshot(collection(db, "holds"), (snap) => {
    holds = {};
    snap.forEach((d) => (holds[d.id] = d.data()));
    renderGrid();
  });
}

/* ================= Rendering ================= */
function renderDayRail() {
  const rail = document.getElementById("dayRail");
  rail.innerHTML = "";
  DAYS.forEach((day) => {
    const count = Object.keys(bookings).filter((k) => k.startsWith(day.value + "_")).length;
    const pill = document.createElement("button");
    pill.className = "day-pill" + (day.value === selectedDay ? " active" : "");
    pill.innerHTML = `${day.label}${count ? `<span class="day-badge">${count}</span>` : ""}`;
    pill.onclick = () => {
      selectedDay = day.value;
      renderDayRail();
      renderGrid();
    };
    rail.appendChild(pill);
  });
}

function renderGrid() {
  const grid = document.getElementById("ticketGrid");
  grid.innerHTML = "";

  SLOT_TIMES.forEach((slot) => {
    const key = `${selectedDay}_${slot.id}`;
    const booking = bookings[key];
    const hold = holds[key];
    const holdActive = hold && hold.expiresAt.toMillis() > Date.now();
    const holdIsMine = holdActive && hold.sessionId === SESSION_ID;

    // Filters only narrow down what's BOOKED — open slots always stay
    // visible so you can still book them.
    if (booking && filterCategory !== "All" && booking.category !== filterCategory) return;
    if (booking && filterPriority !== "All" && booking.priority !== filterPriority) return;
    if (filterOpenOnly && booking) return;

    const el = document.createElement("div");
    const isMine = booking && booking.sessionId === SESSION_ID;
    el.className = "ticket " +
      (booking ? "is-booked" : holdActive && !holdIsMine ? "is-held" : "is-open");
    if (isMine) el.style.position = "relative";

    const catColor = booking ? CATEGORY_COLORS[booking.category] : null;

    el.innerHTML = `
      ${isMine ? `<button class="cancel-mine" data-key="${key}">cancel</button>` : ""}
      <div class="stub-top">
        <div class="time">${slot.label}</div>
        <div class="cat-row">
          ${booking
            ? `<i class="dot" style="background:${catColor}"></i>${booking.category}
               ${booking.priority ? `<span class="priority-tag priority-${booking.priority}">${booking.priority}</span>` : ""}`
            : holdActive && !holdIsMine
              ? "awaiting confirmation"
              : "tap to reserve"}
        </div>
      </div>
      <div class="tear"></div>
      <div class="stub-bottom">
        ${booking
          ? `<span class="status-booked">● BOOKED</span><span>${escapeHtml(booking.name)}</span>`
          : holdActive && !holdIsMine
            ? `<span class="status-held">🔒 HELD</span><span class="countdown">${formatCountdown(hold.expiresAt.toMillis())}</span>`
            : `<span class="status-open">● OPEN</span><span></span>`
        }
      </div>
    `;

    if (!booking && !(holdActive && !holdIsMine)) {
      el.addEventListener("click", () => openDrawer(selectedDay, slot));
    }

    const cancelBtn = el.querySelector(".cancel-mine");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        cancelBooking(key);
      });
    }

    grid.appendChild(el);
  });
}

async function cancelBooking(key) {
  try {
    await deleteDoc(doc(db, "bookings", key));
    log(`Cancelled ${labelForSlot(key.split("_")[1])}`);
  } catch (err) {
    log("Couldn't cancel — try again", true);
  }
}

/* ================= Drawer / hold lifecycle ================= */
async function openDrawer(date, slot) {
  const key = `${date}_${slot.id}`;
  activeSlotKey = key;

  document.getElementById("drawerMeta").textContent =
    `${formatDateLabel(date)} · ${slot.label}`;
  document.getElementById("formError").textContent = "";
  document.getElementById("bookingForm").reset();

  // Acquire a soft hold so other tabs see this slot as "held" live.
  try {
    await setDoc(doc(db, "holds", key), {
      date, timeSlot: slot.id, sessionId: SESSION_ID,
      expiresAt: Timestamp.fromMillis(Date.now() + HOLD_DURATION_MS)
    });
  } catch (e) {
    log("Couldn't acquire hold — try again", true);
    return;
  }

  showDrawer(true);
  startCountdown();
}

function startCountdown() {
  clearInterval(countdownTimer);
  const expiresAt = Date.now() + HOLD_DURATION_MS;
  countdownTimer = setInterval(() => {
    const msLeft = expiresAt - Date.now();
    if (msLeft <= 0) {
      clearInterval(countdownTimer);
      document.getElementById("countdownText").textContent = "0:00";
      log("Hold expired — slot released", true);
      releaseHoldAndClose();
      return;
    }
    document.getElementById("countdownText").textContent = formatCountdown(expiresAt);
  }, 250);
}

async function releaseHoldAndClose() {
  if (activeSlotKey) {
    deleteDoc(doc(db, "holds", activeSlotKey)).catch(() => {});
  }
  activeSlotKey = null;
  showDrawer(false);
  clearInterval(countdownTimer);
}

function showDrawer(show) {
  document.getElementById("drawer").classList.toggle("show", show);
  document.getElementById("drawerBackdrop").classList.toggle("show", show);
  document.getElementById("drawer").setAttribute("aria-hidden", String(!show));
}

function wireDrawer() {
  document.getElementById("cancelBtn").onclick = releaseHoldAndClose;
  document.getElementById("drawerBackdrop").onclick = releaseHoldAndClose;

  document.getElementById("bookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeSlotKey) return;

    const confirmBtn = document.getElementById("confirmBtn");
    const errorEl = document.getElementById("formError");
    confirmBtn.disabled = true;
    errorEl.textContent = "";

    const form = e.target;
    const [date, slotId] = activeSlotKey.split("_");
    const payload = {
      name: form.name.value.trim(),
      date,
      timeSlot: slotId,
      category: form.category.value,
      priority: form.priority.value,
      note: form.note.value.trim(),
      sessionId: SESSION_ID,
      createdAt: serverTimestamp()
    };

    try {
      // The transaction is the real anti-double-booking guarantee:
      // it reads the booking doc first and aborts the write if it
      // already exists, atomically — this is safe even if two people
      // submit at the exact same millisecond.
      await runTransaction(db, async (tx) => {
        const bookingRef = doc(db, "bookings", activeSlotKey);
        const existing = await tx.get(bookingRef);
        if (existing.exists()) {
          throw new Error("This slot was just booked by someone else.");
        }
        tx.set(bookingRef, payload);
      });

      await deleteDoc(doc(db, "holds", activeSlotKey)).catch(() => {});
      log(`Booked ${formatDateLabel(date)} · ${labelForSlot(slotId)}`);
      activeSlotKey = null;
      showDrawer(false);
      clearInterval(countdownTimer);
    } catch (err) {
      errorEl.textContent = err.message || "Booking failed — try another slot.";
      log(err.message || "Booking failed", true);
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

/* ================= Helpers ================= */
function buildSlotTimes(start, end, stepMinutes) {
  const slots = [];
  let [h, m] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  while (h < endH || (h === endH && m < endM)) {
    const startLabel = fmtTime(h, m);
    let m2 = m + stepMinutes, h2 = h;
    if (m2 >= 60) { m2 -= 60; h2 += 1; }
    const endLabel = fmtTime(h2, m2);
    slots.push({ id: `${pad(h)}${pad(m)}`, label: `${startLabel} – ${endLabel}` });
    h = h2; m = m2;
  }
  return slots;
}

function labelForSlot(slotId) {
  const found = SLOT_TIMES.find((s) => s.id === slotId);
  return found ? found.label : slotId;
}

function fmtTime(h, m) {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}
function pad(n) { return String(n).padStart(2, "0"); }

function buildDemoDays() {
  // Matches the recruitment task's demo window (3–6 Aug 2026) plus a
  // couple of extra nearby days so the calendar feels alive.
  const base = new Date(2026, 7, 3); // Aug is month index 7
  const days = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const value = d.toISOString().slice(0, 10);
    days.push({ value, label: formatDateLabel(value, true) });
  }
  return days;
}

function formatDateLabel(iso, short) {
  const d = new Date(iso + "T00:00:00");
  const opts = short
    ? { weekday: "short", month: "short", day: "numeric" }
    : { weekday: "long", month: "long", day: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

function formatCountdown(expiresAtMs) {
  const msLeft = Math.max(0, expiresAtMs - Date.now());
  const totalSec = Math.ceil(msLeft / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${pad(ss)}`;
}

function getOrCreateSessionId() {
  let id = localStorage.getItem("marquee_session_id");
  if (!id) {
    id = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("marquee_session_id", id);
  }
  return id;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function log(message, isError) {
  const stack = document.getElementById("logStack");
  const line = document.createElement("div");
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  line.className = "log-line" + (isError ? " error" : "");
  line.textContent = `[${time}] ${message}`;
  stack.appendChild(line);
  setTimeout(() => line.remove(), 5000);
}

// Release any hold this tab is holding if the user closes/reloads mid-form.
window.addEventListener("beforeunload", () => {
  if (activeSlotKey) {
    // best-effort; Firestore delete over navigator.sendBeacon isn't available,
    // so the 2-minute expiry is the real backstop here.
    deleteDoc(doc(db, "holds", activeSlotKey)).catch(() => {});
  }
});
