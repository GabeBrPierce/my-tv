/**
 * recorder.js
 *
 * On-demand recording for the menu's "Record Program" action: start
 * capturing the live channel now, stop later, and save what was captured.
 * This is the interactive counterpart to buffer.js's rolling rewind
 * buffer — same captureStream()/MediaRecorder mechanism (see that file's
 * feasibility note; unverified on real KaiOS 3 hardware), but it keeps
 * everything captured (no ring-buffer eviction) until you stop it.
 *
 * There's no scheduled/unattended recording here on purpose: a program
 * reminder (notifications.js) fires whether or not the app is open, but
 * actually starting a MediaRecorder requires a live <video> with an
 * active stream, which only exists while the app is open and tuned to
 * that channel. So reminders prompt the user to open the app and press
 * Record themselves, rather than promising silent background recording
 * that isn't achievable with this API.
 */

var Recorder = (function () {
  // Unlike buffer.js's rewind ring buffer, this keeps everything from
  // start to stop by design — but "everything" still needs a ceiling, or
  // an accidentally-left-running recording grows memory forever the same
  // way the unbounded hls.js back-buffer did (see player.js). Auto-stop
  // and finalize past this, rather than silently truncating.
  var MAX_RECORDING_MS = 20 * 60 * 1000;

  var recorder = null;
  var chunks = [];
  var recordingChannel = null;
  var autoStopTimer = null;
  var onAutoStopCallback = null;

  function isSupported(videoEl) {
    return (
      typeof videoEl.captureStream === "function" &&
      typeof window.MediaRecorder !== "undefined"
    );
  }

  function isRecording() {
    return !!recorder && recorder.state === "recording";
  }

  function getRecordingChannel() {
    return recordingChannel;
  }

  function start(videoEl, channel) {
    if (isRecording() || !isSupported(videoEl)) return false;

    // Returns true/false so the caller (the menu's "Record Program" toast)
    // reports what actually happened rather than just "we tried". Most
    // public IPTV streams don't send CORS headers, and captureStream()
    // throws a SecurityError for cross-origin media without them — this
    // was confirmed by hand while testing, not theoretical. Recording
    // will only work against same-origin or CORS-enabled streams.
    function begin() {
      try {
        var stream = videoEl.captureStream();
        if (stream.getTracks().length === 0) {
          console.warn("[Recorder] captureStream() returned no tracks — not recording.");
          return false;
        }
        chunks = [];
        recordingChannel = channel;
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.start(1000);
        clearTimeout(autoStopTimer);
        autoStopTimer = setTimeout(function () {
          stopAndSave().then(function (result) {
            if (onAutoStopCallback) onAutoStopCallback(result);
          });
        }, MAX_RECORDING_MS);
        return true;
      } catch (e) {
        console.warn("[Recorder] failed to start:", e);
        recorder = null;
        return false;
      }
    }

    if (videoEl.readyState >= 2) {
      return begin();
    }
    // Video not ready yet (rare — only right after a channel change):
    // attempt it once data arrives, but report false now since we can't
    // confirm success synchronously.
    videoEl.addEventListener("loadeddata", begin, { once: true });
    return false;
  }

  /** Stops the recording and resolves { url, channel } for a blob URL of
   * everything captured, or null if there was nothing to save. */
  function stopAndSave() {
    clearTimeout(autoStopTimer);
    if (!recorder) return Promise.resolve(null);
    var ch = recordingChannel;
    return new Promise(function (resolve) {
      recorder.onstop = function () {
        var result = chunks.length
          ? { url: URL.createObjectURL(new Blob(chunks, { type: chunks[0].type || "video/webm" })), channel: ch }
          : null;
        recorder = null;
        chunks = [];
        recordingChannel = null;
        resolve(result);
      };
      try {
        recorder.stop();
      } catch (e) {
        recorder = null;
        chunks = [];
        recordingChannel = null;
        resolve(null);
      }
    });
  }

  function cancel() {
    clearTimeout(autoStopTimer);
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (e) { /* ignore */ }
    }
    recorder = null;
    chunks = [];
    recordingChannel = null;
  }

  /** Called with stopAndSave()'s result if MAX_RECORDING_MS is hit. */
  function onAutoStop(cb) {
    onAutoStopCallback = cb;
  }

  return {
    isSupported: isSupported,
    isRecording: isRecording,
    getRecordingChannel: getRecordingChannel,
    start: start,
    stopAndSave: stopAndSave,
    cancel: cancel,
    onAutoStop: onAutoStop
  };
})();
