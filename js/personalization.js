/* ============================================================
   AI FITNESS COACH — PERSONALIZATION ENGINE

   One entry point, getPersonalizedContent(user), used by the
   dashboard, workouts, exercises, diet, weekly plan and the workout
   player. Every page asks this file for content instead of filtering
   on its own, so a profile change refreshes the whole app the same
   way everywhere and no two pages can disagree.

   Selection combines gender + goal + fitness level + age + weight +
   height + target weight. Gender alone never decides anything: it is
   the heaviest single factor, but goal and level carry real weight
   too, and "all"-tagged content is always available as a fallback.

   Priority, highest first:
     1. exact gender      2. exact goal
     3. exact level       4. related goal / adjacent level
     5. general + all fallback

   Depends on: utils.js, storage.js
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- profile normalization ---------------- */

  /* Body stats live under users/{uid}/profile, while older builds put
     goal and fitnessLevel on the record root. Read both so existing
     accounts keep working and there is only one shape downstream. */
  function firstValue() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }

  window.afcNormalizeUserProfile = function (record) {
    record = record || {};
    var p = record.profile || {};

    var genderRaw = firstValue(p.gender, record.gender);
    var goalRaw = firstValue(p.goal, record.goal);
    var levelRaw = firstValue(p.fitnessLevel, record.fitnessLevel, p.level, record.level);

    /* A missing gender falls back to "other" rather than "all": the
       inclusive library is written for exactly that case, and it keeps
       male- or female-only content from dominating by accident. */
    var gender = genderRaw ? afcNormalizeGender(genderRaw) : "other";
    var goal = goalRaw ? afcNormalizeGoal(goalRaw) : "general";
    /* A missing level falls back to beginner so a new account is never
       handed advanced work. */
    var level = levelRaw ? afcNormalizeLevel(levelRaw) : "beginner";
    if (level === "all") level = "beginner";

    var height = num(p.height);
    var weight = num(p.weight);
    var targetWeight = num(p.targetWeight);
    var age = num(p.age);
    var bmi = afcCalcBMI(height, weight);

    return {
      uid: record.uid || null,
      name: record.name || record.displayName || "",
      email: record.email || "",
      photoURL: record.photoURL || "",
      createdAt: record.createdAt || null,
      onboardingCompleted: !!record.onboardingCompleted,
      gender: gender,
      goal: goal,
      level: level,
      activityLevel: afcNormalizeActivity(p.activityLevel),
      age: age,
      height: height,
      weight: weight,
      targetWeight: targetWeight,
      bmi: bmi,
      bmiCategory: bmi ? afcBMICategory(bmi).label : "",
      beforeImage: firstValue(p.beforeImage, (record.beforeAfter || {}).before && record.beforeAfter.before.url) || "",
      afterImage: firstValue(p.afterImage, (record.beforeAfter || {}).after && record.beforeAfter.after.url) || "",
      /* How far the target is from now, in kg and as a percentage.
         Negative means losing, positive means gaining. */
      weightDelta: (targetWeight && weight) ? Math.round((targetWeight - weight) * 10) / 10 : null,
      weightDeltaPct: (targetWeight && weight) ? Math.round(((targetWeight - weight) / weight) * 1000) / 10 : null
    };
  };

  /* ---------------- scoring ---------------- */

  /* Which goals are useful neighbours. Lets a strength-seeker see
     muscle-building work before unrelated cardio, without ever
     hiding content when the library is thin. */
  var AFC_GOAL_AFFINITY = {
    "weight-loss": { "fat-loss": 2, "fitness": 1, "endurance": 1 },
    "gain-muscle": { "strength": 2, "fitness": 1 },
    "strength":    { "gain-muscle": 2, "fitness": 1 },
    "fat-loss":    { "weight-loss": 2, "endurance": 1, "fitness": 1 },
    "fitness":     { "endurance": 2, "weight-loss": 1, "gain-muscle": 1, "strength": 1, "fat-loss": 1 },
    "endurance":   { "fitness": 2, "fat-loss": 1, "weight-loss": 1 },
    "general":     { "fitness": 2, "weight-loss": 1, "fat-loss": 1 }
  };
  var AFC_LEVEL_ORDER = { beginner: 0, intermediate: 1, advanced: 2 };
  /* Mismatched-gender items are pushed below everything else instead
     of being dropped, so a thin library still fills the screen. */
  var AFC_GENDER_MISMATCH = -40;

  /* Returns a number; higher is a better fit for this profile. */
  window.afcScoreTagged = function (item, profile) {
    if (!item) return AFC_GENDER_MISMATCH * 2;
    var g = afcNormalizeGender(item.gender);
    var goal = afcNormalizeGoal(item.goal);
    var lv = afcNormalizeLevel(item.level);
    var score = 0;

    /* 1. gender */
    if (g === "all") score += 3;
    else if (g === profile.gender) score += 12;
    else score += AFC_GENDER_MISMATCH;

    /* 2. goal */
    if (goal === profile.goal) score += 8;
    else if (goal === "general") score += 2;
    else {
      var aff = AFC_GOAL_AFFINITY[profile.goal] || {};
      score += aff[goal] || 0;
    }

    /* 3. level */
    if (lv === "all") score += 2;
    else if (lv === profile.level) score += 5;
    else {
      var d = Math.abs((AFC_LEVEL_ORDER[lv] || 0) - (AFC_LEVEL_ORDER[profile.level] || 0));
      score += d === 1 ? 1 : -4;
    }

    /* 4. body requirements: never hand heavy work to someone far from
          their target, and nudge cardio up when weight loss is the aim. */
    if (profile.weightDeltaPct != null) {
      if (profile.weightDeltaPct <= -8 && (goal === "gain-muscle" || goal === "strength")) score -= 2;
      if (profile.weightDeltaPct >= 8 && (goal === "fat-loss" || goal === "weight-loss")) score -= 2;
    }
    if (profile.age && profile.age >= 60 && lv === "advanced") score -= 3;
    if (profile.age && profile.age < 16 && lv === "advanced") score -= 3;

    return score;
  };

  /* Sorts a keyed collection into a personalized array.
     Returns [{key, data, score, genderMatch}] best-fit first. */
  window.afcPersonalizeList = function (collection, profile) {
    var entries = [];
    var keys = collection && typeof collection === "object" ? Object.keys(collection) : [];

    keys.forEach(function (k) {
      var data = collection[k];
      if (!data || data.active === false) return;
      var g = afcNormalizeGender(data.gender);
      entries.push({
        key: k,
        data: data,
        score: afcScoreTagged(data, profile),
        /* "all" counts as compatible: shared content is never wrong. */
        genderMatch: g === "all" || g === profile.gender
      });
    });

    entries.sort(function (a, b) {
      if (a.genderMatch !== b.genderMatch) return a.genderMatch ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return String(a.data.name || a.key).localeCompare(String(b.data.name || b.key));
    });
    return entries;
  };

  /* The "for you" filter. Strict by default: only content whose goal,
     level and gender all match the profile is returned. The ladder
     widens one step at a time and only when a step is genuinely empty,
     so goals are never silently mixed on screen. Every widening is
     reported through `tier` and `notice` so the page can say why. */
  var AFC_FILTER_LADDER = [
    { tier: "exact", test: function (g, goal, lv, p) { return goal === p.goal && lv === p.level; }, notice: "" },
    { tier: "goal-any-level", test: function (g, goal, lv, p) { return goal === p.goal && lv === "all"; }, notice: "No {level} {goal} content yet — showing every level for your goal." },
    { tier: "goal", test: function (g, goal, lv, p) { return goal === p.goal; }, notice: "No {level} {goal} content yet — showing {goal} at all levels." },
    { tier: "level", test: function (g, goal, lv, p) { return lv === p.level || lv === "all"; }, notice: "Nothing tagged {goal} yet — showing {level} work across goals." },
    { tier: "compatible", test: function () { return true; }, notice: "Nothing tagged {goal} yet — showing general content." },
    { tier: "all", test: function () { return true; }, notice: "Your library has no tagged content yet — showing everything." }
  ];

  /* Returns { items, tier, strict, notice }.
     items: [{key, data, score}] best-fit first.
     strict: true when the exact goal+level+gender tier was used. */
  window.afcFilterContent = function (collection, profile) {
    var entries = [];
    var keys = collection && typeof collection === "object" ? Object.keys(collection) : [];

    keys.forEach(function (k) {
      var data = collection[k];
      if (!data || data.active === false) return;
      var g = afcNormalizeGender(data.gender);
      entries.push({
        key: k,
        data: data,
        score: afcScoreTagged(data, profile),
        gender: g,
        goal: afcNormalizeGoal(data.goal),
        level: afcNormalizeLevel(data.level)
      });
    });

    /* Gender is a hard boundary at every rung: male-only work is never
       shown to a female profile, but "all"-tagged content always is. */
    var compatible = entries.filter(function (e) {
      return e.gender === "all" || e.gender === profile.gender;
    });
    var pool = compatible.length ? compatible : entries;

    for (var i = 0; i < AFC_FILTER_LADDER.length; i++) {
      var rung = AFC_FILTER_LADDER[i];
      /* The gender boundary already applied, so the last two rungs
         accept the whole pool. */
      var hits = pool.filter(function (e) {
        return rung.test(e.gender === "all", e.goal, e.level, profile);
      });
      if (hits.length) {
        hits.sort(function (a, b) {
          if (b.score !== a.score) return b.score - a.score;
          return String(a.data.name || a.key).localeCompare(String(b.data.name || b.key));
        });
        var notice = rung.notice
          .replace(/\{goal\}/g, afcGoalLabel(profile.goal))
          .replace(/\{level\}/g, afcLevelLabel(profile.level));
        return {
          items: hits,
          tier: rung.tier,
          strict: rung.tier === "exact",
          notice: notice,
          genderFiltered: compatible.length > 0,
          total: entries.length
        };
      }
    }
    return { items: [], tier: "empty", strict: false, notice: "", genderFiltered: false, total: 0 };
  };

  /* Convenience alias used where only the array is wanted. */
  window.afcPersonalizeMatches = function (collection, profile) {
    return afcFilterContent(collection, profile).items;
  };

  /* Best single plan out of a collection, or null. */
  window.afcPersonalizeBest = function (collection, profile) {
    var items = afcPersonalizeMatches(collection, profile);
    return items.length ? items[0] : null;
  };

  /* ---------------- media existence probing ---------------- */

  var mediaProbeCache = new Map();

  /* Resolves whether a URL can actually be loaded. Cached for the life
     of the page so re-renders never re-hit the network, and negative
     results are cached too — that is what stops the fallback chain
     from being slow once the owner has only added some of the files. */
  window.afcMediaExists = function (url) {
    var src = String(url || "").trim();
    if (!src) return Promise.resolve(false);
    if (/^(data|blob):/i.test(src)) return Promise.resolve(true);
    if (mediaProbeCache.has(src)) return Promise.resolve(mediaProbeCache.get(src));

    return new Promise(function (resolve) {
      var settled = false;
      var finish = function (ok) {
        if (settled) return;
        settled = true;
        mediaProbeCache.set(src, ok);
        resolve(ok);
      };
      var timer = setTimeout(function () { finish(false); }, 3000);

      /* HEAD keeps this cheap: exercise art is never downloaded twice. */
      fetch(src, { method: "HEAD", cache: "no-store" })
        .then(function (res) {
          clearTimeout(timer);
          finish(!!(res && res.ok));
        })
        .catch(function () {
          clearTimeout(timer);
          finish(false);
        });
    });
  };

  window.afcResetMediaCache = function () { mediaProbeCache.clear(); };

  function pickFromMap(map, key) {
    if (!map || typeof map !== "object") return "";
    return map[key] || map[key === "all" ? "general" : "all"] || "";
  }

  function extractYoutubeId(url) {
    var m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : "";
  }

  /* ---------------- exercise media fallback chain ----------------
     Never returns a broken player. Order:
       1 gender-specific anime video
       2 goal-specific video
       3 the exercise's own anime / normal video
       4 the exercise image (gender-specific first)
       5 a generated icon placeholder
     ------------------------------------------------------------- */
  window.afcResolveExerciseMedia = async function (exercise, profile, key) {
    var ex = exercise || {};
    var p = profile || { gender: "other", goal: "general" };
    var slug = key || ex.key || afcSlugify(ex.name);
    var userFolder = (p.gender === "male" || p.gender === "female") ? p.gender : "general";
    var exFolder = afcMediaFolder(ex.gender);

    var videoCandidates = [
      afcYoutubeEmbedUrl(ex.videoId),
      pickFromMap(ex.animeVideos, p.gender),
      "assets/videos/" + userFolder + "/" + slug + "-anime.mp4",
      pickFromMap(ex.videosByGoal, p.goal),
      "assets/videos/" + exFolder + "/" + slug + "-" + p.goal + ".mp4",
      ex.animeVideo,
      "assets/videos/" + exFolder + "/" + slug + "-anime.mp4",
      ex.video || ex.videoURL,
      "assets/videos/" + exFolder + "/" + slug + ".mp4"
    ];

    var seen = {};
    for (var i = 0; i < videoCandidates.length; i++) {
      var v = String(videoCandidates[i] || "").trim();
      if (!v || seen[v]) continue;
      seen[v] = true;
      /* Remote embeds and uploads are taken as-is: the owner put them
         there deliberately, and probing a YouTube URL with HEAD fails. */
      if (/^(data|blob):/i.test(v) || /^https?:\/\//i.test(v)) {
        return { kind: "video", src: v, youtubeId: extractYoutubeId(v), label: "Exercise video" };
      }
      if (await afcMediaExists(v)) {
        var isAnime = /-anime\.mp4$/i.test(v);
        return { kind: "video", src: v, youtubeId: "", label: isAnime ? "Anime video" : "Exercise video" };
      }
    }

    var imageCandidates = [
      pickFromMap(ex.images, p.gender),
      "assets/images/exercises/" + userFolder + "/" + slug + ".jpg",
      ex.image,
      "assets/images/exercises/" + exFolder + "/" + slug + ".jpg"
    ];
    seen = {};
    for (var j = 0; j < imageCandidates.length; j++) {
      var im = String(imageCandidates[j] || "").trim();
      if (!im || seen[im]) continue;
      seen[im] = true;
      if (/^(data|blob):/i.test(im) || /^https?:\/\//i.test(im)) {
        return { kind: "image", src: im, label: "Exercise photo" };
      }
      if (await afcMediaExists(im)) {
        return { kind: "image", src: im, label: "Exercise photo" };
      }
    }

    return {
      kind: "icon",
      src: "",
      icon: afcCategoryIcon(ex.category),
      label: "Illustration placeholder"
    };
  };

  /* Category artwork for cards and the player when no file exists yet.
     Reuses the existing .cat-* gradients so the fallback matches the
     rest of the design instead of looking broken. */
  window.afcCategoryIcon = function (category) {
    var c = String(category || "").toLowerCase();
    if (c.indexOf("core") >= 0) return "bi-bullseye";
    if (c.indexOf("chest") >= 0) return "bi-shield-fill";
    if (c.indexOf("back") >= 0) return "bi-arrow-up-circle-fill";
    if (c.indexOf("arm") >= 0 || c.indexOf("shoulder") >= 0) return "bi-hand-index-thumb-fill";
    if (c.indexOf("leg") >= 0) return "bi-signpost-2-fill";
    if (c.indexOf("glute") >= 0) return "bi-balloon-heart-fill";
    if (c.indexOf("cardio") >= 0) return "bi-heart-pulse-fill";
    return "bi-lightning-fill";
  };

  window.afcCategoryClass = function (category) {
    var c = String(category || "").toLowerCase();
    if (c.indexOf("core") >= 0) return "cat-core";
    if (c.indexOf("chest") >= 0) return "cat-chest";
    if (c.indexOf("back") >= 0) return "cat-back";
    if (c.indexOf("arm") >= 0 || c.indexOf("shoulder") >= 0) return "cat-arms";
    if (c.indexOf("leg") >= 0 || c.indexOf("glute") >= 0) return "cat-legs";
    if (c.indexOf("cardio") >= 0) return "cat-cardio";
    return "cat-fullbody";
  };

  /* Renders resolved media into a container. `mode` is "cover" for
     cards or "contain" for the player. */
  window.afcMediaHtml = function (media, alt, mode) {
    var fit = mode === "contain" ? "contain" : "cover";
    if (!media || media.kind === "icon" || !media.src) {
      return '<i class="bi ' + ((media && media.icon) || "bi-heart-pulse-fill") + '" aria-hidden="true"></i>';
    }
    if (media.kind === "video") {
      if (media.youtubeId) {
        return '<iframe src="https://www.youtube-nocookie.com/embed/' + afcEscape(media.youtubeId) + '" ' +
          'frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
          'allowfullscreen title="' + afcEscape(alt || "") + '" loading="lazy" style="width:100%;height:100%"></iframe>';
      }
      return '<video src="' + afcEscape(media.src) + '" autoplay loop muted playsinline ' +
        'style="width:100%;height:100%;object-fit:' + fit + '" title="' + afcEscape(alt || "") + '"></video>';
    }
    return '<img src="' + afcEscape(media.src) + '" alt="' + afcEscape(alt || "") + '" loading="lazy" ' +
      'style="width:100%;height:100%;object-fit:' + fit + '">';
  };

  /* ---------------- recommendations ---------------- */

  window.afcBuildRecommendations = function (profile, content) {
    var out = [];
    var goalLabel = afcGoalLabel(profile.goal);
    var levelLabel = afcLevelLabel(profile.level);

    out.push({
      icon: "bi-bullseye",
      title: "Your plan: " + goalLabel,
      body: "Tuned for a " + levelLabel.toLowerCase() + " level" +
        (profile.gender !== "other" ? " and " + afcGenderLabel(profile.gender).toLowerCase() + "-focused content" : " with inclusive content") + "."
    });

    if (profile.bmi) {
      out.push({
        icon: "bi-activity",
        title: "BMI " + profile.bmi + " — " + profile.bmiCategory,
        body: profile.bmi < 18.5
          ? "Focus on a calorie surplus with strength work three times a week."
          : profile.bmi < 25
            ? "You are in a healthy range. Keep the consistency and vary your training."
            : profile.bmi < 30
              ? "A moderate deficit plus three cardio sessions a week moves this fastest."
              : "Start with low-impact movement and build volume gradually."
      });
    }

    if (profile.weightDelta != null && profile.weightDelta !== 0) {
      var losing = profile.weightDelta < 0;
      out.push({
        icon: losing ? "bi-graph-down-arrow" : "bi-graph-up-arrow",
        title: (losing ? "Lose " : "Gain ") + Math.abs(profile.weightDelta) + " kg",
        body: losing
          ? "Aim for about 0.5 kg per week. That is a " + Math.abs(profile.weightDeltaPct || 0) + "% change — realistic in " + Math.max(1, Math.ceil(Math.abs(profile.weightDelta) / 0.5)) + " weeks."
          : "Aim for about 0.25-0.5 kg per month of lean mass. Expect roughly " + Math.max(1, Math.ceil(profile.weightDelta / 0.4)) + " months at a steady surplus."
      });
    }

    if (content && content.todayWorkout && !content.todayWorkout.restDay) {
      out.push({
        icon: "bi-lightning-fill",
        title: "Today: " + (content.todayWorkout.workout.name || "Training day"),
        body: (content.todayWorkout.workout.duration || 0) + " minutes, " +
          ((content.todayWorkout.workout.exerciseKeys || []).length) + " exercises. Warm up first."
      });
    } else if (content && content.todayWorkout && content.todayWorkout.restDay) {
      out.push({
        icon: "bi-moon-stars-fill",
        title: "Today is a rest day",
        body: "Hydrate, stretch and sleep. Recovery is where the adaptation happens."
      });
    }

    if (!profile.onboardingCompleted) {
      out.push({
        icon: "bi-person-plus-fill",
        title: "Finish your profile",
        body: "Add your target weight and photos so your plan can adapt to you."
      });
    }

    return out.slice(0, 5);
  };

  /* ---------------- today lookup ---------------- */

  var AFC_DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  window.afcDayName = function (dateKey) {
    var d = dateKey ? new Date(dateKey + "T00:00:00") : new Date();
    /* getDay() is 0=Sunday; the plan weeks start on Monday. */
    return AFC_DAY_NAMES[(d.getDay() + 6) % 7];
  };

  /* ---------------- the engine ---------------- */

  var cache = { key: null, promise: null };

  function readCollections() {
    return Promise.all([
      afcDbGet("exercises"), afcDbGet("workouts"), afcDbGet("weeklyPlans"),
      afcDbGet("dietPlans"), afcDbGet("meals"), afcDbGet("goals")
    ]).then(function (r) {
      return {
        exercises: r[0] || {}, workouts: r[1] || {}, weeklyPlans: r[2] || {},
        dietPlans: r[3] || {}, meals: r[4] || {}, goals: r[5] || {}
      };
    });
  }

  /* The strict ladder reports why it widened. Pages need that, so the
     filter result — not just the item list — is carried into content. */
  function filterMeta(res) {
    return { tier: res.tier, strict: res.strict, notice: res.notice, genderFiltered: res.genderFiltered, total: res.total };
  }

  function build(profile, lib, weekNum) {
    var exerciseFilter = afcFilterContent(lib.exercises, profile);
    var workoutFilter = afcFilterContent(lib.workouts, profile);
    var mealFilter = afcFilterContent(lib.meals, profile);
    var weeklyFilter = afcFilterContent(lib.weeklyPlans, profile);
    var dietFilter = afcFilterContent(lib.dietPlans, profile);

    var exercises = exerciseFilter.items;
    var workouts = workoutFilter.items;
    var weeklyEntry = weeklyFilter.items[0] || null;
    var dietEntry = dietFilter.items[0] || null;

    /* Legacy installs stored weeks at the top level; wrap on the fly so
       the page code only ever sees the new shape. */
    var weeklyPlans = lib.weeklyPlans;
    if (weeklyPlans && weeklyPlans.week1 && !weeklyPlans.week1.weeks) {
      weeklyPlans = {
        legacy: {
          key: "legacy", name: "Your Program", gender: "all", goal: "general",
          level: "all", description: "", weeks: lib.weeklyPlans, active: true
        }
      };
      weeklyEntry = { key: "legacy", data: weeklyPlans.legacy, score: 0 };
    }

    var weeks = (weeklyEntry && weeklyEntry.data && weeklyEntry.data.weeks) || {};
    var weekKeys = Object.keys(weeks).sort();
    var safeWeek = weekNum >= 1 && weekNum <= (weekKeys.length || 4) ? weekNum : 1;
    var weekKey = "week" + safeWeek;
    var week = weeks[weekKey] || weeks[weekKeys[0]] || null;
    var dayName = afcDayName();
    var todayWorkout = week ? (week[dayName] || null) : null;

    var dietPlan = dietEntry ? dietEntry.data : null;
    var todayDiet = (todayWorkout && todayWorkout.diet) ? todayWorkout.diet : null;
    if (!todayDiet && dietPlan && dietPlan.slots) {
      todayDiet = {
        planKey: dietPlan.key, planName: dietPlan.name,
        breakfast: (dietPlan.slots.breakfast || [])[0] || null,
        lunch: (dietPlan.slots.lunch || [])[0] || null,
        snack: (dietPlan.slots.snack || [])[0] || null,
        dinner: (dietPlan.slots.dinner || [])[0] || null
      };
    }

    var meals = mealFilter.items;

    var result = {
      profile: profile,
      weekNum: safeWeek,
      weekCount: weekKeys.length || 4,
      dayName: dayName,
      exercises: exercises,
      workouts: workouts,
      meals: meals,
      /* Why each list looks the way it does — the UI renders `notice`
         whenever `strict` is false so goals are never silently mixed. */
      filters: {
        exercises: filterMeta(exerciseFilter),
        workouts: filterMeta(workoutFilter),
        meals: filterMeta(mealFilter),
        weeklyPlan: filterMeta(weeklyFilter),
        dietPlan: filterMeta(dietFilter)
      },
      notice: exerciseFilter.notice || workoutFilter.notice || "",
      strict: exerciseFilter.strict && workoutFilter.strict,
      exerciseMap: lib.exercises,
      workoutMap: lib.workouts,
      mealMap: lib.meals,
      weeklyPlan: weeklyEntry ? weeklyEntry.data : null,
      weeklyPlanKey: weeklyEntry ? weeklyEntry.key : null,
      weeklyPlanTiers: weeklyFilter.tier,
      weeklyPlans: weeklyPlans,
      week: week,
      weekKey: weekKey,
      todayWorkout: todayWorkout,
      dietPlan: dietPlan,
      dietPlanKey: dietEntry ? dietEntry.key : null,
      dietPlans: lib.dietPlans,
      todayDiet: todayDiet,
      goals: lib.goals
    };
    result.recommendations = afcBuildRecommendations(profile, result);
    return result;
  }

  /*
   * getPersonalizedContent(user) -> Promise<content>
   *
   * `user` may be:
   *   - omitted / null  -> the signed-in user
   *   - a uid string    -> that user record (admin preview)
   *   - a user record   -> used directly
   *
   * opts.week overrides the week number for the weekly plan lookup.
   * opts.noCache forces a fresh read (call afcInvalidatePersonalization
   * after saving a profile instead).
   */
  window.getPersonalizedContent = async function (user, opts) {
    opts = opts || {};
    var record = user;

    if (!record) {
      var uid = window.AFC_SESSION && window.AFC_SESSION.uid;
      if (!uid) {
        var current = await afcGetCurrentUser();
        uid = current ? current.uid : null;
      }
      record = uid ? await afcDbGet("users/" + uid) : null;
    } else if (typeof record === "string") {
      record = await afcDbGet("users/" + record);
    }
    record = record || {};

    var profile = afcNormalizeUserProfile(record);

    var weekNum = Number(opts.week) || 0;
    if (!weekNum && record.plan && record.plan.currentWeek) weekNum = Number(record.plan.currentWeek) || 0;
    if (!weekNum) {
      try { weekNum = Number(await afcUserGet("plan/currentWeek")) || 1; } catch (e) { weekNum = 1; }
    }

    var cacheKey = (profile.uid || "anon") + "|" + weekNum;
    if (!opts.noCache && cache.promise && cache.key === cacheKey) return cache.promise;

    var promise = readCollections().then(function (lib) { return build(profile, lib, weekNum); });
    cache.key = cacheKey;
    cache.promise = promise;
    /* A failed read must not poison the cache for the rest of the page. */
    promise.catch(function () { if (cache.key === cacheKey) { cache.key = null; cache.promise = null; } });
    return promise;
  };

  /* Call after saving gender / goal / level / weight / height /
     targetWeight so every page re-derives content without a logout. */
  window.afcInvalidatePersonalization = function () {
    cache.key = null;
    cache.promise = null;
  };

  /* Convenience: exercise keys for the personalized top workout. */
  window.afcTodayExerciseKeys = function (content) {
    var tw = content && content.todayWorkout;
    if (!tw || !tw.workout) return [];
    return tw.workout.exerciseKeys || [];
  };

  /* Human sentence describing the current plan, used in headings. */
  window.afcPlanTitle = function (profile) {
    var genderWord = profile.gender === "male" ? "Male " : profile.gender === "female" ? "Female " : "";
    return "Your " + genderWord + afcGoalLabel(profile.goal) + " Plan";
  };

  window.AFC_PERSONALIZATION_READY = true;
})();
