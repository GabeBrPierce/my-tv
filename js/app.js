/**
 * app.js
 *
 * Wires together channel list, player, buffer, ads, the softkey menu
 * system, rotation, and background playback. Implements:
 *  - up/down cycles channels, wrapping at the ends; left/right seeks
 *    within the current stream's DVR buffer (if it has one)
 *  - channels are ordered by category, then name; `#` / `*` jump to the
 *    next / previous category (numbers stay stable regardless of order)
 *  - numeric keypad entry jumps straight to a channel (by its stable
 *    `number`, not array position — see channels.js)
 *  - banner shows briefly on every channel change; a persistent
 *    channel-title label (never auto-hides) stays up the whole time
 *  - last-watched channel is remembered across launches
 *  - broken streams auto-skip to the next channel
 *  - SoftLeft ("[" for desktop testing) opens the menu (Browse Channels /
 *    Favorites / Search / Settings)
 *  - SoftRight ("]") toggles a rotated, immersive full-screen mode: hides
 *    the ad banner, shows a fullscreen ad every 10 minutes instead
 *  - Enter (center key) pauses/resumes; a "Paused" badge stays up meanwhile
 *  - a softkey legend at the bottom fades out a few seconds after the
 *    last key press, and reappears on the next one
 *  - background playback (off by default) + the "you can enable this"
 *    popup when returning to the app after it was hidden while playing
 *  - Backspace ("Back") never exits the app: it deletes a character while
 *    a text input is focused, or backs out to the previous view otherwise
 */

(function () {
  var LAST_WATCHED_KEY = "mytv.lastWatchedChannelId";
  var BANNER_DISMISS_MS = 4000;
  var CHANNEL_ENTRY_TIMEOUT_MS = 2000;
  var SOFTKEY_BAR_DISMISS_MS = 4000;

  var channels = [];
  var currentIndex = 0;
  var bannerTimer = null;
  var softkeyBarTimer = null;
  var rotated = false;

  var channelEntryBuffer = "";
  var channelEntryTimer = null;

  var bannerEl = document.getElementById("banner");
  var bannerLogoEl = document.getElementById("banner-logo");
  var bannerNameEl = document.getElementById("banner-name");
  var bannerProgramEl = document.getElementById("banner-program");
  var bannerNumberEl = document.getElementById("banner-number");
  var channelTitleEl = document.getElementById("channel-title");
  var channelEntryEl = document.getElementById("channel-entry");
  var channelEntryValueEl = document.getElementById("channel-entry-value");
  var softkeyBarEl = document.getElementById("softkey-bar");
  var softkeyCenterEl = document.getElementById("softkey-center");
  var softkeyRightEl = document.getElementById("softkey-right");
  var pauseIndicatorEl = document.getElementById("pause-indicator");
  var loadingEl = document.getElementById("loading");
  var errorEl = document.getElementById("error");
  var appEl = document.getElementById("app");

  var bgPopupEl = document.getElementById("bg-playback-popup");
  var bgEnableBtn = document.getElementById("bg-playback-enable-btn");
  var bgCloseBtn = document.getElementById("bg-playback-close-btn");
  var bgPopupOpen = false;
  var bgPopupFocus = 0; // 0 = Enable, 1 = Close
  var wasHiddenWhilePlaying = false;

  function showLoading(show) {
    loadingEl.classList.toggle("hidden", !show);
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }

  function hideError() {
    errorEl.classList.add("hidden");
  }

  function updateChannelTitle(channel) {
    channelTitleEl.textContent = channel.number + ". " + channel.name + " · " + Channels.getCategory(channel);
    channelTitleEl.classList.remove("hidden");
  }

  function showBanner(channel) {
    bannerLogoEl.src = channel.logoUrl || "";
    bannerNameEl.textContent = channel.name;
    bannerNumberEl.textContent = channel.number;
    bannerProgramEl.textContent = channel.epgSource
      ? "Loading program info…" // TODO: wire up real XMLTV parsing (see schedule.js)
      : "";

    bannerEl.classList.remove("hidden");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      bannerEl.classList.add("hidden");
    }, BANNER_DISMISS_MS);
  }

  /** Shows the SoftLeft/SoftRight legend and (re)starts its fade-out timer.
   * Called on every key press so any activity keeps it up a while longer. */
  function showSoftkeyBar() {
    softkeyBarEl.classList.remove("faded");
    clearTimeout(softkeyBarTimer);
    softkeyBarTimer = setTimeout(function () {
      softkeyBarEl.classList.add("faded");
    }, SOFTKEY_BAR_DISMISS_MS);
  }

  function tuneToIndex(index, opts) {
    opts = opts || {};
    if (channels.length === 0) return;

    // Wrap around at the ends (requirements.md section 2).
    currentIndex = ((index % channels.length) + channels.length) % channels.length;
    var channel = channels[currentIndex];

    hideError();
    Player.play(channel.streamUrl);
    updateChannelTitle(channel);

    if (!opts.silent) {
      showBanner(channel);
    }

    try {
      localStorage.setItem(LAST_WATCHED_KEY, channel.id);
    } catch (e) {
      /* non-fatal */
    }
  }

  // Which way the dead-stream auto-skip (see Player.onError in init())
  // should continue: without this it always skipped forward regardless
  // of which way you were actually browsing, so pressing Down onto a
  // dead channel would skip forward right back to the channel you were
  // just on — looking exactly like Down was broken/going the wrong way.
  var lastDirection = 1;

  function nextChannel() {
    lastDirection = 1;
    tuneToIndex(currentIndex + 1);
  }

  function prevChannel() {
    lastDirection = -1;
    tuneToIndex(currentIndex - 1);
  }

  /** `#` / `*`: jump to the first channel of the next / previous category. */
  function jumpCategory(direction) {
    if (channels.length === 0) return;
    lastDirection = direction;
    tuneToIndex(Channels.jumpCategoryIndex(channels, currentIndex, direction));
    Menu.showToast(Channels.getCategory(channels[currentIndex]));
  }

  /** Used only by the dead-stream auto-skip: continues in whichever
   * direction the user was last browsing, without resetting it. */
  function autoSkip() {
    tuneToIndex(currentIndex + lastDirection);
  }

  var SEEK_STEP_SECONDS = 15;

  /**
   * Rewind/fast-forward within the stream's own seekable (DVR) buffer.
   * `currentTime` seeking isn't restricted by CORS, so it works whenever
   * the stream itself exposes a seekable range (many live HLS streams keep
   * a sliding window of recent segments; pure live-edge-only streams won't
   * have one, and this becomes a no-op with a toast).
   */
  function seek(deltaSeconds) {
    var videoEl = Player.getVideoElement();
    var seekable = videoEl.seekable;
    if (!seekable || seekable.length === 0) {
      Menu.showToast("Rewind isn't available for this stream");
      return;
    }
    var min = seekable.start(0);
    var max = seekable.end(seekable.length - 1);
    var target = Math.max(min, Math.min(max, videoEl.currentTime + deltaSeconds));
    videoEl.currentTime = target;
  }

  function tuneToChannelNumber(number) {
    var channel = Channels.getByNumber(number);
    if (!channel) return;
    var index = channels.indexOf(channel);
    if (index !== -1) tuneToIndex(index);
  }

  /** Used by menu.js (Browse / Favorites / Search) to jump to a channel object. */
  function tuneToChannel(channel) {
    var index = channels.indexOf(channel);
    if (index === -1) {
      index = channels.findIndex(function (ch) { return ch.id === channel.id; });
    }
    if (index !== -1) tuneToIndex(index);
  }

  function getCurrentChannel() {
    return channels[currentIndex] || null;
  }

  // --- Numeric channel entry -------------------------------------------

  function handleDigit(digit) {
    channelEntryBuffer += digit;
    channelEntryValueEl.textContent = channelEntryBuffer;
    channelEntryEl.classList.remove("hidden");

    clearTimeout(channelEntryTimer);
    channelEntryTimer = setTimeout(commitChannelEntry, CHANNEL_ENTRY_TIMEOUT_MS);
  }

  function commitChannelEntry() {
    if (channelEntryBuffer.length > 0) {
      tuneToChannelNumber(parseInt(channelEntryBuffer, 10));
    }
    channelEntryBuffer = "";
    channelEntryEl.classList.add("hidden");
  }

  // --- Pause / play (Enter) -----------------------------------------------

  function togglePause() {
    var videoEl = Player.getVideoElement();
    if (videoEl.paused) {
      videoEl.play().catch(function () { /* needs a user gesture on some engines */ });
    } else {
      videoEl.pause();
    }
  }

  /** Driven by the <video>'s own play/pause events rather than togglePause()
   * so the badge and label stay right when something else pauses it too
   * (e.g. the app being hidden). */
  function syncPauseUi() {
    var paused = Player.getVideoElement().paused;
    pauseIndicatorEl.classList.toggle("hidden", !paused);
    softkeyCenterEl.textContent = paused ? "Play" : "Pause";
  }

  // --- Rotation / immersive mode (SoftRight) ----------------------------

  function toggleRotation() {
    rotated = !rotated;
    appEl.classList.toggle("rotated", rotated);
    softkeyRightEl.textContent = rotated ? "Exit Full Screen" : "Full Screen";
    if (rotated) {
      Ads.hideBanner();
      Ads.startFullscreenSchedule();
    } else {
      Ads.stopFullscreenSchedule();
      Ads.showBanner();
    }
  }

  // --- Background playback ----------------------------------------------

  function updateBgPopupFocus() {
    bgEnableBtn.classList.toggle("focused", bgPopupFocus === 0);
    bgCloseBtn.classList.toggle("focused", bgPopupFocus === 1);
  }

  function showBgPlaybackPopup() {
    bgPopupOpen = true;
    bgPopupFocus = 0;
    updateBgPopupFocus();
    bgPopupEl.classList.remove("hidden");
  }

  function hideBgPlaybackPopup() {
    bgPopupOpen = false;
    bgPopupEl.classList.add("hidden");
  }

  function handleBgPopupKey(key) {
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      bgPopupFocus = bgPopupFocus === 0 ? 1 : 0;
      updateBgPopupFocus();
    } else if (key === "Enter") {
      if (bgPopupFocus === 0) Settings.setBackgroundPlaybackEnabled(true);
      hideBgPlaybackPopup();
    } else if (key === "Backspace" || key === "SoftLeft" || key === "[") {
      hideBgPlaybackPopup();
    }
  }

  bgEnableBtn.addEventListener("click", function () {
    Settings.setBackgroundPlaybackEnabled(true);
    hideBgPlaybackPopup();
  });
  bgCloseBtn.addEventListener("click", hideBgPlaybackPopup);

  function handleVisibilityChange() {
    var videoEl = Player.getVideoElement();
    if (document.hidden) {
      wasHiddenWhilePlaying = !videoEl.paused && !videoEl.ended;
      if (!Settings.isBackgroundPlaybackEnabled()) {
        videoEl.pause();
      }
      // else: leave it playing — background playback is opted in.
    } else {
      if (wasHiddenWhilePlaying && !Settings.isBackgroundPlaybackEnabled()) {
        videoEl.play().catch(function () { /* needs a user gesture on some engines */ });
        showBgPlaybackPopup();
      }
      wasHiddenWhilePlaying = false;
    }
  }

  // --- Input handling ----------------------------------------------------

  function onKeyDown(event) {
    var key = event.key;

    // Back must never leave the app. A hardware Backspace with nothing
    // handling it falls through to the platform's default "navigate
    // back" action, which — with no browser history here — can close
    // the app outright. Text inputs are the one exception: there we
    // want the native delete-a-character behavior to fire normally.
    if (key === "Backspace") {
      var active = document.activeElement;
      var isTextInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (!isTextInput) event.preventDefault();
    }

    showSoftkeyBar();

    if (bgPopupOpen) {
      handleBgPopupKey(key);
      return;
    }

    if ((key === "SoftRight" || key === "]") && !Menu.isOpen()) {
      toggleRotation();
      return;
    }

    if (Ads.isFullscreenAdShowing()) {
      Ads.dismissFullscreen(); // any key skips it
      return;
    }

    if (Menu.handleKey(event)) return; // menu system open (or SoftLeft opening it)

    if (key === "ArrowUp") {
      nextChannel();
    } else if (key === "ArrowDown") {
      prevChannel();
    } else if (key === "ArrowRight") {
      seek(SEEK_STEP_SECONDS);
    } else if (key === "ArrowLeft") {
      seek(-SEEK_STEP_SECONDS);
    } else if (key === "#") {
      jumpCategory(1);
    } else if (key === "*") {
      jumpCategory(-1);
    } else if (key >= "0" && key <= "9") {
      handleDigit(key);
    } else if (key === "Enter") {
      if (channelEntryBuffer.length > 0) {
        clearTimeout(channelEntryTimer);
        commitChannelEntry();
      } else {
        togglePause();
      }
    } else if (key === "Backspace") {
      if (channelEntryBuffer.length > 0) {
        channelEntryBuffer = channelEntryBuffer.slice(0, -1);
        channelEntryValueEl.textContent = channelEntryBuffer;
        clearTimeout(channelEntryTimer);
        channelEntryTimer = setTimeout(commitChannelEntry, CHANNEL_ENTRY_TIMEOUT_MS);
      }
    }
  }

  // --- Startup -------------------------------------------------------------

  function restoreLastWatchedIndex() {
    var lastId = null;
    try {
      lastId = localStorage.getItem(LAST_WATCHED_KEY);
    } catch (e) {
      /* ignore */
    }
    if (!lastId) return 0;
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === lastId) return i;
    }
    return 0;
  }

  function init() {
    showLoading(true);
    Ads.init();

    Menu.init({
      getCurrentChannel: getCurrentChannel,
      tuneToChannel: tuneToChannel
    });

    Player.onError(function () {
      // Stream failed to load/play — auto-skip onward (requirements.md
      // section 3: don't show a dead screen), continuing in whichever
      // direction the user was browsing rather than always forward.
      autoSkip();
    });

    Channels.fetchChannels().then(function (result) {
      showLoading(false);
      channels = result.channels;

      if (result.error || channels.length === 0) {
        showError("Couldn't load the channel list. Check your connection.");
        return;
      }

      var startIndex = restoreLastWatchedIndex();
      tuneToIndex(startIndex);
      Ads.showBanner();
      showSoftkeyBar();
    });

    var videoEl = Player.getVideoElement();
    videoEl.addEventListener("play", syncPauseUi);
    videoEl.addEventListener("pause", syncPauseUi);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
