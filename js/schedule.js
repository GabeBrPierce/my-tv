/**
 * schedule.js
 *
 * PLACEHOLDER EPG DATA. iptv-org only publishes a per-channel EPG *source*
 * (channel.epgSource) — actual program listings require parsing that
 * source's real XMLTV guide, which free-resources.md (section 3) and the
 * README both call out as a deferred phase-two integration, not something
 * wired up here.
 *
 * Until that's built, this generates a deterministic, obviously-synthetic
 * timeline per channel — real programs with real (if made-up) durations,
 * quantized to 15-minute increments so they always line up with the grid's
 * navigation granularity, tiled back-to-back with no gaps. Swap
 * `getProgramsInRange` for a real XMLTV-backed lookup once that
 * integration exists — everything else (grid navigation, reminder
 * scheduling) is written against the {start, end, title} shape and
 * doesn't care where it comes from.
 */

var Schedule = (function () {
  var SLOT_MS = 15 * 60 * 1000; // 15-minute grid granularity
  var GENRES = ["Program", "News Block", "Feature Film", "Rerun", "Live Broadcast", "Magazine Show"];
  var DURATIONS_SLOTS = [1, 2, 2, 3, 4, 4, 6]; // in 15-min units: 15/30/30/45/60/60/90 min

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function slotStartTime(slotOffset) {
    var now = Date.now();
    return Math.floor(now / SLOT_MS) * SLOT_MS + slotOffset * SLOT_MS;
  }

  function dayEpoch(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function titleFor(channel, start) {
    var seed = hashString(channel.id + ":title:" + start);
    var genre = GENRES[seed % GENRES.length];
    var episode = ((seed >>> 8) % 24) + 1;
    return genre + " #" + episode;
  }

  function durationFor(channel, epoch, index) {
    var seed = hashString(channel.id + ":" + epoch + ":" + index);
    return DURATIONS_SLOTS[seed % DURATIONS_SLOTS.length] * SLOT_MS;
  }

  // Per-channel timelines, keyed by "channelId:epoch" (epoch = local
  // midnight the timeline started from). Lazily extended forward as later
  // ranges are requested, never rebuilt, so program boundaries stay stable
  // across navigation no matter which direction you paged from.
  var timelines = {};

  function ensureTimeline(channel, throughMs) {
    var epoch = dayEpoch(Date.now()) - 24 * 60 * 60 * 1000; // 1 day of lookback margin
    var key = channel.id + ":" + epoch;
    var timeline = timelines[key];
    if (!timeline) {
      timeline = { epoch: epoch, programs: [] };
      timelines[key] = timeline;
    }
    var t = timeline.programs.length
      ? timeline.programs[timeline.programs.length - 1].end
      : epoch;
    var index = timeline.programs.length;
    while (t < throughMs) {
      var dur = durationFor(channel, epoch, index);
      timeline.programs.push({ start: t, end: t + dur, title: titleFor(channel, t), placeholder: true });
      t += dur;
      index++;
    }
    return timeline.programs;
  }

  /** Every program overlapping [rangeStart, rangeEnd). */
  function getProgramsInRange(channel, rangeStart, rangeEnd) {
    var programs = ensureTimeline(channel, rangeEnd);
    return programs.filter(function (p) { return p.end > rangeStart && p.start < rangeEnd; });
  }

  /** The single program airing at an exact instant, or null. */
  function getProgramAtTime(channel, timestamp) {
    var matches = getProgramsInRange(channel, timestamp, timestamp + 1);
    return matches.length ? matches[0] : null;
  }

  function isFuture(program) {
    return program.start > Date.now();
  }

  function isNowAiring(program) {
    var now = Date.now();
    return program.start <= now && now < program.end;
  }

  return {
    SLOT_MS: SLOT_MS,
    slotStartTime: slotStartTime,
    getProgramsInRange: getProgramsInRange,
    getProgramAtTime: getProgramAtTime,
    isFuture: isFuture,
    isNowAiring: isNowAiring
  };
})();
