# Free Resources for My TV

Research into free, legal sources for the three things the scaffold left as TODOs: channel/stream data, the hls.js library, and app icons.

## 1. Channel list & stream URLs — iptv-org

[iptv-org/iptv](https://github.com/iptv-org/iptv) is the project to build on. It's Unlicense/CC0, and importantly it doesn't host any video itself — it's "user-submitted links to publicly available video stream URLs," which is the same legal posture your own repo would have. It's actively maintained and widely used as the base for other free IPTV tools.

The useful part for this app isn't the M3U playlist directly — it's the companion [iptv-org/api](https://github.com/iptv-org/api), which publishes the same data as plain JSON:

- `https://iptv-org.github.io/api/channels.json` — id, name, country, categories, etc.
- `https://iptv-org.github.io/api/streams.json` — channel id → stream URL, quality, referrer/user-agent if needed
- `https://iptv-org.github.io/api/logos.json` — channel id → logo URL
- `https://iptv-org.github.io/api/feeds.json` — channel id → languages, broadcast area
- `https://iptv-org.github.io/api/guides.json` — channel id → EPG source site (see section 3)

None of this is in *this* app's schema, so I wrote a small script (`tools/build_channels.py`, in the scaffold) that fetches all five files, joins them by channel id, and writes out a `channels.json` in the exact shape `channels.js` expects — including applying the English-or-subtitled filter rule from the requirements doc. **Now run and verified** end-to-end against live iptv-org data. Two things worth knowing: iptv-org doesn't track a `hasSubtitles` flag the way this app's schema does, so the script defaults every channel to `false` and you'd want to hand-confirm subtitles for any foreign-language channel you want visible by default; and stream link rot is a real, measured problem with this public list — a check of all ~2,490 candidate streams found roughly 30% dead (404s, timeouts, 403s from geo/hotlink blocks, dead hosts). The app already auto-skips a dead channel rather than showing a black screen, but at a 30% dead rate that meant a lot of visible skipping before landing on something live. `build_channels.py` now supports `--verify-streams`, which GETs every candidate stream and drops the ones that don't respond before writing `channels.json` — use it. It adds a few minutes to the run (2,490 streams at 40 concurrent, ~7s timeout each) but the checked-in `channels.json` was built this way and dropped from 2,487 to 1,746 channels as a result.

## 2. hls.js — the HLS playback library

Latest stable release is **v1.7.2** (Apache-2.0 licensed, free for any use). Direct sources:

- GitHub releases: https://github.com/video-dev/hls.js/releases
- npm package: https://www.npmjs.com/package/hls.js
- CDN (for grabbing the file, not for loading it live from a KaiOS device): https://www.jsdelivr.com/package/npm/hls.js?tab=files&path=dist

I tried to download `dist/hls.min.js` directly into the scaffold for you, but this sandbox's network policy blocks GitHub release assets, jsDelivr, and unpkg alike — nothing came through. You'll need to grab it yourself: easiest is `npm install hls.js` anywhere with normal internet access and copy `node_modules/hls.js/dist/hls.min.js` into the scaffold's `js/vendor/hls.min.js` (there's a placeholder README there already pointing at this). Pin the exact version (1.7.2, or whatever's current when you do this) rather than tracking "latest."

## 3. EPG (program guide) data

[iptv-org/epg](https://github.com/iptv-org/epg) is the matching tool for program schedules, but it's a *generator*, not a hosted feed — it scrapes supported guide sites and produces XMLTV files when you run it, rather than publishing ready-made XML somewhere you can just fetch. The `guides.json` endpoint (linked above) tells you which channels have a known guide *source*, which `build_channels.py` records as each channel's `epgSource`, but actually producing the XMLTV file still means running the `epg` tool yourself — realistically as a second scheduled GitHub Action in your repo, publishing its output XML alongside `channels.json`. This is more setup than the channel list itself, so it's reasonable to treat EPG as a phase-two addition once channel browsing and playback are solid, especially since the app already treats missing EPG data as a non-error (section 4 of requirements.md).

## 4. App icons

KaiOS needs exactly two sizes — 56×56 and 112×112, 24-bit PNG, no transparency, solid colors without gradients or texture (per the [KaiOS launcher icon guide](https://developer.kaiostech.com/docs/design-guide/launcher-icon/)).

Rather than pointing you at a download, I drew a simple original placeholder (a TV screen with antennas and a play triangle) and rendered both exact sizes — they're in the scaffold's `icons/` folder as `icon-56.png` and `icon-112.png`, already wired up in `manifest.webmanifest`. Being hand-drawn for this app, there's no licensing question at all. If you'd rather use something else, [Google's Material Symbols](https://fonts.google.com/icons) (Apache-2.0, free for commercial use, no attribution required) has a "live_tv" glyph that would work well as a starting point — you'd still need to flatten it onto a solid background and export at the two exact sizes, since Material Symbols ships as outline SVG on a transparent background by default.
