# Marquee — Time Slot Booking

A time-slot booking app styled like an old cinema ticket booth: slots are punched
ticket stubs, booked slots visually "tear off," and a live countdown shows when a
slot is being held by someone else mid-booking.

## Tech stack
- HTML / CSS / vanilla JavaScript (ES modules, no build step)
- Firebase Firestore — data storage + real-time sync
- Firebase Hosting — deployment

## How duplicate/overlapping bookings are prevented
Two layers:

1. **Soft lock (UX):** When you tap an open slot, a `holds/{date_slot}` document is
   created with a 2-minute expiry. Every other open tab sees that slot flip to
   "🔒 held" in real time via `onSnapshot`, with a live countdown — so people don't
   even try to book something someone else is mid-filling.
2. **Hard lock (correctness):** The soft lock is just UX — it can't fully prevent a
   race by itself. The actual guarantee is a Firestore **transaction** on submit:
   the booking document ID is `{date}_{slot}` and the transaction reads that doc
   first; if it already exists, the write aborts with "already booked." Firestore
   transactions are atomic, so even two submits at the same millisecond can't both
   win — this is what actually makes double-booking impossible, not the countdown.

## Optional features included
- **Filter bar** — narrow visible bookings by category or priority, or toggle
  "open slots only" to quickly see availability.
- **Simple calendar view** — each day pill shows a live badge with how many
  slots are booked that day.
- **Cancel a booking** — a booking made from your browser shows a "cancel"
  button on its ticket. Since the task specifies no login, this is tracked
  by a random session ID stored in `localStorage`, not real authentication —
  worth mentioning in the interview as a known limitation: the Cancel button
  is a UI convenience, not a security boundary (anyone could delete any
  booking via the Firestore API directly). The core requirement — preventing
  duplicate/overlapping *bookings* — is unaffected, since that's enforced by
  the transaction on create, not by delete permissions.

## Setup
1. Create a Firebase project at https://console.firebase.google.com
2. Enable **Firestore Database** (production mode)
3. Copy your web app config into `firebase-config.js`
4. Deploy the rules in `firestore.rules`:
   ```
   npm install -g firebase-tools
   firebase login
   firebase init firestore hosting
   firebase deploy
   ```
5. Open `index.html` (or your deployed URL) and add 5+ demo bookings from the app
   itself, or seed them directly in the Firestore console under `bookings/`.

## File structure
```
index.html        — markup
style.css          — ticket-booth theme (tokens at top of file)
app.js             — Firestore logic, transaction-based booking, hold countdown
firebase-config.js — your Firebase project keys (fill in after setup)
firestore.rules    — security rules (blocks direct client writes to bookings
                      that would bypass the transaction / validation)
```
