/* ============================================================
   AI FITNESS COACH — LOCALSTORAGE DATA LAYER
   ------------------------------------------------------------
   Single source of truth for all persistence. Exposes the same
   global API the previous cloud-backed wrappers did, so the
   page scripts needed no rewrite.

   SECURITY NOTE — READ THIS
   This is a FRONTEND-ONLY DEMO. Everything lives in the
   browser's LocalStorage, which any person with devtools can
   read and edit. Passwords are salted and hashed so they are
   not stored in plain text, but that is demo hygiene, NOT
   production security: there is no server, so no check here can
   be enforced against a determined user. Admin credentials are
   hardcoded demo values. Do not describe this as secure auth.

   Depends on: js/utils.js (afcValidEmail, afcTodayKey, afcAddDays)
   Optional:   js/demo-data.js (afcSeedDemoData) for first-run seed
   ============================================================ */

(function () {
  "use strict";

  /* ============================
     1. KEY MAP
     ============================ */

  /* One LocalStorage key per top-level collection. Keeping them
     separate means a write to users/{uid}/daily/... never has to
     re-serialize the large weeklyPlans seed. */
  var COLLECTIONS = {
    settings: "afc_app_settings",
    goals: "afc_goals",
    exercises: "afc_exercises",
    workouts: "afc_workouts",
    meals: "afc_meals",
    dietPlans: "afc_diet_plans",
    weeklyPlans: "afc_weekly_plans",
    pricing: "afc_subscription_plans",
    chatbot: "afc_chatbot",
    feedback: "afc_feedback",
    users: "afc_users",
    media: "afc_media",
    adminGallery: "afc_admin_gallery"
  };

  var KEY_SESSION = "afc_current_user";
  var KEY_ADMIN_SESSION = "afc_admin_session";
  var KEY_AUTH = "afc_auth";
  var KEY_SEEDED = "afc_seeded";
  var KEY_LIB_VERSION = "afc_library_version";
  var IMG_PREFIX = "afc_img_";

  var warnedRoots = {};

  /* path -> { key, segs } ; segs excludes the collection root. */
  function resolve(path) {
    var segs = String(path == null ? "" : path).split("/").filter(function (s) {
      return s !== "";
    });
    if (!segs.length) return { key: null, segs: [] };
    var root = segs[0];
    var key = COLLECTIONS[root];
    if (!key) {
      /* Unknown roots still work, they just get their own bucket. */
      key = "afc_db_" + root;
      if (!warnedRoots[root]) {
        warnedRoots[root] = true;
        console.warn("[AFC] Unknown collection root: " + root + " -> " + key);
      }
    }
    return { key: key, segs: segs.slice(1) };
  }

  /* ============================
     2. CACHE + CLONE
     ============================ */

  var cache = new Map();

  function readDoc(key) {
    if (cache.has(key)) return cache.get(key);
    var doc = {};
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") doc = parsed;
      } catch (e) {
        console.error("[AFC] Corrupt JSON in " + key + ", resetting.", e);
      }
    }
    cache.set(key, doc);
    return doc;
  }

  function dropCache(key) { cache.delete(key); }

  function clone(value) {
    if (value === null || typeof value !== "object") return value;
    try { return structuredClone(value); } catch (e) { /* older browsers */ }
    try { return JSON.parse(JSON.stringify(value)); } catch (e2) { return value; }
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /* Walk down; returns undefined when any segment is missing or
     the walk passes through a scalar. */
  function walk(doc, segs) {
    var cur = doc;
    for (var i = 0; i < segs.length; i++) {
      if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined;
      cur = cur[segs[i]];
      if (cur === undefined) return undefined;
    }
    return cur;
  }

  /* ============================
     3. IMAGE TOKEN INDIRECTION
     ============================ */

  /* Base64 images are moved out of collection documents into their
     own afc_img_* keys. Pages always see real data URLs; the stored
     JSON stays small so a large gallery cannot evict user accounts. */

  var DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
  var TOKEN_RE = /^afcimg:([A-Za-z0-9_-]+)$/;

  function newImageId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  /* Replace data URLs with tokens, persisting each blob separately. */
  function externalize(value) {
    if (typeof value === "string") {
      if (!DATA_URL_RE.test(value)) return value;
      var id = newImageId();
      try {
        localStorage.setItem(IMG_PREFIX + id, value);
      } catch (e) {
        throw quotaError(e);
      }
      return "afcimg:" + id;
    }
    if (Array.isArray(value)) return value.map(externalize);
    if (isPlainObject(value)) {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = externalize(value[k]); });
      return out;
    }
    return value;
  }

  /* Swap tokens back to data URLs. A token whose blob is gone
     resolves to "" so the existing icon fallback renders instead
     of a broken image. */
  function rehydrate(value) {
    if (typeof value === "string") {
      var m = TOKEN_RE.exec(value);
      if (!m) return value;
      var blob = null;
      try { blob = localStorage.getItem(IMG_PREFIX + m[1]); } catch (e) { blob = null; }
      return blob || "";
    }
    if (Array.isArray(value)) return value.map(rehydrate);
    if (isPlainObject(value)) {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = rehydrate(value[k]); });
      return out;
    }
    return value;
  }

  function collectTokens(value, into) {
    if (typeof value === "string") {
      var m = TOKEN_RE.exec(value);
      if (m) into[m[1]] = true;
      return;
    }
    if (Array.isArray(value)) { value.forEach(function (v) { collectTokens(v, into); }); return; }
    if (isPlainObject(value)) {
      Object.keys(value).forEach(function (k) { collectTokens(value[k], into); });
    }
  }

  /* Delete image blobs that disappeared from this collection.
     Scoped to one collection so a shared blob elsewhere is safe. */
  function gcImages(oldValue, newDoc) {
    var before = {};
    collectTokens(oldValue, before);
    var ids = Object.keys(before);
    if (!ids.length) return;
    var after = {};
    collectTokens(newDoc, after);
    ids.forEach(function (id) {
      if (!after[id]) {
        try { localStorage.removeItem(IMG_PREFIX + id); } catch (e) { /* ignore */ }
      }
    });
  }

  function quotaError(e) {
    var err = new Error("Device storage is full. Remove some photos or reset data in Settings, then try again.");
    err.code = "storage/quota-exceeded";
    err.cause = e;
    return err;
  }

  /* ============================
     4. SUBSCRIPTIONS
     ============================ */

  /* key -> [{key, segs, cb, alive}] */
  var subs = new Map();
  var dirty = new Set();
  var flushScheduled = false;

  /* True when either path is a prefix of the other. Both directions
     matter: the dashboard listens on daily/{today} while meals write
     to daily/{today}/meals/breakfast. */
  function pathsOverlap(a, b) {
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(flush, 0);
  }

  function flush() {
    flushScheduled = false;
    var pending = Array.from(dirty);
    dirty.clear();
    pending.forEach(function (s) {
      if (!s.alive || !s.key) return;
      var raw = walk(readDoc(s.key), s.segs);
      var value = raw === undefined ? null : rehydrate(clone(raw));
      try {
        s.cb(value);
      } catch (e) {
        console.error("[AFC] listener callback failed", e);
      }
    });
  }

  function notify(key, segs) {
    var list = subs.get(key);
    if (!list || !list.length) return;
    list.forEach(function (s) {
      if (s.alive && pathsOverlap(segs, s.segs)) dirty.add(s);
    });
    scheduleFlush();
  }

  function notifyAll(key) {
    var list = subs.get(key);
    if (!list || !list.length) return;
    list.forEach(function (s) { if (s.alive) dirty.add(s); });
    scheduleFlush();
  }

  /* Cross-tab: another tab wrote, so drop our copy and re-fire. */
  window.addEventListener("storage", function (e) {
    if (!e.key) return;
    if (e.key.indexOf(IMG_PREFIX) === 0) return;
    dropCache(e.key);
    notifyAll(e.key);
  });

  /* ============================
     5. PERSIST
     ============================ */

  function persist(key) {
    var doc = cache.get(key);
    if (doc === undefined) return;
    try {
      localStorage.setItem(key, JSON.stringify(doc));
    } catch (e) {
      /* Resync from disk so the cache is not left ahead of storage. */
      dropCache(key);
      readDoc(key);
      throw quotaError(e);
    }
  }

  /* ============================
     6. PUBLIC DB API
     ============================ */

  window.afcDbGet = async function (path) {
    var r = resolve(path);
    if (!r.key) return null;
    var raw = walk(readDoc(r.key), r.segs);
    if (raw === undefined) return null;
    return rehydrate(clone(raw));
  };

  window.afcDbSet = async function (path, value) {
    var r = resolve(path);
    if (!r.key) throw new Error("[AFC] afcDbSet requires a non-empty path.");

    var doc = readDoc(r.key);

    /* null means delete, matching the previous data layer. false / 0 / "" are real
       values and must persist — habits are stored as booleans. */
    if (value === null || value === undefined) {
      var oldRemove = r.segs.length ? walk(doc, r.segs) : doc;
      if (r.segs.length) {
        deleteNode(doc, r.segs);
        prune(doc, r.segs);
      } else {
        cache.set(r.key, {});
        doc = cache.get(r.key);
      }
      persist(r.key);
      gcImages(oldRemove, doc);
      notify(r.key, r.segs);
      return;
    }

    var stored = externalize(clone(value));
    var old = r.segs.length ? walk(doc, r.segs) : doc;

    if (r.segs.length) {
      setNode(doc, r.segs, stored);
    } else {
      cache.set(r.key, isPlainObject(stored) || Array.isArray(stored) ? stored : { value: stored });
      doc = cache.get(r.key);
    }

    persist(r.key);
    gcImages(old, doc);
    notify(r.key, r.segs);
  };

  /* Shallow merge into the object at path; per-key null deletes.
     Creates the node when absent. */
  window.afcDbUpdate = async function (path, value) {
    var r = resolve(path);
    if (!r.key) throw new Error("[AFC] afcDbUpdate requires a non-empty path.");
    var doc = readDoc(r.key);
    var old = r.segs.length ? clone(walk(doc, r.segs)) : clone(doc);

    var node = r.segs.length ? walk(doc, r.segs) : doc;
    if (!isPlainObject(node)) {
      node = {};
      if (r.segs.length) setNode(doc, r.segs, node);
      else { cache.set(r.key, node); doc = node; }
    }

    Object.keys(value || {}).forEach(function (k) {
      var v = value[k];
      if (v === null || v === undefined) { delete node[k]; return; }
      node[k] = externalize(clone(v));
    });

    persist(r.key);
    gcImages(old, doc);
    notify(r.key, r.segs);
  };

  window.afcDbPush = async function (path, value) {
    var r = resolve(path);
    if (!r.key) throw new Error("[AFC] afcDbPush requires a non-empty path.");
    var doc = readDoc(r.key);
    var node = r.segs.length ? walk(doc, r.segs) : doc;
    if (!isPlainObject(node)) {
      node = {};
      if (r.segs.length) setNode(doc, r.segs, node);
      else { cache.set(r.key, node); doc = node; }
    }
    /* Time-sortable and unique; readers enumerate keys and sort by .at */
    var key = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    node[key] = externalize(clone(value));
    persist(r.key);
    notify(r.key, r.segs.concat([key]));
    return key;
  };

  window.afcDbRemove = async function (path) {
    var r = resolve(path);
    if (!r.key) return;
    var doc = readDoc(r.key);
    var old = r.segs.length ? walk(doc, r.segs) : doc;
    if (r.segs.length) {
      deleteNode(doc, r.segs);
      prune(doc, r.segs);
    } else {
      cache.set(r.key, {});
      doc = cache.get(r.key);
    }
    persist(r.key);
    gcImages(old, doc);
    notify(r.key, r.segs);
  };

  window.afcDbOnValue = async function (path, cb) {
    var r = resolve(path);
    var sub = { key: r.key, segs: r.segs, cb: cb, alive: true };
    if (!r.key) {
      /* Nothing to watch; still fire once so callers can stop their spinner. */
      setTimeout(function () { try { cb(null); } catch (e) { console.error(e); } }, 0);
      return function () { sub.alive = false; };
    }
    if (!subs.has(r.key)) subs.set(r.key, []);
    subs.get(r.key).push(sub);
    dirty.add(sub);
    scheduleFlush();
    return function () {
      sub.alive = false;
      dirty.delete(sub);
      var list = subs.get(r.key);
      if (list) {
        var i = list.indexOf(sub);
        if (i >= 0) list.splice(i, 1);
      }
    };
  };

  /* Auto-vivify missing parents, then replace the node entirely. */
  function setNode(doc, segs, value) {
    var cur = doc;
    for (var i = 0; i < segs.length - 1; i++) {
      var k = segs[i];
      if (!isPlainObject(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    cur[segs[segs.length - 1]] = value;
  }

  function deleteNode(doc, segs) {
    var cur = doc;
    for (var i = 0; i < segs.length - 1; i++) {
      if (!isPlainObject(cur)) return;
      cur = cur[segs[i]];
    }
    if (isPlainObject(cur) || Array.isArray(cur)) delete cur[segs[segs.length - 1]];
  }

  /* The previous data layer pruned empty ancestors, and js/streak.js counts
     Object.keys(daily) — so leftover {} would corrupt streaks. */
  function prune(doc, segs) {
    var chain = [];
    var cur = doc;
    for (var i = 0; i < segs.length - 1; i++) {
      if (!isPlainObject(cur)) return;
      chain.push({ parent: cur, key: segs[i] });
      cur = cur[segs[i]];
    }
    for (var j = chain.length - 1; j >= 0; j--) {
      var node = chain[j].parent[chain[j].key];
      if (isPlainObject(node) && Object.keys(node).length === 0) {
        delete chain[j].parent[chain[j].key];
      } else {
        break;
      }
    }
  }

  /* ============================
     7. CURRENT-USER SUGAR
     ============================ */

  window.afcUid = function () {
    return window.AFC_SESSION ? window.AFC_SESSION.uid : null;
  };

  /* No-op without a uid: an admin session is not a user record, and
     cross-cutting writers (theme sync) must not create a junk user. */
  window.afcUserGet = function (sub) {
    var uid = afcUid();
    return uid ? afcDbGet("users/" + uid + (sub ? "/" + sub : "")) : Promise.resolve(null);
  };
  window.afcUserSet = function (sub, value) {
    var uid = afcUid();
    return uid ? afcDbSet("users/" + uid + (sub ? "/" + sub : ""), value) : Promise.resolve();
  };
  window.afcUserUpdate = function (sub, value) {
    var uid = afcUid();
    return uid ? afcDbUpdate("users/" + uid + (sub ? "/" + sub : ""), value) : Promise.resolve();
  };
  window.afcDailyPath = function (dateKey, sub) {
    return "daily/" + (dateKey || afcTodayKey()) + (sub ? "/" + sub : "");
  };
  window.afcDailyGet = function (sub, dateKey) {
    return afcUserGet(afcDailyPath(dateKey, sub));
  };
  window.afcDailySet = function (sub, value, dateKey) {
    return afcUserSet(afcDailyPath(dateKey, sub), value);
  };

  /* ============================
     8. PASSWORD HASHING
     ============================ */

  /* Salted SHA-256 where available. The synchronous fallback is weak
     obfuscation only — see the security note at the top of this file. */
  function weakHash(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      h1 = (h1 ^ str.charCodeAt(i)) >>> 0;
      h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
  }

  async function hashPassword(password, salt) {
    var input = salt + "::" + password;
    if (window.crypto && crypto.subtle && typeof crypto.subtle.digest === "function") {
      try {
        var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
        return Array.prototype.map
          .call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); })
          .join("");
      } catch (e) { /* fall through to weak hash */ }
    }
    return weakHash(input);
  }

  function newSalt() {
    var bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map
      .call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); })
      .join("");
  }

  function newUid() {
    return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function authError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function readAuth() {
    var raw = null;
    try { raw = localStorage.getItem(KEY_AUTH); } catch (e) { raw = null; }
    var doc = null;
    if (raw) { try { doc = JSON.parse(raw); } catch (e) { doc = null; } }
    if (!isPlainObject(doc)) doc = {};
    if (!isPlainObject(doc.byEmail)) doc.byEmail = {};
    if (!isPlainObject(doc.byUid)) doc.byUid = {};
    if (!isPlainObject(doc.throttle)) doc.throttle = {};
    return doc;
  }

  function writeAuth(doc) {
    try { localStorage.setItem(KEY_AUTH, JSON.stringify(doc)); }
    catch (e) { throw quotaError(e); }
  }

  /* ============================
     9. AUTH
     ============================ */

  var MAX_ATTEMPTS = 5;
  var THROTTLE_WINDOW_MS = 10 * 60 * 1000;

  function checkThrottle(auth, email) {
    var t = auth.throttle[email];
    if (!t) return;
    if (Date.now() - t.first > THROTTLE_WINDOW_MS) { delete auth.throttle[email]; return; }
    if (t.count >= MAX_ATTEMPTS) throw authError("auth/too-many-requests");
  }

  function recordFailure(auth, email) {
    var t = auth.throttle[email];
    if (!t || Date.now() - t.first > THROTTLE_WINDOW_MS) t = { first: Date.now(), count: 0 };
    t.count++;
    auth.throttle[email] = t;
  }

  function publicUser(record) {
    if (!record) return null;
    return {
      uid: record.uid,
      email: record.email || "",
      displayName: record.name || "",
      photoURL: record.photoURL || ""
    };
  }

  function trialFor(startDate, days) {
    var start = startDate || afcTodayKey();
    return { startDate: start, endDate: afcAddDays(start, days - 1), days: days };
  }

  function configuredTrialDays() {
    var settings = readDoc(COLLECTIONS.settings);
    var n = Number(settings && settings.trialDays);
    return n > 0 ? n : 7;
  }

  window.afcSignUp = async function (name, email, password, extra) {
    await window.afcBootstrap();
    var cleanName = String(name || "").trim();
    var cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanName) throw authError("auth/invalid-name", "Please enter your name.");
    if (!afcValidEmail(cleanEmail)) throw authError("auth/invalid-email");
    if (String(password || "").length < 6) throw authError("auth/weak-password");

    var auth = readAuth();
    if (auth.byEmail[cleanEmail]) throw authError("auth/email-already-in-use");

    var uid = newUid();
    var salt = newSalt();
    var hash = await hashPassword(password, salt);
    var now = Date.now();
    var days = configuredTrialDays();

    var record = {
      uid: uid,
      name: cleanName,
      email: cleanEmail,
      photoURL: (extra && extra.photoURL) || "",
      role: "user",
      createdAt: now,
      lastLogin: now,
      /* Spec name; requireAuth reads this flag. */
      onboardingCompleted: false,
      settings: { theme: afcCurrentTheme ? afcCurrentTheme() : "dark" },
      trial: trialFor(afcTodayKey(), days),
      trialStartDate: afcTodayKey(),
      trialEndDate: afcAddDays(afcTodayKey(), days - 1)
    };
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== "photoURL") record[k] = extra[k]; });

    /* Write the record through the engine so images externalize. */
    dropCache(COLLECTIONS.users);
    await afcDbSet("users/" + uid, record);

    auth.byEmail[cleanEmail] = uid;
    auth.byUid[uid] = { email: cleanEmail, salt: salt, hash: hash };
    writeAuth(auth);

    setSession(uid);
    return { user: publicUser(await afcDbGet("users/" + uid)), isNew: true };
  };

  window.afcSignIn = async function (email, password) {
    await window.afcBootstrap();
    var cleanEmail = String(email || "").trim().toLowerCase();
    if (!afcValidEmail(cleanEmail)) throw authError("auth/invalid-email");

    var auth = readAuth();
    checkThrottle(auth, cleanEmail);

    var uid = auth.byEmail[cleanEmail];
    if (!uid) throw authError("auth/user-not-found");
    var cred = auth.byUid[uid];
    if (!cred) throw authError("auth/user-not-found");

    var hash = await hashPassword(String(password || ""), cred.salt);
    if (hash !== cred.hash) {
      recordFailure(auth, cleanEmail);
      writeAuth(auth);
      throw authError("auth/wrong-password");
    }
    delete auth.throttle[cleanEmail];
    writeAuth(auth);

    await afcDbUpdate("users/" + uid, { lastLogin: Date.now() });
    setSession(uid);
    return { user: publicUser(await afcDbGet("users/" + uid)), isNew: false };
  };

  window.afcSignOut = async function () {
    try { localStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
    notifyAuth();
  };

  window.afcGetCurrentUser = async function () {
    var raw = null;
    try { raw = localStorage.getItem(KEY_SESSION); } catch (e) { return null; }
    if (!raw) return null;
    var uid = null;
    try { uid = JSON.parse(raw); } catch (e) { uid = null; }
    if (!uid || typeof uid !== "string") return null;
    var record = await afcDbGet("users/" + uid);
    if (!record) {
      /* Account was deleted — clear the stale session. */
      try { localStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
      return null;
    }
    return publicUser(record);
  };

  /* Change password for the signed-in user (Settings page). */
  window.afcChangePassword = async function (currentPassword, newPassword) {
    var user = await afcGetCurrentUser();
    if (!user) throw authError("auth/requires-recent-login");
    if (String(newPassword || "").length < 6) throw authError("auth/weak-password");
    var auth = readAuth();
    var cred = auth.byUid[user.uid];
    if (!cred) throw authError("auth/user-not-found");
    var current = await hashPassword(String(currentPassword || ""), cred.salt);
    if (current !== cred.hash) throw authError("auth/wrong-password");
    var salt = newSalt();
    auth.byUid[user.uid] = { email: cred.email, salt: salt, hash: await hashPassword(newPassword, salt) };
    writeAuth(auth);
    return true;
  };

  /* Delete the account, its credentials and its image blobs. */
  window.afcDeleteAccount = async function (uid) {
    var target = uid || (await afcGetCurrentUser() || {}).uid;
    if (!target) return false;
    var record = await afcDbGet("users/" + target);
    var tokens = {};
    collectTokens(record, tokens);

    await afcDbRemove("users/" + target);

    var auth = readAuth();
    var cred = auth.byUid[target];
    if (cred) {
      delete auth.byEmail[cred.email];
      delete auth.throttle[cred.email];
      delete auth.byUid[target];
    }
    writeAuth(auth);

    Object.keys(tokens).forEach(function (id) {
      try { localStorage.removeItem(IMG_PREFIX + id); } catch (e) { /* ignore */ }
    });

    var session = null;
    try { session = localStorage.getItem(KEY_SESSION); } catch (e) { session = null; }
    if (session === JSON.stringify(target)) {
      try { localStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
      notifyAuth();
    }
    return true;
  };

  function setSession(uid) {
    try { localStorage.setItem(KEY_SESSION, JSON.stringify(uid)); }
    catch (e) { throw quotaError(e); }
    notifyAuth();
  }

  /* ---- auth state listeners ---- */
  var authSubs = [];
  function notifyAuth() {
    var snapshot = authSubs.slice();
    setTimeout(async function () {
      var user = await window.afcGetCurrentUser();
      snapshot.forEach(function (cb) {
        try { cb(user); } catch (e) { console.error(e); }
      });
    }, 0);
  }
  window.afcOnAuthStateChanged = async function (cb) {
    authSubs.push(cb);
    var user = await window.afcGetCurrentUser();
    setTimeout(function () { try { cb(user); } catch (e) { console.error(e); } }, 0);
    return function () {
      var i = authSubs.indexOf(cb);
      if (i >= 0) authSubs.splice(i, 1);
    };
  };

  /* ============================
     10. ADMIN SESSION
     ============================ */

  /* Independent from afc_current_user so an admin session never
     interferes with a normal user login, and vice versa. */
  window.afcGetAdminSession = function () {
    var raw = null;
    try { raw = localStorage.getItem(KEY_ADMIN_SESSION); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      return s && s.currentAdmin === true ? s : null;
    } catch (e) { return null; }
  };

  window.afcSetAdminSession = function (email) {
    try {
      localStorage.setItem(KEY_ADMIN_SESSION, JSON.stringify({
        email: email, currentAdmin: true, since: Date.now()
      }));
    } catch (e) { throw quotaError(e); }
  };

  window.afcClearAdminSession = function () {
    try { localStorage.removeItem(KEY_ADMIN_SESSION); } catch (e) { /* ignore */ }
  };

  /* ============================
     11. IMAGE UPLOAD
     ============================ */

  /* Downscale + re-encode so a phone photo lands around 60-150KB
     instead of several MB. Always JPEG: transparency is irrelevant
     for photos and PNG would blow the quota. */
  window.afcCompressImage = function (file, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || 960;
    var quality = opts.quality || 0.72;
    return new Promise(function (resolve, reject) {
      var url = null;
      try { url = URL.createObjectURL(file); }
      catch (e) { reject(new Error("Could not read that file.")); return; }

      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error("That image could not be read.")); return; }
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(new Error("Could not process that image."));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("That file is not a readable image."));
      };
      img.src = url;
    });
  };

  /* Returns a data URL. The engine externalizes it into afc_img_*
     when the caller saves it, so pages can also use it directly as
     an <img src> before saving. */
  window.afcUpload = async function (storagePath, file, onProgress) {
    if (onProgress) onProgress(10);
    var dataUrl = await window.afcCompressImage(file);
    if (onProgress) onProgress(60);
    /* Probe the quota early so the failure surfaces at upload time
       rather than later, mid-save. */
    var probeKey = IMG_PREFIX + "probe";
    try {
      localStorage.setItem(probeKey, dataUrl);
      localStorage.removeItem(probeKey);
    } catch (e) {
      throw quotaError(e);
    }
    if (onProgress) onProgress(100);
    return dataUrl;
  };

  window.afcPickImage = function () {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.onchange = function () {
        resolve(input.files && input.files[0] ? input.files[0] : null);
      };
      input.click();
    });
  };

  /* ============================
     12. NAMED COLLECTION HELPERS
     ============================ */

  /* Zero-state aliases over the same engine, so the named API and
     the path API can never drift apart. */
  function reader(path) { return function () { return afcDbGet(path); }; }
  function writer(path) { return function (v) { return afcDbSet(path, v); }; }

  var HELPERS = {
    getUsers: reader("users"),
    saveUsers: writer("users"),
    getCurrentUser: function () { return afcGetCurrentUser(); },
    saveCurrentUser: function (uid) { setSession(uid); return Promise.resolve(); },
    getUser: function (uid) { return afcDbGet("users/" + uid); },
    updateUser: function (uid, patch) { return afcDbUpdate("users/" + uid, patch); },
    deleteUser: function (uid) { return afcDeleteAccount(uid); },

    getExercises: reader("exercises"),
    saveExercises: writer("exercises"),
    getWorkouts: reader("workouts"),
    saveWorkouts: writer("workouts"),
    getWeeklyPlans: reader("weeklyPlans"),
    saveWeeklyPlans: writer("weeklyPlans"),
    getDietPlans: reader("dietPlans"),
    saveDietPlans: writer("dietPlans"),
    getMeals: reader("meals"),
    saveMeals: writer("meals"),
    getGoals: reader("goals"),
    saveGoals: writer("goals"),
    getSubscriptionPlans: reader("pricing"),
    saveSubscriptionPlans: writer("pricing"),
    getSettings: reader("settings"),
    saveSettings: writer("settings"),
    getAppSettings: reader("settings"),
    getMedia: reader("media"),
    saveMedia: writer("media"),
    getChatbotData: reader("chatbot"),
    saveChatbotData: writer("chatbot"),
    getBeforeAfterGallery: reader("adminGallery"),
    saveBeforeAfterGallery: writer("adminGallery"),
    getBeforeAfter: function (uid) {
      return afcDbGet("users/" + (uid || afcUid()) + "/beforeAfter");
    }
  };

  Object.keys(HELPERS).forEach(function (name) { window[name] = HELPERS[name]; });

  /* ============================
     13. BOOTSTRAP / SEED
     ============================ */

  var bootstrapPromise = null;

  /* Collections whose shape and tagging are owned by the code, not by
     the administrator. These are refreshed when AFC_LIBRARY_VERSION
     moves on; settings, chatbot rules and media are left alone because
     those are the admin's own edits. */
  var AFC_LIBRARY_COLLECTIONS = ["goals", "exercises", "workouts", "meals", "dietPlans", "weeklyPlans", "pricing"];

  /* Seeds demo content on first run only. Never creates users, so
     admin statistics always reflect real registrations. */
  window.afcBootstrap = function () {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async function () {
      var seeded = null;
      var libVersion = 0;
      try {
        seeded = localStorage.getItem(KEY_SEEDED);
        libVersion = Number(localStorage.getItem(KEY_LIB_VERSION)) || 0;
      } catch (e) { seeded = null; }

      if (typeof window.afcSeedDemoData !== "function") {
        /* demo-data.js not loaded on this page; try again next page. */
        bootstrapPromise = null;
        return { seeded: false };
      }

      var currentLib = Number(window.AFC_LIBRARY_VERSION) || 1;

      try {
        if (!seeded) {
          await window.afcSeedDemoData();
          try {
            localStorage.setItem(KEY_SEEDED, String(Date.now()));
            localStorage.setItem(KEY_LIB_VERSION, String(currentLib));
          } catch (e) { /* ignore */ }
          return { seeded: true };
        }

        if (libVersion < currentLib) {
          await window.afcSeedDemoData(null, AFC_LIBRARY_COLLECTIONS);
          try { localStorage.setItem(KEY_LIB_VERSION, String(currentLib)); } catch (e) { /* ignore */ }
          AFC_LIBRARY_COLLECTIONS.forEach(function (name) {
            if (COLLECTIONS[name]) dropCache(COLLECTIONS[name]);
          });
          return { seeded: false, upgraded: libVersion + " -> " + currentLib };
        }

        return { seeded: false };
      } catch (e) {
        bootstrapPromise = null;
        console.error("[AFC] Demo seed failed.", e);
        return { seeded: false, error: e };
      }
    })();
    return bootstrapPromise;
  };

  /* Re-run the seed deliberately (Admin -> Settings -> Reset demo data). */
  window.afcReseed = async function (onStep) {
    if (typeof window.afcSeedDemoData !== "function") {
      throw new Error("Demo data is not available on this page.");
    }
    await window.afcSeedDemoData(onStep);
    try {
      localStorage.setItem(KEY_SEEDED, String(Date.now()));
      localStorage.setItem(KEY_LIB_VERSION, String(Number(window.AFC_LIBRARY_VERSION) || 1));
    } catch (e) { /* ignore */ }
    Object.values(COLLECTIONS).forEach(dropCache);
    return true;
  };

  /* Storage footprint, for the admin/settings diagnostics. */
  window.afcStorageStats = function () {
    var total = 0, images = 0, count = 0, imageCount = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k === null) continue;
        var size = (localStorage.getItem(k) || "").length + k.length;
        total += size; count++;
        if (k.indexOf(IMG_PREFIX) === 0) { images += size; imageCount++; }
      }
    } catch (e) { /* ignore */ }
    return {
      bytes: total * 2, /* UTF-16 */
      kb: Math.round((total * 2) / 1024),
      keys: count,
      imageBytes: images * 2,
      imageKb: Math.round((images * 2) / 1024),
      imageCount: imageCount
    };
  };

  window.AFC_STORAGE_KEYS = COLLECTIONS;
  window.AFC_STORAGE_READY = true;
})();
