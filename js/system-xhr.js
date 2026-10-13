/**
 * system-xhr.js
 *
 * On KaiOS, a privileged app that declares `systemXHR` in its manifest may
 * create XHRs with `mozSystem: true`, which skips the same-origin/CORS
 * check. hls.js loads playlists and segments with plain XHR, so without
 * this any stream whose server sends no CORS headers (e.g. everything
 * behind jmp2.uk/Pluto TV) fails with manifestLoadError and gets
 * auto-skipped. Native <video src> playback never needed CORS.
 *
 * This is the route that works on both KaiOS 2.5 and 3.0. system-fetch.js
 * is the no-cors fetch route, which is KaiOS 3 only and is preferred when
 * available; this is the fallback for everything else (hls.js falls back
 * to XHR on its own when no custom fetch loader is configured).
 *
 * Wraps the global XMLHttpRequest so every XHR in the app — including
 * hls.js's, which calls `new self.XMLHttpRequest()` at request time —
 * is a system XHR. mozAnon is implied by mozSystem (no cookies/auth
 * headers), which is fine for these streams.
 *
 * Feature-detected: only instances created on a platform that honors
 * mozSystem report it back, so desktop browsers and phones without it
 * are left completely untouched. Must load before hls.js is used.
 */

var SystemXhr = (function () {
  var active = false;
  var Native = window.XMLHttpRequest;
  var supported = false;
  try {
    supported = new Native({ mozSystem: true, mozAnon: true }).mozSystem === true;
  } catch (e) {
    /* constructor rejected the parameters — leave XHR alone */
  }

  if (supported) {
    var SystemXHR = function () {
      return new Native({ mozSystem: true, mozAnon: true });
    };
    SystemXHR.prototype = Native.prototype;
    ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"].forEach(function (k) {
      SystemXHR[k] = Native[k];
    });
    window.XMLHttpRequest = SystemXHR;
    active = true;
  }

  return { isActive: function () { return active; } };
})();
