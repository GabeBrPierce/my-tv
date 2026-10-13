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
 * Wraps the global XMLHttpRequest so every XHR in the app — including
 * hls.js's, which calls `new self.XMLHttpRequest()` at request time —
 * is a system XHR. mozAnon is implied by mozSystem (no cookies/auth
 * headers), which is fine for these streams.
 *
 * Feature-detected: only instances created on a platform that honors
 * mozSystem report it back, so desktop browsers and phones without it
 * are left completely untouched. Must load before hls.js is used.
 */

(function () {
  var Native = window.XMLHttpRequest;
  var supported = false;
  try {
    supported = new Native({ mozSystem: true, mozAnon: true }).mozSystem === true;
  } catch (e) {
    /* constructor rejected the parameters — leave XHR alone */
  }
  if (!supported) return;

  function SystemXHR() {
    return new Native({ mozSystem: true, mozAnon: true });
  }
  SystemXHR.prototype = Native.prototype;
  ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"].forEach(function (k) {
    SystemXHR[k] = Native[k];
  });
  window.XMLHttpRequest = SystemXHR;
})();
