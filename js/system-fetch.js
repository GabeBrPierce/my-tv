/**
 * system-fetch.js
 *
 * On KaiOS 3, a privileged app holding `systemXHR` gets special treatment
 * for `fetch(url, { mode: "no-cors" })`: the response comes back as a
 * readable "basic" response instead of an opaque one. That lets hls.js
 * load playlists and segments from servers that send no CORS headers
 * (e.g. everything behind jmp2.uk / Pluto TV), which otherwise fail with
 * manifestLoadError and get auto-skipped. Native <video src> never needed
 * CORS.
 *
 * KaiOS 2.5 has no such fetch behavior (nor AbortController); system-xhr.js
 * covers that case. Everywhere else a no-cors fetch is opaque and unreadable, which would
 * break playback — so this only turns on if a probe shows the platform
 * really returns a readable response. `ready` resolves once that's known
 * (app.js waits on it before the first tune); `hlsConfig()` is merged into
 * the hls.js config by player.js.
 *
 * hls.js's built-in fetch loader ("progressive" mode) isn't used: it feeds
 * each segment to the parser in chunks, which produced repeated
 * fragParsingErrors on some streams that load cleanly over XHR. This is a
 * small whole-response loader instead, so only the CORS behavior differs
 * from hls.js's default loader.
 */

var SystemFetch = (function () {
  // Any cross-origin URL works; HEAD keeps the probe tiny. This is the
  // same host as CHANNELS_URL in channels.js.
  var PROBE_URL = "https://raw.githubusercontent.com/GabeBrPierce/my-tv-channels/main/channels.json";
  var PROBE_TIMEOUT_MS = 3000;
  var DEFAULT_LOAD_TIMEOUT_MS = 30000;

  var active = false;
  var probeDone = false;
  var reason = ""; // why the probe said no — shown in app.js's launch toast

  function runProbe() {
    if (typeof fetch !== "function") { reason = "no fetch"; return Promise.resolve(false); }
    if (typeof Headers !== "function") { reason = "no Headers"; return Promise.resolve(false); }
    if (typeof AbortController === "undefined") { reason = "no AbortController"; return Promise.resolve(false); }
    try {
      return fetch(PROBE_URL, { method: "HEAD", mode: "no-cors" }).then(
        function (response) {
          if (response.type === "basic") return true;
          reason = "response " + response.type;
          return false;
        },
        function (err) {
          reason = "error " + ((err && (err.name || err.message)) || "?");
          return false;
        }
      );
    } catch (e) {
      reason = "threw " + (e && e.name);
      return Promise.resolve(false);
    }
  }

  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      if (!probeDone) reason = "probe timeout";
      resolve(false);
    }, PROBE_TIMEOUT_MS);
  });

  var ready = Promise.race([runProbe(), timeout]).then(function (ok) {
    probeDone = true;
    active = ok;
    return ok;
  });

  function newStats() {
    return {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 }
    };
  }

  /** An hls.js loader class that fetches with the given fetch `mode`. */
  function createLoader(mode) {
    function FetchLoader() {
      this.stats = newStats();
      this.context = null;
      this.callbacks = null;
      this.controller = null;
      this.response = null;
      this.timer = null;
      this.done = false;
    }

    FetchLoader.prototype.load = function (context, config, callbacks) {
      var self = this;
      var stats = this.stats = newStats();
      this.context = context;
      this.callbacks = callbacks;
      this.controller = new AbortController();
      this.response = null;
      this.done = false;
      stats.loading.start = performance.now();

      var headers = new Headers();
      if (context.headers) {
        for (var name in context.headers) headers.set(name, context.headers[name]);
      }
      if (context.rangeEnd) {
        headers.set("Range", "bytes=" + context.rangeStart + "-" + String(context.rangeEnd - 1));
      }

      var timeoutMs = (config && (config.timeout ||
        (config.loadPolicy && config.loadPolicy.maxLoadTimeMs))) || DEFAULT_LOAD_TIMEOUT_MS;
      this.timer = setTimeout(function () {
        if (self.done) return;
        self.done = true;
        stats.aborted = true;
        self.controller.abort();
        callbacks.onTimeout(stats, context, self.response);
      }, timeoutMs);

      fetch(context.url, {
        method: "GET",
        mode: mode,
        credentials: "omit",
        signal: this.controller.signal,
        headers: headers
      }).then(function (response) {
        self.response = response;
        stats.loading.first = Math.max(performance.now(), stats.loading.start);
        if (response.type === "opaque") {
          throw { code: 0, text: "opaque response (platform doesn't expose no-cors bodies)" };
        }
        if (!response.ok) {
          throw { code: response.status, text: response.statusText };
        }
        return context.responseType === "arraybuffer" ? response.arrayBuffer() : response.text();
      }).then(function (data) {
        if (self.done) return;
        self.done = true;
        clearTimeout(self.timer);
        stats.loading.end = Math.max(performance.now(), stats.loading.first);
        stats.loaded = stats.total = data.byteLength !== undefined ? data.byteLength : data.length;
        // response.url is the post-redirect URL; hls.js resolves a
        // playlist's relative URIs against it.
        callbacks.onSuccess(
          { url: (self.response && self.response.url) || context.url, data: data, code: self.response.status },
          stats, context, self.response
        );
      }, function (err) {
        if (self.done) return;
        self.done = true;
        clearTimeout(self.timer);
        callbacks.onError(
          { code: (err && err.code) || (self.response && self.response.status) || 0, text: (err && (err.text || err.message)) || "fetch failed" },
          context, self.response, stats
        );
      });
    };

    FetchLoader.prototype.abort = function () {
      if (this.done || !this.controller) return;
      this.done = true;
      clearTimeout(this.timer);
      this.stats.aborted = true;
      this.controller.abort();
      if (this.callbacks && this.callbacks.onAbort) {
        this.callbacks.onAbort(this.stats, this.context, this.response);
      }
    };

    FetchLoader.prototype.destroy = function () {
      this.abort();
      this.context = null;
      this.callbacks = null;
      this.response = null;
      this.controller = null;
    };

    FetchLoader.prototype.getResponseHeader = function (name) {
      return this.response && this.response.headers ? this.response.headers.get(name) : null;
    };

    return FetchLoader;
  }

  /** Extra hls.js config: route every load through the no-cors fetch
   * loader. Empty when the platform doesn't support it. */
  function hlsConfig() {
    return active ? { loader: createLoader("no-cors") } : {};
  }

  return {
    ready: ready,
    isActive: function () { return active; },
    getReason: function () { return reason; },
    hlsConfig: hlsConfig,
    createLoader: createLoader
  };
})();
