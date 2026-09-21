/**
 * notifications.js
 *
 * Schedules the two "open the app to record" reminders for a future
 * program: 5 minutes before it starts, and at start time.
 *
 * FEASIBILITY NOTE: reminders that fire even while the app is closed need
 * the KaiOS/B2G Alarm API (`navigator.mozAlarms` + a `"alarm"` system
 * message handler), a privileged, KaiOS-only API not present in desktop
 * browsers — same category of unverified-on-real-hardware API as
 * buffer.js's captureStream/MediaRecorder use. When it's missing (e.g.
 * testing here), this falls back to an in-page setTimeout + Notification,
 * which only fires while this tab/app instance stays open. That's enough
 * to prove the scheduling and UI flow, not a substitute for the real
 * thing — verify `navigator.mozAlarms` on-device, and see manifest
 * `permissions.alarms`, added alongside this module.
 */

var Notifications = (function () {
  var supportsAlarms = !!navigator.mozAlarms;
  var supportsNotification = typeof Notification !== "undefined";
  var fallbackTimers = [];

  function ensurePermission() {
    if (!supportsNotification) return Promise.resolve(false);
    if (Notification.permission === "granted") return Promise.resolve(true);
    if (Notification.permission === "denied") return Promise.resolve(false);
    return Notification.requestPermission().then(function (perm) {
      return perm === "granted";
    });
  }

  function scheduleAlarm(date, data) {
    return new Promise(function (resolve, reject) {
      var req = navigator.mozAlarms.add(date, "ignoreTimezone", data);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function scheduleFallback(date, cb) {
    var delay = date.getTime() - Date.now();
    if (delay <= 0) {
      cb();
      return;
    }
    fallbackTimers.push(setTimeout(cb, delay));
  }

  function notifyNow(channel, program, label) {
    if (supportsNotification && Notification.permission === "granted") {
      try {
        new Notification("My TV recording reminder", {
          body: channel.name + " — " + program.title + " starts " + label + ". Open My TV to record.",
          tag: "mytv-record-" + channel.id + "-" + program.start
        });
        return;
      } catch (e) {
        /* fall through to console log below */
      }
    }
    console.log("[Notifications] " + channel.name + " — " + program.title + " starts " + label);
  }

  /**
   * Schedules the 5-minutes-prior and at-start-time reminders for a
   * future program. Returns false if the program isn't actually in the
   * future (nothing to schedule).
   */
  function scheduleRecording(channel, program) {
    if (program.start <= Date.now()) return false;

    ensurePermission();
    var startDate = new Date(program.start);
    var reminderDate = new Date(program.start - 5 * 60 * 1000);
    var payload = {
      type: "record-reminder",
      channelId: channel.id,
      channelName: channel.name,
      programTitle: program.title,
      programStart: program.start
    };

    [[reminderDate, "in 5 minutes"], [startDate, "now"]].forEach(function (pair) {
      var when = pair[0], label = pair[1];
      if (when.getTime() <= Date.now()) return; // e.g. program starts in <5 min
      if (supportsAlarms) {
        var withLabel = {};
        for (var k in payload) withLabel[k] = payload[k];
        withLabel.label = label;
        scheduleAlarm(when, withLabel).catch(function (e) {
          console.warn("[Notifications] mozAlarms.add failed:", e);
        });
      } else {
        scheduleFallback(when, function () {
          notifyNow(channel, program, label);
        });
      }
    });

    return true;
  }

  // Wire the alarm system message so a firing alarm shows the reminder —
  // including one set during a previous run of the app. KaiOS/B2G only;
  // navigator.mozSetMessageHandler doesn't exist in a normal browser.
  if (navigator.mozSetMessageHandler) {
    navigator.mozSetMessageHandler("alarm", function (mozAlarm) {
      var data = mozAlarm.data || {};
      if (data.type === "record-reminder") {
        notifyNow(
          { id: data.channelId, name: data.channelName },
          { title: data.programTitle, start: data.programStart },
          data.label || "now"
        );
      }
    });
  }

  return {
    isRealSchedulingAvailable: function () { return supportsAlarms; },
    ensurePermission: ensurePermission,
    scheduleRecording: scheduleRecording
  };
})();
