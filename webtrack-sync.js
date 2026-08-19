/*
 * webtrack-sync.js
 * ------------------------------------------------------------------
 * A tiny same-origin bridge that lets the Job Composer (dispatcher)
 * prototype and the Driver App prototype talk to each other in real
 * time when opened as two tabs/windows of the same browser.
 *
 * How it works:
 *  - The "shared job list" is stored as JSON in localStorage, which
 *    is already scoped per-origin and shared across every tab of
 *    that origin — this is what makes it work once both files are
 *    served from the same GitHub Pages site.
 *  - A BroadcastChannel gives near-instant push notification to any
 *    other open tab the moment the data changes (localStorage's own
 *    'storage' event only fires in *other* tabs and can lag slightly
 *    in some browsers, so BroadcastChannel is used as the primary
 *    signal and 'storage' as a fallback).
 *
 * This file intentionally has NO knowledge of Job Composer or Driver
 * App internals — it only stores/retrieves a plain array of "shared
 * job" objects and notifies listeners when that array changes. Both
 * prototypes are responsible for translating their own data model
 * into/out of this shape.
 *
 * Shared job shape (both apps agree on this):
 * {
 *   id: string,                 // matches Composer's job.id
 *   pickupLocation: string,
 *   deliveryLocation: string,
 *   client: string,
 *   ref: string,                // display label / AWB / job number
 *   meta: { kind: 'road'|'air', cu: number, packaging?: string },
 *   qty: { total: number, collected: number, delivered: number },
 *   confirmed: { pickup: boolean, delivery: boolean }
 * }
 * ------------------------------------------------------------------
 */
(function () {
  var JOBS_KEY = 'webtrack_sync_jobs_v1';
  var CHANNEL_NAME = 'webtrack-sync';

  var channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch (e) {
    channel = null;
  }

  var listeners = [];

  function readJobs() {
    try {
      var raw = localStorage.getItem(JOBS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeJobs(jobsArray) {
    try {
      localStorage.setItem(JOBS_KEY, JSON.stringify(jobsArray || []));
    } catch (e) {
      // localStorage can throw if disabled/full — fail quietly, the
      // demo just won't sync rather than crashing either prototype.
    }
  }

  function notifyListeners() {
    listeners.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        if (window.console) console.error('WebtrackSync listener error:', e);
      }
    });
  }

  function broadcastChange() {
    if (channel) {
      try {
        channel.postMessage({ type: 'jobs-updated', at: Date.now() });
      } catch (e) {}
    }
  }

  // Other tabs on the same origin get this automatically whenever
  // localStorage changes — kept as a fallback alongside BroadcastChannel.
  window.addEventListener('storage', function (e) {
    if (e.key === JOBS_KEY) notifyListeners();
  });

  if (channel) {
    channel.onmessage = function (e) {
      if (e && e.data && e.data.type === 'jobs-updated') notifyListeners();
    };
  }

  window.WebtrackSync = {
    // Full replace — used by Job Composer to publish "what's on the truck".
    setJobs: function (jobsArray) {
      writeJobs(jobsArray);
      broadcastChange();
      notifyListeners(); // fires in THIS tab too — storage/BroadcastChannel don't loop back to the sender
    },

    getJobs: function () {
      return readJobs();
    },

    // Partial update to one job — used by Driver App to report
    // pickup/delivery progress back to Job Composer.
    updateJobStatus: function (jobId, patch) {
      var jobsArray = readJobs();
      var job = jobsArray.find(function (j) {
        return j.id === jobId;
      });
      if (!job) return;
      if (patch && patch.qty) {
        job.qty = Object.assign({}, job.qty, patch.qty);
      }
      if (patch && patch.confirmed) {
        job.confirmed = Object.assign({}, job.confirmed, patch.confirmed);
      }
      if (patch && patch.confirmedAt) {
        job.confirmedAt = Object.assign({}, job.confirmedAt, patch.confirmedAt);
      }
      writeJobs(jobsArray);
      broadcastChange();
      notifyListeners();
    },

    // Register a callback fired whenever the shared job list changes,
    // from either this tab or another one.
    onJobsUpdated: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },

    // Wipes the shared state — handy for resetting a demo between runs.
    clear: function () {
      try {
        localStorage.removeItem(JOBS_KEY);
      } catch (e) {}
      broadcastChange();
      notifyListeners();
    }
  };
})();
