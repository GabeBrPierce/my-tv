/**
 * blocklist.js
 *
 * Channels that must never appear anywhere in the app (browse, search,
 * favorites, keypad entry, up/down), regardless of what channels.json
 * contains. Applied in channels.js right after the list loads, so it also
 * covers a stale cache or a data repo that hasn't been regenerated yet.
 *
 * Add a channel by its `id` from channels.json. A channel is also blocked
 * if any of its categories is in CATEGORIES or it's flagged `is_nsfw`.
 * Keep in sync with tools/build_channels.py.
 */

var Blocklist = (function () {
  var IDS = [
    "KaloopyTV.us",
    "FashionTVSecrets.fr",
    "FashionBox.nl"
  ];

  var CATEGORIES = ["xxx", "adult"];

  var idSet = {};
  IDS.forEach(function (id) { idSet[id.toLowerCase()] = true; });

  function isBlocked(ch) {
    if (ch.is_nsfw === true) return true;
    if (ch.id && idSet[String(ch.id).toLowerCase()]) return true;
    var cats = (ch.category || "").toLowerCase().split(",");
    for (var i = 0; i < cats.length; i++) {
      if (CATEGORIES.indexOf(cats[i].trim()) !== -1) return true;
    }
    return false;
  }

  return { isBlocked: isBlocked };
})();
