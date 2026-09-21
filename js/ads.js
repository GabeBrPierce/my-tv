/**
 * ads.js
 *
 * Banner ad strip (shown above the player in normal mode, rotates every
 * 30s) and a fullscreen ad (shown once every 10 minutes in rotated/
 * immersive mode instead of the banner).
 *
 * PLACEHOLDER CREATIVES: there's no real ad network wired up — that needs
 * an actual ad SDK (e.g. a KaiAds account, or another network's KaiOS-
 * compatible SDK) and credentials a coding session can't provision. The
 * creatives below are obviously-fake placeholders so the layout, timing,
 * and softkey behavior are real and testable; swap `CREATIVES` and the
 * render logic for a real SDK's ad unit when you have one.
 */

var Ads = (function () {
  var BANNER_ROTATE_MS = 30 * 1000;
  var FULLSCREEN_INTERVAL_MS = 10 * 60 * 1000;
  var FULLSCREEN_AUTO_DISMISS_MS = 6 * 1000;

  var CREATIVES = [
    { text: "Your Ad Here", bg: "#2a63c9" },
    { text: "Sponsored Placeholder", bg: "#c9682a" },
    { text: "Ad Slot 3 of 3", bg: "#3a9b5c" }
  ];

  var bannerEl, bannerTextEl, fullscreenEl, fullscreenTextEl;
  var rotateTimer = null;
  var fullscreenScheduleTimer = null;
  var fullscreenDismissTimer = null;
  var creativeIndex = 0;
  var bannerVisible = false;

  function init() {
    bannerEl = document.getElementById("ad-banner");
    bannerTextEl = document.getElementById("ad-banner-text");
    fullscreenEl = document.getElementById("ad-fullscreen");
    fullscreenTextEl = document.getElementById("ad-fullscreen-text");
  }

  function currentCreative() {
    return CREATIVES[creativeIndex % CREATIVES.length];
  }

  function renderBanner() {
    var c = currentCreative();
    bannerTextEl.textContent = c.text;
    bannerEl.style.background = c.bg;
  }

  function showBanner() {
    if (!bannerEl || bannerVisible) return;
    bannerVisible = true;
    document.body.classList.add("has-ad-banner");
    bannerEl.classList.remove("hidden");
    renderBanner();
    clearInterval(rotateTimer);
    rotateTimer = setInterval(function () {
      creativeIndex++;
      renderBanner();
    }, BANNER_ROTATE_MS);
  }

  function hideBanner() {
    bannerVisible = false;
    document.body.classList.remove("has-ad-banner");
    if (bannerEl) bannerEl.classList.add("hidden");
    clearInterval(rotateTimer);
    rotateTimer = null;
  }

  function showFullscreenNow() {
    if (!fullscreenEl) return;
    var c = currentCreative();
    creativeIndex++;
    fullscreenTextEl.textContent = c.text;
    fullscreenEl.style.background = c.bg;
    fullscreenEl.classList.remove("hidden");
    clearTimeout(fullscreenDismissTimer);
    fullscreenDismissTimer = setTimeout(dismissFullscreen, FULLSCREEN_AUTO_DISMISS_MS);
  }

  function dismissFullscreen() {
    clearTimeout(fullscreenDismissTimer);
    if (fullscreenEl) fullscreenEl.classList.add("hidden");
  }

  function isFullscreenAdShowing() {
    return !!fullscreenEl && !fullscreenEl.classList.contains("hidden");
  }

  function startFullscreenSchedule() {
    clearInterval(fullscreenScheduleTimer);
    fullscreenScheduleTimer = setInterval(showFullscreenNow, FULLSCREEN_INTERVAL_MS);
  }

  function stopFullscreenSchedule() {
    clearInterval(fullscreenScheduleTimer);
    fullscreenScheduleTimer = null;
    dismissFullscreen();
  }

  return {
    init: init,
    showBanner: showBanner,
    hideBanner: hideBanner,
    isBannerVisible: function () { return bannerVisible; },
    startFullscreenSchedule: startFullscreenSchedule,
    stopFullscreenSchedule: stopFullscreenSchedule,
    isFullscreenAdShowing: isFullscreenAdShowing,
    dismissFullscreen: dismissFullscreen
  };
})();
