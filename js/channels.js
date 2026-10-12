/**
 * channels.js
 *
 * Fetches channels.json from the linked GitHub repo, caches it locally,
 * and exposes the filtered/ordered channel list the rest of the app uses.
 *
 * Schema is documented in requirements.md section 3.1 / channels.example.json.
 */

var Channels = (function () {
  // TODO: point this at your actual repo's raw content URL, e.g.:
  // "https://raw.githubusercontent.com/<user>/<repo>/main/channels.json"
  // See tools/build_channels.py for one way to generate that file from
  // free/legal sources (details in free-resources.md, project docs).
  var CHANNELS_URL = "https://raw.githubusercontent.com/GabeBrPierce/my-tv-channels/main/channels.json";

  var CACHE_KEY = "mytv.channels.cache.v1";
  var ETAG_KEY = "mytv.channels.etag.v1";

  var rawChannels = [];    // every channel in channels.json, enabled or not
  var allChannels = [];    // `enabled` only
  var visibleChannels = []; // after language/subtitle filtering

  /**
   * build_channels.py assigns a stable `number` per channel id that
   * survives regeneration (see that script's load_existing_numbers()) so
   * "channel 12" means the same thing today and tomorrow even as dead
   * streams flicker in and out. Hand-written channels.json files (see
   * channels.example.json) predate that field, so fall back to position
   * for any channel missing it.
   */
  function assignFallbackNumbers(list) {
    list.forEach(function (ch, i) {
      if (typeof ch.number !== "number") ch.number = i + 1;
    });
  }

  var UNCATEGORIZED = "Other";

  /** channels.json's `category` is a comma-separated list ("news,business");
   * the first entry is treated as the channel's primary category. */
  function getCategory(ch) {
    if (ch._cat) return ch._cat;
    var raw = (ch.category || "").split(",")[0].trim();
    ch._cat = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : UNCATEGORIZED;
    return ch._cat;
  }

  /** Category (A-Z, "Other" last), then name. Sort keys are precomputed
   * once so the comparator is just string compares — cheap on slow
   * hardware. Numbers are untouched, so keypad entry stays stable. */
  function sortByCategoryThenName(list) {
    list.forEach(function (ch) {
      ch._sortCat = getCategory(ch) === UNCATEGORIZED ? "￿" : ch._cat.toLowerCase();
      ch._sortName = (ch.name || "").toLowerCase();
    });
    list.sort(function (a, b) {
      if (a._sortCat !== b._sortCat) return a._sortCat < b._sortCat ? -1 : 1;
      if (a._sortName !== b._sortName) return a._sortName < b._sortName ? -1 : 1;
      return a.number - b.number;
    });
  }

  /** Contiguous category groups of an already-sorted list. */
  function getCategories(list) {
    var groups = [];
    list.forEach(function (ch, i) {
      var label = getCategory(ch);
      var last = groups[groups.length - 1];
      if (last && last.label === label) last.count++;
      else groups.push({ label: label, startIndex: i, count: 1 });
    });
    return groups;
  }

  /** Index of the first channel of the next (dir > 0) or previous
   * (dir < 0) category in a sorted list, wrapping at the ends. */
  function jumpCategoryIndex(list, index, dir) {
    if (list.length === 0) return index;
    var groups = getCategories(list);
    var g = 0;
    for (var i = 0; i < groups.length; i++) {
      if (index >= groups[i].startIndex) g = i;
    }
    g = (g + (dir > 0 ? 1 : -1) + groups.length) % groups.length;
    return groups[g].startIndex;
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveCache(data, etag) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      if (etag) localStorage.setItem(ETAG_KEY, etag);
    } catch (e) {
      // Storage full or unavailable — non-fatal, just skip caching.
    }
  }

  function applyFilters(rawChannels, options) {
    options = options || {};
    var showAllLanguages = !!options.showAllLanguages;

    return rawChannels.filter(function (ch) {
      if (ch.enabled === false) return false;
      if (showAllLanguages) return true;
      // Default rule: English channels, or foreign-language channels with subtitles.
      // Accept both ISO 639-1 ("en") and ISO 639-2/3 ("eng") since
      // hand-written channels.json files and tools/build_channels.py
      // (which mirrors iptv-org's own codes) use different ones.
      return ch.language === "en" || ch.language === "eng" || ch.hasSubtitles === true;
    });
  }

  /**
   * Fetch the channel list (network first, cache fallback), apply filters,
   * and resolve with the visible channel array.
   */
  function fetchChannels(options) {
    return new Promise(function (resolve) {
      var cached = loadCache();
      var etag = localStorage.getItem(ETAG_KEY);

      var xhr = new XMLHttpRequest();
      xhr.open("GET", CHANNELS_URL, true);
      if (etag) xhr.setRequestHeader("If-None-Match", etag);
      xhr.timeout = 8000;

      xhr.onload = function () {
        if (xhr.status === 304 && cached) {
          // Not modified — use cache as-is.
          finish(cached);
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            saveCache(data, xhr.getResponseHeader("ETag"));
            finish(data);
            return;
          } catch (e) {
            // Fall through to cache fallback below.
          }
        }
        fallbackToCache();
      };

      xhr.onerror = fallbackToCache;
      xhr.ontimeout = fallbackToCache;

      function fallbackToCache() {
        if (cached) {
          finish(cached);
        } else {
          resolve({ error: "no-network-no-cache", channels: [] });
        }
      }

      function finish(data) {
        rawChannels = data.channels || [];
        assignFallbackNumbers(rawChannels);
        allChannels = rawChannels.filter(function (ch) {
          return ch.enabled !== false;
        });
        visibleChannels = applyFilters(allChannels, options);
        sortByCategoryThenName(visibleChannels);
        resolve({ error: null, channels: visibleChannels });
      }

      xhr.send();
    });
  }

  function getVisibleChannels() {
    return visibleChannels;
  }

  function getById(id) {
    for (var i = 0; i < allChannels.length; i++) {
      if (allChannels[i].id === id) return allChannels[i];
    }
    return null;
  }

  /**
   * Like getById, but also finds a channel whose source is currently dark
   * (enabled: false). Used by Favorites so a favorited channel doesn't just
   * vanish when its stream is temporarily unreachable — the UI can instead
   * show it grayed out as "temporarily unavailable".
   */
  function getAnyById(id) {
    for (var i = 0; i < rawChannels.length; i++) {
      if (rawChannels[i].id === id) return rawChannels[i];
    }
    return null;
  }

  function getByNumber(number) {
    for (var i = 0; i < visibleChannels.length; i++) {
      if (visibleChannels[i].number === number) return visibleChannels[i];
    }
    return null;
  }

  return {
    fetchChannels: fetchChannels,
    getVisibleChannels: getVisibleChannels,
    getById: getById,
    getAnyById: getAnyById,
    getByNumber: getByNumber,
    getCategory: getCategory,
    getCategories: getCategories,
    jumpCategoryIndex: jumpCategoryIndex
  };
})();
