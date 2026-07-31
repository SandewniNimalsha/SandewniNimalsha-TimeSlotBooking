# Time Slot Booking

A time-slot booking web app styled like an old cinema ticket booth: slots are
punched ticket stubs, booked slots visually stamp "BOOKED," and a live
countdown shows when a slot is being held by someone else mid-booking.

## Tech stack
- HTML / CSS / vanilla JavaScript (ES modules, no build step, no framework)
- Firebase Firestore — data storage + real-time sync across browser tabs
- Firebase Hosting — deployment

## How the website works

### 1. Choosing a day
Along the top, a horizontal row of day pills lets you pick a date. The window
always shows Aug 2, 2026 onward through 10 days past whatever "today" actually
is — so it stays current no matter when the app is opened, while still keeping
the task's demo dates (Aug 3–6) reachable. Days before today appear dimmed and
are view-only (their bookings can still be seen, but new bookings can't be
made on a day that's already passed). The current day is highlighted in gold,
and any day with existing bookings shows a small count badge.

### 2. Viewing slots
Selecting a day shows every 30-minute slot from 9:00 AM to 5:00 PM as a ticket
stub. Each stub's status is shown by its color and label:
- **● OPEN** — free to book
- **🔒 HELD** — someone else has it open in their booking form right now, with
  a live countdown until the hold expires
- **● BOOKED** — already reserved; shows who booked it, their category, and
  priority

### 3. Booking a slot
Tapping an open slot does two things:
1. Opens a side drawer with the booking form (name, category, priority, note).
2. Immediately creates a temporary **hold** on that slot (visible to every
   other visitor in real time, with a 2-minute countdown), so two people can't
   both be filling out the same slot's form without knowing it.

Submitting the form runs a Firestore **transaction**: it checks one more time
whether the slot is already booked, and only writes the booking if it isn't —
atomically, so this check can't be beaten even if two people submit at the
exact same instant. This transaction (not the hold/countdown, which is just a
visual cue) is what actually guarantees no double-booking. Closing the drawer
or letting the hold's timer run out releases the slot for others.

### 4. Filtering
A filter bar above the ticket grid lets you narrow what's shown by category,
by priority, or toggle "open slots only." Filters only hide non-matching
*booked* tickets — open slots always stay visible so you can keep browsing to
book, regardless of the active filter.

### 5. Cancelling a booking
If you booked a slot from your current browser, that ticket shows a small
"cancel" button, which deletes the booking and frees the slot again. This is
tracked by a random ID stored in your browser's `localStorage`, not real
login — see the note on this below.

## How duplicate/overlapping bookings are prevented
Two layers, in order of importance:

1. **Hard lock (the actual guarantee):** The booking document's ID is always
   `{date}_{slot}`. On submit, a Firestore transaction reads that document
   first and aborts the write if it already exists. Transactions are atomic,
   so this can't be beaten by timing, even by two submits in the same
   millisecond.
2. **Soft lock (UX only):** The `holds/{date_slot}` documents created while
   someone has a slot's form open are purely a visual heads-up for other
   users — they reduce wasted attempts, but they are not what makes
   double-booking impossible; the transaction is.

## Known limitation (worth mentioning in the interview)
The task specifies no login system, so there's no real user authentication.
The "cancel your own booking" feature is tracked by a random session ID in
`localStorage`, which is a UI convenience, not a security boundary — someone
could technically delete any booking by calling the Firestore API directly.
This doesn't affect the core anti-double-booking guarantee, since that's
enforced entirely by the create-transaction, independent of delete
permissions.

## Optional features included
- Filter bookings by category and priority, plus an "open slots only" toggle
- A rolling day-selector strip that doubles as a simple calendar view, with
  per-day booked-count badges
- Edit/cancel: booked slots can be deleted by whoever created them (see
  limitation above)

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
5. Open `index.html` (or your deployed URL) and add 5+ demo bookings from the
   app itself, or seed them directly in the Firestore console under
   `bookings/`.

## File structure
```
index.html         — markup
style.css          — ticket-booth theme (design tokens at top of file)
app.js             — Firestore logic, transaction-based booking, hold countdown, filters, rolling date window
firebase-config.js — your Firebase project keys (fill in after setup)
firestore.rules    — security rules (validates writes, blocks bypassing the transaction-based booking flow)
```
