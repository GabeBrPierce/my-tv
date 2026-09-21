/**
 * settings.js
 *
 * Small localStorage-backed store for user preferences: theme,
 * background-playback opt-in, and favorite channel ids. Loaded first (see
 * index.html) so the theme can be applied before the rest of the app
 * renders, avoiding a flash of the wrong theme.
 */

var Settings = (function () {
  var KEY = "mytv.settings.v1";
  var defaults = { theme: "dark", backgroundPlayback: false, favorites: [] };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, defaults);
      var parsed = JSON.parse(raw);
      return Object.assign({}, defaults, parsed);
    } catch (e) {
      return Object.assign({}, defaults);
    }
  }

  var state = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* non-fatal */
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
  }

  function getTheme() {
    return state.theme;
  }

  function setTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    save();
    applyTheme();
  }

  function toggleTheme() {
    setTheme(state.theme === "dark" ? "light" : "dark");
  }

  function isBackgroundPlaybackEnabled() {
    return !!state.backgroundPlayback;
  }

  function setBackgroundPlaybackEnabled(on) {
    state.backgroundPlayback = !!on;
    save();
  }

  function getFavorites() {
    return state.favorites.slice();
  }

  function isFavorite(channelId) {
    return state.favorites.indexOf(channelId) !== -1;
  }

  /** Returns true if the channel is now a favorite (false if just removed). */
  function toggleFavorite(channelId) {
    var idx = state.favorites.indexOf(channelId);
    if (idx === -1) {
      state.favorites.push(channelId);
    } else {
      state.favorites.splice(idx, 1);
    }
    save();
    return idx === -1;
  }

  applyTheme();

  return {
    getTheme: getTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    isBackgroundPlaybackEnabled: isBackgroundPlaybackEnabled,
    setBackgroundPlaybackEnabled: setBackgroundPlaybackEnabled,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite
  };
})();
