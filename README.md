# My TV — App Scaffold

Starting scaffold for the KaiOS 3 channel browser described in `requirements.md`
(in the project docs). This is intentionally minimal — it wires together the
decisions made so far so you have something real to run and iterate on, not a
finished app.

## What's here

- `manifest.webmanifest` — KaiOS app manifest (privileged app, landscape,
  fullscreen, softkey navigation enabled), now pointing at real icon files.
- `index.html` — single screen: video element, channel banner, numeric
  channel-entry overlay, a fading SoftLeft/SoftRight softkey legend,
  loading/error states.
- `css/style.css` — layout for the above.
- `js/channels.js` — fetches `channels.json` from GitHub, caches it locally,
  applies the language/subtitles filter. **You still need to set
  `CHANNELS_URL`** to your actual repo's raw content URL before this does
  anything.
- `js/blocklist.js` — channels that never appear in the app: specific ids
  (currently `KaloopyTV.us`, `FashionTVSecrets.fr`, `FashionBox.nl`), any
  channel in an `xxx`/`adult` category, or flagged `is_nsfw`. Applied right
  after the list loads, so it also covers a stale cache.
  `tools/build_channels.py` has a matching filter (keep the two in sync);
  to block a channel, add its `id` to both.
- `js/player.js` — loads a channel's stream into the `<video>` element,
  using native HLS where available and falling back to hls.js. Reports
  playback failures so the app can auto-skip. hls.js is configured with
  `backBufferLength: 30` — its default is to never evict already-played
  buffer, which on a live channel left running a long time (a news
  channel, reported by hand) grows memory until the app crashes. This
  caps how much already-played video stays buffered behind the current
  position.
- `js/vendor/hls.min.js` — hls.js, pinned at v1.7.3 (installed via
  `npm install hls.js`, verified against npm's published release). Loaded
  as a fallback where native HLS isn't available.
- `js/settings.js` — localStorage-backed prefs: theme (dark/light),
  background-playback opt-in, favorite channel ids. Loaded first so the
  saved theme applies before first paint.
- `js/schedule.js` — **placeholder EPG data.** iptv-org only gives a
  per-channel guide *source* URL, not real program listings (real XMLTV
  parsing is still phase two — see `free-resources.md` section 3). This
  generates a deterministic, obviously-fake schedule (titles like "News
  Block #4") so Browse Channels has real start/end times to navigate.
- `js/notifications.js` — schedules two tune-in reminder notifications for
  a future program you pick in Browse Channels (5 minutes prior, at
  start) via the KaiOS/B2G Alarm API (`navigator.mozAlarms`) when
  available, falling back to an in-page timer + `Notification` (only
  fires while the tab/app stays open) in a normal browser. Verify
  `navigator.mozAlarms` on-device.
- `js/ads.js` — banner ad strip (rotates every 30s) and a fullscreen ad
  (every 10 minutes in rotated/immersive mode). **Placeholder creatives**
  — there's no real ad network wired up (that needs an actual ad SDK and
  account credentials); swap `CREATIVES` in this file for a real one.
- `js/menu.js` — the SoftLeft menu and everything it opens: Browse
  Channels (EPG grid, D-pad in both axes, plus a filter — see below),
  Add/View Favorites, Search, and a Settings screen for dark mode +
  background playback. That Settings screen is an addition beyond the
  originally-specified 5 menu items, added because "enable/disable that
  feature in settings" needed somewhere to live. Search and the Browse
  filter are both real `<input>`s — KaiOS's own text-input IME handles
  typing/multi-tap/backspace/cursor movement natively; we only listen
  for `input` events to filter results/rows. Both are explicitly blurred
  on the way out of their view (see `hideAllViews()`), because a focused
  native element left behind can keep catching D-pad input after the
  view that owns it closes — confirmed the hard way (see next bullet).
  Browse's filter isn't focused by default (Left/Right there means
  next/previous *program*, not cursor movement, and would conflict) —
  instead, typing any single character while browsing redirects focus
  into it and lets the keystroke land there natively, a "type to filter"
  pattern like a file manager or spreadsheet.
- `js/app.js` — ties everything together: up/down channel cycling with
  wrap-around, left/right seek, numeric keypad channel entry (by each
  channel's stable `number`, not array position), a persistent
  channel-title label (`#channel-title` — unlike the flash `#banner`,
  it never auto-hides, so you can always glance and confirm what's
  playing), last-watched channel persistence,
  direction-aware auto-skip on stream failure (continues whichever way
  you were browsing — it used to always skip forward, so pressing Down
  onto a dead channel would auto-skip forward right back to the channel
  you were just on, looking exactly like Down was broken), SoftRight
  rotation, and the
  background-playback popup. That popup's two buttons are real `<button>`
  elements but carry `tabindex="-1"` — on a real device, KaiOS's D-pad
  spatial navigation was auto-focusing them, which then kept intercepting
  Up/Down (breaking channel navigation) even after the popup closed. The
  buttons' highlighted state is driven entirely by app.js's own key
  handling, not real focus, so they don't need to be natively focusable.
- `icons/icon-56.png`, `icons/icon-112.png` — real, ready-to-use placeholder
  icons at the exact KaiOS-required sizes (see `icons/icon-source.svg` for
  the design and `icons/make_icons.py` if you want to tweak the colors and
  regenerate).
- `tools/build_channels.py` — pulls free/legal channel, stream, logo and
  language data from the [iptv-org](https://github.com/iptv-org/iptv)
  project and writes it out as a `channels.json` in this app's schema. See
  `free-resources.md` (project docs) for details. **Run and verified** —
  the checked-in `channels.json` was generated from live iptv-org data.
  iptv-org's list has real link rot (about 30% of entries were dead/
  unreachable when checked), so the script now supports `--verify-streams`
  to GET each candidate stream and drop the ones that don't respond before
  writing the file; the checked-in `channels.json` was built with it
  (1,746 confirmed-live channels, `updatedAt: 2026-09-21T05:09:16Z`).

## What's NOT here yet

- **Real EPG (program guide) data.** `js/schedule.js` generates a
  placeholder schedule so Browse Channels and program reminders have
  something real to navigate; actual XMLTV parsing is still phase two —
  see `free-resources.md` section 3.
- **A real ad network.** `js/ads.js` rotates placeholder creatives on a
  real schedule/layout; there's no ad SDK or account behind it.
- **Guaranteed background audio.** `js/app.js` leaves the `<video>`
  playing (rather than pausing it) when background playback is enabled
  and the app is hidden, and the manifest requests
  `audio-channel-content`, but whether KaiOS actually keeps decoding/
  outputting audio for a hidden privileged app is unverified on real
  hardware.
- Recording/DVR. There was an on-demand recording feature
  (`js/recorder.js`) and a rolling rewind buffer (`js/buffer.js`), both
  built on `captureStream()` + `MediaRecorder`. Both are gone: testing
  confirmed `captureStream()` throws a `SecurityError` for cross-origin
  media without CORS headers — true of almost all of these public IPTV
  streams — so neither worked against real channels, and the rewind
  buffer was running a live `MediaRecorder` re-encode on every single
  channel tune for a buffer nothing ever read from (a real CPU/memory
  cost on feature-phone hardware, for a feature that didn't work). If you
  want DVR-style rewind back, look at a server-side proxy that re-serves
  streams with CORS headers instead.
- Parental channel hiding.
- Any KaiOS packaging/signing steps for KaiStore submission.

## Before you can run this

1. `CHANNELS_URL` in `js/channels.js` is already set to
   `https://raw.githubusercontent.com/GabeBrPierce/my-tv-channels/main/channels.json`.
   Update it if you're publishing `channels.json` somewhere else.
2. A real `channels.json` is already checked in, generated by
   `tools/build_channels.py --verify-streams` from live iptv-org data.
   Re-run that script whenever you want to refresh the list — keep
   `--verify-streams` on, since without it roughly 3 in 10 channels are
   dead links (see `free-resources.md`).
   **Note:** this working folder is not itself a git repo, and
   `CHANNELS_URL` in `js/channels.js` points at a separate
   `GabeBrPierce/my-tv-channels` repo — after regenerating `channels.json`
   here, copy/push it to that repo for the running app to pick up the
   update.
3. `js/vendor/hls.min.js` is already in place (v1.7.3).
4. Icons are already in place; swap them out if you want a different look.
5. Test in the KaiOS simulator (via the KaiOS/Firefox OS developer tools) or
   on an actual device before assuming any of the playback code works as
   written — especially background audio and the Alarm API (flagged above
   as unverified on real hardware).

## Controls

- **Up / Down** (D-pad): cycle channels, wraps at the ends.
- **Left / Right** (D-pad): rewind/fast-forward 15 seconds within the
  current stream's own seekable (DVR) buffer, if it has one. `currentTime`
  seeking isn't blocked by CORS, so this works independently of streams'
  cross-origin restrictions. Streams with no DVR window (live-edge only)
  just show a toast rather than doing nothing silently.
- **Enter** (center key): pause / resume. A "Paused" badge stays on screen
  while paused, and the softkey bar's center label flips between Pause and
  Play. Changing channel resumes playback. If numeric channel entry is in
  progress, Enter commits it instead. On a live stream, a long pause may
  resume from a point the stream has since dropped.
- **0-9**: jump straight to a channel number (numeric entry, 2s to commit).
  Channels are ordered by category (A-Z, "Other" last), then name — but
  each channel's number is stable and independent of that order. A
  channel's category is the first entry of its `category` field in
  channels.json. The persistent title shows it (`12. CNN · News`).
- **#** / **\***: jump to the first channel of the next / previous
  category (also works inside Browse Channels).
- **SoftLeft** (`[` for desktop testing): open the menu — Browse Channels,
  Jump to Category, Add/View Favorite Channels, Search, Settings. SoftLeft again from any
  sub-view goes back to the menu; from the menu itself, closes it.
- **SoftRight** (`]`): toggle a rotated, immersive full-screen mode — hides
  the ad banner and shows a fullscreen ad every 10 minutes instead of the
  banner.
- **Backspace** ("Back"): never exits the app. Deletes a character while a
  text input (Search / Browse filter) is focused; otherwise backs out to
  the previous view, same as SoftLeft.
- A softkey legend at the bottom of the screen (`Menu` / `Full Screen`)
  shows on any key press and fades out a few seconds after the last one.
- Inside Browse Channels: a real grid. The time header always advances in
  fixed 15-minute steps, but each row's program blocks are sized by that
  program's actual duration (a 15-minute show gets a third of the row; a
  1-hour show fills it) rather than one independent cell per column. A red
  line marks "now" in the time header when it's within the visible window.
  **Up/Down** moves the highlighted channel row; **Left/Right** jumps to
  the next/previous whole *program* (one press skips a full show,
  regardless of how many 15-minute blocks it spans), repaging the window
  if needed. **Enter** tunes to a currently-airing program or sets
  reminders for a future one. Typing any character filters the channel
  list by name (1,700+ channels is a lot to page through one at a time).
- Inside Search: a real text input — type normally (KaiOS's own IME
  handles multi-tap), **Up/Down** picks a result as they filter live,
  **Enter** tunes to it.

Tested at KaiOS's native 320×240 landscape resolution in a browser (see
`.claude/launch.json` for the local static server used to do that).
