/* ============================================================
   AI FITNESS COACH — WEEKLY PLAN
   ============================================================ */
(async function () {
  var session;
  try { session = await requireAuth(); } catch (e) { return; }
  afcMountLayout("weekly");

  var DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var DAY_LABELS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  var todayKey = afcTodayKey();
  var todayDayName = new Date(todayKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  var userProfile = afcNormalizeUserProfile(session.profile || session);
  var subscription = await afcUserGet("subscription") || {};
  var durationWeeks = (subscription.planId === "weekly-plan" || /weekly/i.test(subscription.planName || ""))
    ? Math.max(1, Math.min(4, Number(subscription.durationWeeks) || 1))
    : 4;
  var subscriptionExpired = subscription.status === "active" &&
    subscription.endDate && afcTodayKey() > subscription.endDate;
  var selectedPlan = null;
  function goalLabel(key) {
    for (var i = 0; i < (window.AFC_GOALS || []).length; i++) {
      if (window.AFC_GOALS[i].key === key) return window.AFC_GOALS[i].label;
    }
    return key;
  }

  var mealsDb = {};
  var exercisesDb = {};
  var workoutsDb = {};
  var dietPlansDb = {};
  var waterGoal = 8;
  try {
    var mAll = await afcDbGet("meals");
    if (mAll) mealsDb = mAll;
  } catch (e) { /* non-fatal */ }
  try {
    exercisesDb = await afcDbGet("exercises") || {};
  } catch (e) { /* non-fatal */ }
  try {
    workoutsDb = await afcDbGet("workouts") || {};
    dietPlansDb = await afcDbGet("dietPlans") || {};
    waterGoal = Number(await afcDbGet("settings/waterGoal")) || 8;
  } catch (e) { /* non-fatal */ }

  /* ---------- State ---------- */
  var currentWeek = 1;
  try {
    var cw = await afcUserGet("plan/currentWeek");
    if (cw) currentWeek = Number(cw);
  } catch (e) { /* default */ }
  currentWeek = Math.max(1, Math.min(durationWeeks, currentWeek));

  /* ---------- Week tabs ---------- */
  var tabsEl = qs("#weekTabs");
  function renderTabs() {
    if (!tabsEl) return;
    var html = "";
    for (var i = 1; i <= durationWeeks; i++) {
      html += '<button class="week-tab' + (i === currentWeek ? " active" : "") + '" data-week="' + i + '" role="tab" aria-selected="' + (i === currentWeek) + '">WEEK ' + i + '</button>';
    }
    tabsEl.innerHTML = html;
    tabsEl.querySelectorAll(".week-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var w = Number(btn.dataset.week);
        if (w === currentWeek) return;
        currentWeek = w;
        renderTabs();
        afcUserSet("plan/currentWeek", w).catch(function () {});
      });
    });
  }
  renderTabs();

  /* ---------- Render week ---------- */
  var bodyEl = qs("#weekBody");
  var startWrap = qs("#startTodayWrap");
  var startBtn = qs("#startTodayBtn");

  function choosePlan(plans) {
    var exact = Object.keys(plans || {}).some(function (key) {
      var plan = plans[key];
      return plan && plan.active !== false && plan.weeks &&
        afcNormalizeGoal(plan.goal) === userProfile.goal &&
        afcNormalizeLevel(plan.level) === userProfile.level &&
        (plan.gender === "all" || plan.gender === userProfile.gender);
    });
    return exact ? afcSelectWeeklyPlan(plans, userProfile) : buildPersonalizedPlan();
  }

  function buildPersonalizedPlan() {
    var workouts = Object.keys(workoutsDb).map(function (key) {
      var workout = workoutsDb[key];
      if (!workout || workout.active === false || afcNormalizeGoal(workout.goal) !== userProfile.goal) return null;
      return workout;
    }).filter(Boolean);
    workouts.sort(function (a, b) {
      return (a.level === userProfile.level ? -1 : 1) - (b.level === userProfile.level ? -1 : 1);
    });
    if (!workouts.length) return null;

    var diet = Object.keys(dietPlansDb).map(function (key) { return dietPlansDb[key]; }).filter(function (plan) {
      return plan && plan.active !== false && afcNormalizeGoal(plan.goal) === userProfile.goal;
    })[0] || null;
    var weeks = {};
    for (var week = 0; week < 4; week++) {
      var days = {};
      for (var day = 0; day < 7; day++) {
        var rest = day === 2 || day === 6;
        var workout = rest ? null : workouts[(week + day) % workouts.length];
        days[DAY_NAMES[day]] = {
          restDay: rest,
          notes: rest ? "Recovery day: hydrate, stretch and sleep well." : "Warm up, then complete each exercise in order.",
          workout: workout ? {
            key: workout.key,
            name: workout.name,
            duration: workout.duration,
            exercises: (workout.exercises || []).map(function (key) { return exercisesDb[key] ? exercisesDb[key].name : key; }),
            exerciseKeys: (workout.exercises || []).slice()
          } : null,
          diet: diet ? {
            planKey: diet.key,
            planName: diet.name,
            breakfast: afcPickMealForPlan(diet, "breakfast", week, day),
            lunch: afcPickMealForPlan(diet, "lunch", week, day),
            snack: afcPickMealForPlan(diet, "snack", week, day),
            dinner: afcPickMealForPlan(diet, "dinner", week, day)
          } : null
        };
      }
      weeks["week" + (week + 1)] = days;
    }
    return { name: "Personalized " + userProfile.goal + " Plan", goal: userProfile.goal, level: userProfile.level, weeks: weeks, active: true };
  }

  function afcPickMealForPlan(plan, category, week, day) {
    var options = plan.slots && plan.slots[category] || [];
    return options.length ? options[(week + day) % options.length] : null;
  }

  async function saveActivePlan() {
    if (!selectedPlan) return;
    var start = afcTodayKey();
    var end = afcAddDays(start, durationWeeks * 7 - 1);
    await afcUserSet("plan/active", {
      type: "weekly",
      durationWeeks: durationWeeks,
      startDate: start,
      endDate: end,
      goal: userProfile.goal,
      fitnessLevel: userProfile.level,
      generatedPlan: selectedPlan
    });
  }

  function renderWeek(plans) {
    if (!bodyEl) return;

    if (subscriptionExpired) {
      bodyEl.innerHTML = '<div class="empty-state"><i class="bi bi-calendar-x" aria-hidden="true"></i>' +
        '<p>Your plan has expired.</p><a href="subscription.html" class="btn btn-fire mt-3">RENEW PLAN</a></div>';
      if (startWrap) startWrap.style.display = "none";
      return;
    }

    if (!plans) {
      bodyEl.innerHTML = '<div class="empty-state"><i class="bi bi-calendar-x" aria-hidden="true"></i><p>No weekly plans available yet.</p></div>';
      if (startWrap) startWrap.style.display = "none";
      return;
    }

    if (!selectedPlan) selectedPlan = choosePlan(plans);
    var weekData = selectedPlan && selectedPlan.weeks["week" + currentWeek];
    if (!weekData) {
      bodyEl.innerHTML = '<div class="empty-state"><i class="bi bi-calendar-x" aria-hidden="true"></i><p>No personalized plan for your goal and level is available yet.</p></div>';
      if (startWrap) startWrap.style.display = "none";
      return;
    }

    var html = '<div class="row g-3">';
    var todayWorkoutKey = null;

    DAY_NAMES.forEach(function (day, idx) {
      var d = weekData[day];
      if (!d) return;

      var isRest = !!d.restDay;
      var isToday = day === todayDayName;
      var workoutHtml = "";
      var dietHtml = "";

      if (isRest) {
        workoutHtml = '<span class="chip blue"><i class="bi bi-moon-stars-fill me-1" aria-hidden="true"></i>REST DAY</span>';
      } else if (d.workout) {
        if (isToday) todayWorkoutKey = d.workout.key;
        var exerciseDetails = (d.workout.exerciseKeys || []).map(function (key) {
          var exercise = exercisesDb[key] || {};
          var name = exercise.name || key;
          var dosage = exercise.duration
            ? exercise.duration + " min"
            : ((exercise.sets || 0) + " sets &middot; " + (exercise.reps || 0) + " reps");
          var media = exercise.video || exercise.animeVideo;
          return '<div class="small mb-1"><strong>' + afcEscape(name) + '</strong> <span class="text-muted-2">(' + dosage + ')</span>' +
            (media ? ' <a href="' + afcEscape(media) + '" target="_blank" rel="noopener">VIDEO</a>' : '') + '</div>';
        }).join("");
        workoutHtml = '<div class="mt-1">' + exerciseDetails + '</div>';
      }

      /* Diet block */
      if (d.diet) {
        var cats = ["breakfast", "lunch", "snack", "dinner"];
        var lines = cats.map(function (cat) {
          var mk = d.diet[cat];
          var meal = mk && mealsDb[mk] ? mealsDb[mk] : null;
          var name = meal ? meal.name : (mk || "—");
          var cal = meal ? meal.calories : "";
          return '<div class="small"><strong>' + cat.charAt(0).toUpperCase() + cat.slice(1) + ':</strong> ' +
            afcEscape(name) + (cal ? ' <span class="text-muted-2">(' + cal + ' kcal)</span>' : '') + '</div>';
        }).join("");
        dietHtml = '<div class="mt-2">' + lines + '</div>';
      }

      html += '<div class="col-12 col-md-6 col-xl-4">' +
        '<div class="tile tile-pad day-card' + (isRest ? " rest" : "") + '">' +
        '<div class="d-flex align-items-center justify-content-between mb-2">' +
        '<span class="day-name">' + afcEscape(DAY_LABELS[idx]) + '</span>' +
        (isToday ? '<span class="chip fire">TODAY</span>' : '') +
        '</div>' +
        workoutHtml + dietHtml +
        '<div class="small text-muted-2 mt-2"><strong>Water:</strong> ' + waterGoal + ' glasses</div>' +
        (d.notes ? '<div class="small text-muted-2 mt-2 fst-italic">' + afcEscape(d.notes) + '</div>' : '') +
        '</div></div>';
    });

    html += '</div>';
    bodyEl.innerHTML = '<div class="tile tile-pad mb-3">' +
      '<h2 class="section-title mb-1">' + afcEscape(selectedPlan.name || "MY FITNESS PLAN") + '</h2>' +
      '<p class="text-muted-2 mb-0">Goal: ' + afcEscape(goalLabel(userProfile.goal)) + ' &middot; Level: ' + afcEscape(userProfile.level) +
      ' &middot; Duration: ' + durationWeeks + ' week' + (durationWeeks === 1 ? "" : "s") + '</p></div>' + html;
    saveActivePlan().catch(function () { afcToast("Could not save the active plan.", "error"); });

    /* Start today button */
    if (startWrap && startBtn) {
      if (todayWorkoutKey) {
        startWrap.style.display = "";
        startBtn.href = "workout.html?w=" + encodeURIComponent(todayWorkoutKey);
      } else {
        startWrap.style.display = "none";
      }
    }
  }

  /* ---------- Realtime listener ---------- */
  var unsubPlans = null;
  try {
    unsubPlans = await afcDbOnValue("weeklyPlans", function (data) {
      selectedPlan = selectedPlan || choosePlan(data || {});
      renderWeek(data);
    });
  } catch (e) {
    /* Fallback: load once */
    try {
      var wp = await afcDbGet("weeklyPlans");
      renderWeek(wp);
    } catch (e2) {
      if (bodyEl) bodyEl.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><p>Could not load weekly plans.</p></div>';
    }
  }

  window.addEventListener("pagehide", function () {
    if (unsubPlans) unsubPlans();
  });

})();
