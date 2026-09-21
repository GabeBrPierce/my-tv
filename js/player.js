/**
 * player.js
 *
 * Wraps the <video> element: loads a channel's stream (native HLS or
 * hls.js fallback), and reports load failures so app.js can auto-skip
 * to the next channel per requirements.md section 3.
 */

var Player = (function () {
  var videoEl = document.getElementById("player");
  var hls = null;
  var onErrorCallback = null;

  function supportsNativeHls() {
    return videoEl.canPlayType("application/vnd.apple.mpegurl") !== "";
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function play(streamUrl) {
    destroyHls();
    videoEl.removeAttribute("src");

    if (supportsNativeHls()) {
      videoEl.src = streamUrl;
      videoEl.play().catch(function () {
        /* Autoplay might be blocked until first user interaction on some
           builds — the remote-control input the user just pressed should
           count as that interaction in practice. */
      });
    } else if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(streamUrl);
      hls.attachMedia(videoEl);
      hls.on(window.Hls.Events.ERROR, function (event, data) {
        if (data.fatal && onErrorCallback) {
          onErrorCallback(data);
        }
      });
    } else {
      if (onErrorCallback) {
        onErrorCallback({ type: "unsupported", details: "No HLS playback path available" });
      }
      return;
    }

    videoEl.onerror = function () {
      if (onErrorCallback) {
        onErrorCallback({ type: "media-error", details: videoEl.error });
      }
    };
  }

  function onError(cb) {
    onErrorCallback = cb;
  }

  function getVideoElement() {
    return videoEl;
  }

  return {
    play: play,
    onError: onError,
    getVideoElement: getVideoElement
  };
})();
