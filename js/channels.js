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
    getByNumber: getByNumber
  };
})();
