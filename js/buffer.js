/**
 * buffer.js
 *
 * Rolling ~5-minute rewind buffer, per requirements.md section 5.1.
 *
 * FEASIBILITY NOTE: this relies on HTMLMediaElement.captureStream() and
 * MediaRecorder being supported on the target KaiOS 3 build. Both are
 * unconfirmed on real hardware as of writing — treat this module as a
 * prototype to validate early, not a finished feature. If captureStream()
 * or MediaRecorder aren't available, `isSupported()` returns false and
 * the rest of the app should simply not offer rewind.
 *
 * CONFIRMED BY TESTING (separate from the above): captureStream() throws
 * a SecurityError for cross-origin media that isn't served with CORS
 * headers — "cannot capture from element with cross-origin data". Almost
 * none of the public IPTV streams channels.json points at send CORS
 * headers, so on top of the hardware-support question, expect rewind (and
 * recorder.js's on-demand recording, same mechanism) to simply not work
 * against most real channels as-is. It would work against a same-origin
 * or CORS-enabled stream. Fixing this for arbitrary public streams would
 * need a server-side proxy that re-serves the video with CORS headers —
 * out of scope here.
 */

var RewindBuffer = (function () {
  var CHUNK_MS = 15000;       // 15s per chunk
  var MAX_CHUNKS = 20;        // 20 * 15s = ~5 minutes

  var recorder = null;
  var chunks = [];
  var recordingChannelId = null;

  // captureStream() only returns a stream with usable tracks once the
  // <video> actually has a decoded frame. Calling it immediately after
  // play() — before any data has loaded — throws "no audio or video
  // tracks available" in Chromium-based engines (confirmed by hand: this
  // fired on every single channel tune, not just a KaiOS-only quirk).
  // `generation` invalidates a pending wait if start()/stop() is called
  // again (e.g. the user changes channel again) before it fires.
  var generation = 0;
  var pendingVideoEl = null;
  var pendingHandler = null;

  function isSupported(videoEl) {
    return (
      typeof videoEl.captureStream === "function" &&
      typeof window.MediaRecorder !== "undefined"
    );
  }

  function beginCapture(videoEl, channelId, myGeneration) {
    if (myGeneration !== generation) return; // superseded — ignore

    try {
      var stream = videoEl.captureStream();
      if (stream.getTracks().length === 0) {
        console.warn("[RewindBuffer] captureStream() returned no tracks — skipping.");
        return;
      }

      recorder = new MediaRecorder(stream);
      chunks = [];
      recordingChannelId = channelId;

      recorder.ondataavailable = function (event) {
        if (!event.data || event.data.size === 0) return;
        chunks.push(event.data);
        if (chunks.length > MAX_CHUNKS) {
          chunks.shift(); // drop oldest chunk to keep the buffer at ~5 min
        }
      };

      recorder.start(CHUNK_MS);
    } catch (e) {
      console.warn("[RewindBuffer] failed to start:", e);
      recorder = null;
    }
  }

  function start(videoEl, channelId) {
    stop(); // clear any previous channel's buffer + cancel any pending wait
    generation++;
    var myGeneration = generation;

    if (!isSupported(videoEl)) {
      console.warn("[RewindBuffer] captureStream/MediaRecorder unsupported — rewind disabled.");
      return false;
    }

    if (videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */) {
      beginCapture(videoEl, channelId, myGeneration);
    } else {
      pendingVideoEl = videoEl;
      pendingHandler = function () {
        videoEl.removeEventListener("loadeddata", pendingHandler);
        pendingVideoEl = null;
        pendingHandler = null;
        beginCapture(videoEl, channelId, myGeneration);
      };
      videoEl.addEventListener("loadeddata", pendingHandler);
    }
    return true;
  }

  function stop() {
    generation++; // invalidate any in-flight "wait for loadeddata" from start()

    if (pendingVideoEl && pendingHandler) {
      pendingVideoEl.removeEventListener("loadeddata", pendingHandler);
    }
    pendingVideoEl = null;
    pendingHandler = null;

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch (e) {
        /* ignore */
      }
    }
    recorder = null;
    chunks = [];
    recordingChannelId = null;
  }

  /**
   * Returns a blob URL for everything currently buffered, oldest-first,
   * suitable for playing back in a paused/rewind view. Caller is
   * responsible for revoking the URL (URL.revokeObjectURL) when done.
   */
  function getRewindUrl() {
    if (chunks.length === 0) return null;
    var blob = new Blob(chunks, { type: chunks[0].type || "video/webm" });
    return URL.createObjectURL(blob);
  }

  function getBufferedSeconds() {
    return (chunks.length * CHUNK_MS) / 1000;
  }

  return {
    isSupported: isSupported,
    start: start,
    stop: stop,
    getRewindUrl: getRewindUrl,
    getBufferedSeconds: getBufferedSeconds
  };
})();
