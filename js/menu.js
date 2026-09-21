/**
 * menu.js
 *
 * The SoftLeft menu and everything it opens into: Browse Channels (an EPG
 * grid against schedule.js's placeholder program data), Add/View
 * Favorites, Search, and Settings (dark mode / background playback).
 *
 * State machine: "closed" -> "menu" -> one of "browse" | "favorites" |
 * "search" | "settings". SoftLeft from any sub-view goes back to "menu"
 * (per the explicit Browse Channels spec, applied consistently to the
 * others); SoftLeft from "menu" closes back to "closed".
 *
 * Depends on a small hook object the host app provides via Menu.init():
 * { getCurrentChannel, tuneToChannel }.
 */

var Menu = (function () {
  var MENU_ITEMS = [
    { action: "browse", label: "Browse Channels" },
    { action: "favorite-toggle", label: "Add to Favorite Channels" },
    { action: "record", label: "Record Program" },
    { action: "favorites", label: "View Favorite Channels" },
    { action: "search", label: "Search" },
    { action: "settings", label: "Settings" }
  ];

  var BROWSE_COLS = 3;        // visible 15-minute time columns at once
  var BROWSE_SLOT_MIN = -8;   // 2 hours back (15-min slots)
  var BROWSE_SLOT_MAX = 24;   // 6 hours forward
  var BROWSE_VISIBLE_ROWS = 5;
  var BROWSE_NAME_COL_PERCENT = 34; // must match .browse-name-cell's flex-basis in style.css

  var state = "closed";
  var host = null; // { getCurrentChannel, tuneToChannel }

  var els = {};
  var menuHighlight = 0;

  var browseChannels = [];
  var browseIndex = 0;
  var browseWindowStart = 0; // slot offset of the leftmost visible column
  var browseColCursor = 0;   // 0..BROWSE_COLS-1, which visible column is highlighted

  var favoritesChannels = [];
  var favoritesIndex = 0;

  var searchQuery = "";
  var searchResults = [];
  var searchIndex = 0;
  var multiTap = { key: null, cycle: 0, timer: null };
  var MULTITAP_KEYS = {
    "1": [".", ",", "'", "1"],
    "2": ["a", "b", "c", "2"],
    "3": ["d", "e", "f", "3"],
    "4": ["g", "h", "i", "4"],
    "5": ["j", "k", "l", "5"],
    "6": ["m", "n", "o", "6"],
    "7": ["p", "q", "r", "s", "7"],
    "8": ["t", "u", "v", "8"],
    "9": ["w", "x", "y", "z", "9"],
    "0": [" ", "0"]
  };

  var settingsHighlight = 0;
  var SETTINGS_ITEMS = ["theme", "background-playback"];

  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function init(hostHooks) {
    host = hostHooks;
    els.overlay = $("menu-overlay");
    els.menuList = $("menu-list");
    els.browseView = $("browse-view");
    els.browseHeader = $("browse-header");
    els.browseRows = $("browse-rows");
    els.favoritesView = $("favorites-view");
    els.favoritesList = $("favorites-list");
    els.searchView = $("search-view");
    els.searchQuery = $("search-query");
    els.searchResults = $("search-results");
    els.settingsView = $("settings-view");
    els.settingsList = $("settings-list");
    els.toast = $("toast");

    renderMenuList();
  }

  function isOpen() {
    return state !== "closed";
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.add("hidden");
    }, 2500);
  }

  function hideAllViews() {
    els.overlay.classList.add("hidden");
    els.browseView.classList.add("hidden");
    els.favoritesView.classList.add("hidden");
    els.searchView.classList.add("hidden");
    els.settingsView.classList.add("hidden");
  }

  function open() {
    state = "menu";
    menuHighlight = 0;
    hideAllViews();
    els.overlay.classList.remove("hidden");
    renderMenuList();
  }

  function close() {
    state = "closed";
    hideAllViews();
  }

  function backToMenu() {
    state = "menu";
    menuHighlight = 0;
    hideAllViews();
    els.overlay.classList.remove("hidden");
    renderMenuList();
  }

  // --- Top-level menu ------------------------------------------------

  function renderMenuList() {
    if (!els.menuList) return;
    els.menuList.innerHTML = "";
    MENU_ITEMS.forEach(function (item, i) {
      var li = document.createElement("li");
      li.textContent = item.label;
      if (i === menuHighlight) li.className = "highlighted";
      els.menuList.appendChild(li);
    });
  }

  function activateMenuItem() {
    var item = MENU_ITEMS[menuHighlight];
    switch (item.action) {
      case "browse":
        openBrowse();
        break;
      case "favorite-toggle":
        toggleCurrentFavorite();
        break;
      case "record":
        toggleRecording();
        break;
      case "favorites":
        openFavorites();
        break;
      case "search":
        openSearch();
        break;
      case "settings":
        openSettings();
        break;
    }
  }

  function toggleCurrentFavorite() {
    var channel = host.getCurrentChannel();
    if (!channel) return;
    var nowFav = Settings.toggleFavorite(channel.id);
    showToast(nowFav ? "Added to favorites" : "Removed from favorites");
    close();
  }

  function toggleRecording() {
    var videoEl = host.getVideoElement();
    if (Recorder.isRecording()) {
      Recorder.stopAndSave().then(function (result) {
        if (result) {
          var a = document.createElement("a");
          a.href = result.url;
          a.download = (result.channel.name || "recording").replace(/[^a-z0-9]+/gi, "_") + ".webm";
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast("Recording saved");
        } else {
          showToast("Nothing was recorded");
        }
        updateRecordMenuLabel();
      });
    } else {
      var channel = host.getCurrentChannel();
      var ok = channel && Recorder.start(videoEl, channel);
      showToast(ok ? "Recording started" : "Couldn't record this stream (see console)");
      updateRecordMenuLabel();
    }
    close();
  }

  function updateRecordMenuLabel() {
    MENU_ITEMS[2].label = Recorder.isRecording() ? "Stop Recording" : "Record Program";
  }

  // --- Browse Channels (EPG grid) -------------------------------------

  function openBrowse() {
    state = "browse";
    hideAllViews();
    els.browseView.classList.remove("hidden");
    browseChannels = Channels.getVisibleChannels();
    var current = host.getCurrentChannel();
    browseIndex = 0;
    if (current) {
      var idx = browseChannels.findIndex(function (ch) { return ch.id === current.id; });
      if (idx !== -1) browseIndex = idx;
    }
    browseWindowStart = 0;
    browseColCursor = 0;
    renderBrowse();
  }

  function formatTime(ms) {
    var d = new Date(ms);
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  }

  /**
   * A grid of BROWSE_COLS 15-minute columns per row, like a real TV
   * guide: the time header always advances in fixed 15-minute steps, but
   * each row's cells are sized by each *program's actual duration* — a
   * 3rd of the row's flex space for a 15-minute show, all of it for a
   * 1-hour one — rather than one independent cell per column.
   */
  function renderBrowse() {
    if (browseChannels.length === 0) {
      els.browseHeader.innerHTML = "";
      els.browseRows.innerHTML = "No channels";
      return;
    }

    var windowStartMs = Schedule.slotStartTime(browseWindowStart);
    var windowEndMs = Schedule.slotStartTime(browseWindowStart + BROWSE_COLS);
    var cursorTimeMs = Schedule.slotStartTime(browseWindowStart + browseColCursor);

    els.browseHeader.innerHTML = "";
    var spacer = document.createElement("div");
    spacer.className = "browse-name-cell browse-header-spacer";
    els.browseHeader.appendChild(spacer);
    for (var c = 0; c < BROWSE_COLS; c++) {
      var timeEl = document.createElement("div");
      timeEl.className = "browse-cell browse-col-time";
      timeEl.textContent = formatTime(Schedule.slotStartTime(browseWindowStart + c));
      els.browseHeader.appendChild(timeEl);
    }

    // Red "now" line, positioned within the time-columns area only (not
    // over the channel-name column) — hidden when "now" has scrolled
    // outside the currently visible window.
    var nowFraction = (Date.now() - windowStartMs) / (windowEndMs - windowStartMs);
    if (nowFraction >= 0 && nowFraction <= 1) {
      var nowLine = document.createElement("div");
      nowLine.className = "browse-now-line";
      nowLine.style.left = (BROWSE_NAME_COL_PERCENT + nowFraction * (100 - BROWSE_NAME_COL_PERCENT)) + "%";
      els.browseHeader.appendChild(nowLine);
    }

    var half = Math.floor(BROWSE_VISIBLE_ROWS / 2);
    var start = Math.max(0, Math.min(browseIndex - half, browseChannels.length - BROWSE_VISIBLE_ROWS));
    if (start < 0) start = 0;
    var end = Math.min(browseChannels.length, start + BROWSE_VISIBLE_ROWS);

    els.browseRows.innerHTML = "";
    for (var i = start; i < end; i++) {
      var channel = browseChannels[i];
      var row = document.createElement("div");
      row.className = "browse-row" + (i === browseIndex ? " current-row" : "");

      var nameEl = document.createElement("div");
      nameEl.className = "browse-name-cell";
      nameEl.textContent = channel.number + ". " + channel.name;
      row.appendChild(nameEl);

      var programs = Schedule.getProgramsInRange(channel, windowStartMs, windowEndMs);
      programs.forEach(function (program) {
        var overlapStart = Math.max(program.start, windowStartMs);
        var overlapEnd = Math.min(program.end, windowEndMs);
        var widthSlots = Math.round((overlapEnd - overlapStart) / Schedule.SLOT_MS);
        if (widthSlots <= 0) return;

        var cellEl = document.createElement("div");
        var isHighlighted = i === browseIndex && program.start <= cursorTimeMs && cursorTimeMs < program.end;
        cellEl.className = "browse-cell" + (isHighlighted ? " highlighted" : "") +
          (Schedule.isNowAiring(program) ? " now-airing" : "");
        cellEl.style.flexGrow = widthSlots;
        cellEl.textContent = program.title;
        row.appendChild(cellEl);
      });

      els.browseRows.appendChild(row);
    }
  }

  function browseMoveRow(deltaRows) {
    browseIndex = Math.max(0, Math.min(browseChannels.length - 1, browseIndex + deltaRows));
    renderBrowse();
  }

  /** Absolute ms timestamp -> slot offset from "now" (exact: both are
   * multiples of Schedule.SLOT_MS by construction). */
  function msToSlotOffset(ms) {
    return Math.round((ms - Schedule.slotStartTime(0)) / Schedule.SLOT_MS);
  }

  /** Left/Right selects the next/previous whole *program*, not the next
   * 15-minute slot — a 1-hour show is one jump, not four. */
  function browseMoveToAdjacentProgram(direction) {
    var channel = browseChannels[browseIndex];
    if (!channel) return;
    var cursorTimeMs = Schedule.slotStartTime(browseWindowStart + browseColCursor);
    var currentProgram = Schedule.getProgramAtTime(channel, cursorTimeMs);
    if (!currentProgram) return;

    var targetTimeMs;
    if (direction > 0) {
      targetTimeMs = currentProgram.end; // the next program starts exactly when this one ends
    } else {
      var prevProgram = Schedule.getProgramAtTime(channel, currentProgram.start - 1);
      targetTimeMs = prevProgram ? prevProgram.start : currentProgram.start;
    }

    var targetSlotOffset = Math.max(BROWSE_SLOT_MIN, Math.min(BROWSE_SLOT_MAX, msToSlotOffset(targetTimeMs)));
    var maxWindowStart = BROWSE_SLOT_MAX - BROWSE_COLS + 1;

    if (targetSlotOffset < browseWindowStart || targetSlotOffset > browseWindowStart + BROWSE_COLS - 1) {
      // Repage so the target lands at the edge matching the direction of
      // travel, keeping context visible on the side you came from.
      var newStart = direction > 0 ? targetSlotOffset - BROWSE_COLS + 1 : targetSlotOffset;
      browseWindowStart = Math.min(maxWindowStart, Math.max(BROWSE_SLOT_MIN, newStart));
    }
    browseColCursor = targetSlotOffset - browseWindowStart;
    renderBrowse();
  }

  function browseActivate() {
    var channel = browseChannels[browseIndex];
    if (!channel) return;
    var cursorTimeMs = Schedule.slotStartTime(browseWindowStart + browseColCursor);
    var program = Schedule.getProgramAtTime(channel, cursorTimeMs);
    if (!program) return;

    if (Schedule.isFuture(program)) {
      Notifications.scheduleRecording(channel, program);
      var when = formatTime(program.start);
      var note = Notifications.isRealSchedulingAvailable()
        ? "Reminders set for " + when
        : "Reminders set for " + when + " (this session only — see console)";
      showToast(note);
    } else {
      host.tuneToChannel(channel);
      close();
    }
  }

  // --- Favorites -------------------------------------------------------

  function openFavorites() {
    state = "favorites";
    hideAllViews();
    els.favoritesView.classList.remove("hidden");
    var favIds = Settings.getFavorites();
    favoritesChannels = favIds.map(function (id) { return Channels.getAnyById(id); }).filter(Boolean);
    favoritesIndex = 0;
    renderFavorites();
  }

  function renderFavorites() {
    els.favoritesList.innerHTML = "";
    if (favoritesChannels.length === 0) {
      var empty = document.createElement("li");
      empty.className = "empty-message";
      empty.textContent = "No favorites yet — add one from the menu.";
      els.favoritesList.appendChild(empty);
      return;
    }
    favoritesChannels.forEach(function (channel, i) {
      var li = document.createElement("li");
      var unavailable = channel.enabled === false;
      li.textContent = channel.number + ". " + channel.name + (unavailable ? " (temporarily unavailable)" : "");
      var cls = [];
      if (i === favoritesIndex) cls.push("highlighted");
      if (unavailable) cls.push("unavailable");
      li.className = cls.join(" ");
      els.favoritesList.appendChild(li);
    });
  }

  function favoritesMove(delta) {
    if (favoritesChannels.length === 0) return;
    favoritesIndex = Math.max(0, Math.min(favoritesChannels.length - 1, favoritesIndex + delta));
    renderFavorites();
  }

  function favoritesActivate() {
    var channel = favoritesChannels[favoritesIndex];
    if (!channel || channel.enabled === false) return;
    host.tuneToChannel(channel);
    close();
  }

  // --- Search (numeric multi-tap) ---------------------------------------

  function openSearch() {
    state = "search";
    hideAllViews();
    els.searchView.classList.remove("hidden");
    searchQuery = "";
    searchResults = [];
    searchIndex = 0;
    resetMultiTap();
    renderSearch();
  }

  function resetMultiTap() {
    clearTimeout(multiTap.timer);
    multiTap.key = null;
    multiTap.cycle = 0;
    multiTap.timer = null;
  }

  function commitMultiTapChar() {
    resetMultiTap();
  }

  function handleSearchDigit(digit) {
    var letters = MULTITAP_KEYS[digit];
    if (!letters) return;

    if (multiTap.key === digit) {
      multiTap.cycle = (multiTap.cycle + 1) % letters.length;
      searchQuery = searchQuery.slice(0, -1) + letters[multiTap.cycle];
    } else {
      if (multiTap.key !== null) commitMultiTapChar();
      multiTap.key = digit;
      multiTap.cycle = 0;
      searchQuery += letters[0];
    }
    clearTimeout(multiTap.timer);
    multiTap.timer = setTimeout(commitMultiTapChar, 800);

    runSearch();
  }

  function handleSearchBackspace() {
    if (searchQuery.length === 0) {
      backToMenu();
      return;
    }
    searchQuery = searchQuery.slice(0, -1);
    resetMultiTap();
    runSearch();
  }

  function runSearch() {
    var q = searchQuery.trim().toLowerCase();
    if (q.length === 0) {
      searchResults = [];
    } else {
      searchResults = Channels.getVisibleChannels()
        .filter(function (ch) { return ch.name && ch.name.toLowerCase().indexOf(q) !== -1; })
        .slice(0, 20);
    }
    searchIndex = 0;
    renderSearch();
  }

  function renderSearch() {
    els.searchQuery.textContent = searchQuery.length ? searchQuery : "Type to search…";
    els.searchResults.innerHTML = "";
    searchResults.forEach(function (channel, i) {
      var li = document.createElement("li");
      li.textContent = channel.number + ". " + channel.name;
      if (i === searchIndex) li.className = "highlighted";
      els.searchResults.appendChild(li);
    });
  }

  function searchMove(delta) {
    if (searchResults.length === 0) return;
    searchIndex = Math.max(0, Math.min(searchResults.length - 1, searchIndex + delta));
    renderSearch();
  }

  function searchActivate() {
    var channel = searchResults[searchIndex];
    if (!channel) return;
    host.tuneToChannel(channel);
    close();
  }

  // --- Settings ----------------------------------------------------------

  function openSettings() {
    state = "settings";
    hideAllViews();
    els.settingsView.classList.remove("hidden");
    settingsHighlight = 0;
    renderSettings();
  }

  function renderSettings() {
    els.settingsList.innerHTML = "";

    var themeLi = document.createElement("li");
    themeLi.textContent = "Dark Mode: " + (Settings.getTheme() === "dark" ? "On" : "Off");
    if (settingsHighlight === 0) themeLi.className = "highlighted";
    els.settingsList.appendChild(themeLi);

    var bgLi = document.createElement("li");
    bgLi.textContent = "Background Playback: " + (Settings.isBackgroundPlaybackEnabled() ? "On" : "Off");
    if (settingsHighlight === 1) bgLi.className = "highlighted";
    els.settingsList.appendChild(bgLi);
  }

  function settingsMove(delta) {
    settingsHighlight = (settingsHighlight + delta + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length;
    renderSettings();
  }

  function settingsActivate() {
    if (SETTINGS_ITEMS[settingsHighlight] === "theme") {
      Settings.toggleTheme();
    } else {
      Settings.setBackgroundPlaybackEnabled(!Settings.isBackgroundPlaybackEnabled());
    }
    renderSettings();
  }

  // --- Key routing ---------------------------------------------------

  /** Returns true if the key was consumed (caller shouldn't also handle it). */
  function handleKey(event) {
    var key = event.key;

    if (key === "SoftLeft" || key === "[") {
      if (state === "menu") close();
      else if (state === "closed") open();
      else backToMenu();
      return true;
    }

    if (state === "closed") return false;

    if (state === "menu") {
      if (key === "ArrowUp") { menuHighlight = (menuHighlight - 1 + MENU_ITEMS.length) % MENU_ITEMS.length; renderMenuList(); }
      else if (key === "ArrowDown") { menuHighlight = (menuHighlight + 1) % MENU_ITEMS.length; renderMenuList(); }
      else if (key === "Enter") { activateMenuItem(); }
      else if (key === "Backspace") { close(); }
      return true;
    }

    if (state === "browse") {
      if (key === "ArrowUp") browseMoveRow(-1);
      else if (key === "ArrowDown") browseMoveRow(1);
      else if (key === "ArrowLeft") browseMoveToAdjacentProgram(-1);
      else if (key === "ArrowRight") browseMoveToAdjacentProgram(1);
      else if (key === "Enter") browseActivate();
      else if (key === "Backspace") backToMenu();
      return true;
    }

    if (state === "favorites") {
      if (key === "ArrowUp") favoritesMove(-1);
      else if (key === "ArrowDown") favoritesMove(1);
      else if (key === "Enter") favoritesActivate();
      else if (key === "Backspace") backToMenu();
      return true;
    }

    if (state === "search") {
      if (key >= "0" && key <= "9") handleSearchDigit(key);
      else if (key === "ArrowUp") searchMove(-1);
      else if (key === "ArrowDown") searchMove(1);
      else if (key === "Enter") searchActivate();
      else if (key === "Backspace") handleSearchBackspace();
      return true;
    }

    if (state === "settings") {
      if (key === "ArrowUp") settingsMove(-1);
      else if (key === "ArrowDown") settingsMove(1);
      else if (key === "Enter") settingsActivate();
      else if (key === "Backspace") backToMenu();
      return true;
    }

    return true; // any other key while a menu view is open is swallowed
  }

  return {
    init: init,
    isOpen: isOpen,
    open: open,
    close: close,
    handleKey: handleKey,
    showToast: showToast
  };
})();
