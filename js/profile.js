/* ============================================================
   AI FITNESS COACH — PROFILE PAGE
   Displays user info, health stats; edit modal with photo upload.
   Depends on: utils.js, storage.js, app.js
   ============================================================ */

(async function () {
  var session;
  try { session = await requireAuth({ allowIncomplete: true }); } catch (e) { return; }
  afcMountLayout("profile");

  var mainEl = qs("#mainContent");

  /* Show skeleton while loading */
  mainEl.innerHTML = '<div class="mx-auto" style="max-width:720px">' +
    '<div class="d-flex align-items-center gap-3 mb-4"><div class="skeleton" style="width:96px;height:96px;border-radius:50%"></div>' +
    '<div><div class="skeleton mb-2" style="width:200px;height:24px"></div><div class="skeleton" style="width:160px;height:16px"></div></div></div>' +
    '<div class="row g-3"><div class="col-6 col-md-4"><div class="skeleton" style="height:100px"></div></div>' +
    '<div class="col-6 col-md-4"><div class="skeleton" style="height:100px"></div></div>' +
    '<div class="col-6 col-md-4"><div class="skeleton" style="height:100px"></div></div></div></div>';

  async function loadProfile() {
    try {
      var userData = await afcDbGet("users/" + session.uid);
      if (!userData) userData = {};
      var p = userData.profile || {};
      var goalKey = userData.goal || "";
      var fitLevel = userData.fitnessLevel || "";
      var health = userData.health || {};
      var bmiRecord = health.bmi;
      var bmiVal = bmiRecord && typeof bmiRecord === "object" ? bmiRecord.value : bmiRecord;
      var calTarget = health.calories ? health.calories.target : null;

      var name = userData.name || session.user.displayName || "";
      var email = userData.email || session.user.email || "";
      var photoURL = userData.photoURL || session.user.photoURL || "";

      var initials = (name[0] || "A").toUpperCase();
      var avatarHtml = photoURL
        ? '<img class="avatar-lg" src="' + afcEscape(photoURL) + '" alt="Profile photo">'
        : '<div class="avatar-lg d-grid place-items-center" style="background:var(--grad-fire);color:#fff;font-size:2rem;font-weight:900">' + afcEscape(initials) + '</div>';

      var goalLabels = {
        "weight-loss": "Lose Weight", "gain-muscle": "Gain Muscle", general: "Stay Healthy", fitness: "Improve Fitness",
        lose_weight: "Lose Weight", gain_muscle: "Gain Muscle", stay_healthy: "Stay Healthy", improve_fitness: "Improve Fitness"
      };
      var levelLabels = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

      var bmiDisplay = "—";
      var bmiCatChip = "";
      if (bmiVal) {
        bmiDisplay = String(bmiVal);
        var cat = afcBMICategory(bmiVal);
        bmiCatChip = ' <span class="chip ' + cat.cls + '">' + afcEscape(cat.label) + '</span>';
      }

      var tiles = [
        { label: "AGE", value: p.age || "—" },
        { label: "GENDER", value: formatGender(p.gender) },
        { label: "HEIGHT", value: p.height ? (p.heightUnit === "ft" ? (p.heightFt || "—") + " ft " + (p.heightIn || 0) + " in" : p.height + " cm") : "—" },
        { label: "WEIGHT", value: p.weight ? p.weight + " kg" : "—" },
        { label: "GOAL", value: goalLabels[goalKey] || "—" },
        { label: "FITNESS LEVEL", value: levelLabels[fitLevel] || "—" },
        { label: "BMI", value: bmiDisplay, extra: bmiCatChip },
        { label: "DAILY CALORIES", value: calTarget ? calTarget + " kcal" : "—" }
      ];

      var tilesHtml = '<div class="row g-3 mb-4">';
      tiles.forEach(function (t) {
        tilesHtml += '<div class="col-6 col-md-3"><div class="tile tile-pad text-center">' +
          '<div class="stat-label mb-1">' + afcEscape(t.label) + '</div>' +
          '<div class="stat-value" style="font-size:1.15rem">' + afcEscape(String(t.value)) + (t.extra || "") + '</div>' +
          '</div></div>';
      });
      tilesHtml += '</div>';

      var html = '<div class="mx-auto" style="max-width:720px">' +
        '<div class="d-flex align-items-center gap-3 mb-4 anim-fade-up">' +
        avatarHtml +
        '<div><h2 class="fw-bold mb-1">' + afcEscape(name) + '</h2>' +
        '<p class="text-muted-2 mb-0">' + afcEscape(email) + '</p></div></div>' +
        tilesHtml +
        '<div class="d-flex flex-wrap gap-3">' +
        '<button class="btn btn-fire" id="prof-edit"><i class="bi bi-pencil-square me-1"></i> EDIT PROFILE</button>' +
        '<a href="goal.html" class="btn btn-outline-fire"><i class="bi bi-bullseye me-1"></i> CHANGE GOAL</a>' +
        '<button class="btn btn-ghost" id="prof-reset"><i class="bi bi-arrow-counterclockwise me-1"></i> RESET DATA</button>' +
        '<button class="btn btn-ghost text-danger" id="prof-logout"><i class="bi bi-box-arrow-right me-1"></i> LOGOUT</button>' +
        '</div></div>';

      mainEl.innerHTML = html;
      bindProfileEvents(userData, p);
    } catch (err) {
      mainEl.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Could not load profile.</p></div>';
    }
  }

  function formatGender(g) {
    if (!g) return "—";
    if (g === "male") return "Male";
    if (g === "female") return "Female";
    return "Prefer not to say";
  }

  function bindProfileEvents(userData, p) {
    /* Edit Profile */
    var editBtn = qs("#prof-edit");
    if (editBtn) {
      editBtn.addEventListener("click", async function () {
        var result = await afcFormModal({
          title: "Edit Profile",
          okText: "Save Changes",
          fields: [
            { key: "name", label: "Full Name", type: "text", value: userData.name || "" },
            { key: "age", label: "Age", type: "number", value: p.age || "", min: 10, max: 100 },
            { key: "gender", label: "Gender", type: "select", value: p.gender || "", options: [
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Prefer not to say" }
            ]},
            { key: "heightUnit", label: "Height Unit", type: "select", value: p.heightUnit || "cm", options: [{ value: "cm", label: "CM" }, { value: "ft", label: "FT" }] },
            { key: "height", label: "Height (cm)", type: "number", value: p.height || "", min: 90, max: 250 },
            { key: "heightFt", label: "Height (feet, when FT)", type: "number", value: p.heightFt || "", min: 3, max: 8 },
            { key: "heightIn", label: "Height (inches, when FT)", type: "number", value: p.heightIn || "", min: 0, max: 11 },
            { key: "weight", label: "Weight (kg)", type: "number", value: p.weight || "", min: 25, max: 300 },
            { key: "activityLevel", label: "Activity Level", type: "select", value: p.activityLevel || "", options: [
              { value: "light", label: "Light Activity" },
              { value: "moderate", label: "Moderate Activity" },
              { value: "active", label: "Active" },
              { value: "very", label: "Very Active" }
            ]}
          ]
        });

        if (!result) return;

        afcLoader("Saving...");
        try {
          var updates = {};
          if (result.name !== undefined) updates.name = result.name;
          var profUpdate = {};
          if (result.age !== undefined) profUpdate.age = Number(result.age);
          if (result.gender !== undefined) profUpdate.gender = result.gender;
          if (result.height !== undefined) profUpdate.height = Number(result.height);
          if (result.heightUnit !== undefined) profUpdate.heightUnit = result.heightUnit;
          if (result.heightFt !== undefined) profUpdate.heightFt = Number(result.heightFt);
          if (result.heightIn !== undefined) profUpdate.heightIn = Number(result.heightIn);
          if (result.weight !== undefined) profUpdate.weight = Number(result.weight);
          if (result.activityLevel !== undefined) profUpdate.activityLevel = result.activityLevel;

          if (Object.keys(profUpdate).length) {
            if (profUpdate.heightUnit === "ft") {
              profUpdate.height = Math.round(((profUpdate.heightFt * 12) + profUpdate.heightIn) * 2.54 * 10) / 10;
            }
            await afcUserSet("profile", Object.assign({}, p, profUpdate));
            var updatedHeight = profUpdate.height || p.height;
            var updatedWeight = profUpdate.weight || p.weight;
            var updatedAge = profUpdate.age || p.age;
            var updatedGender = profUpdate.gender || p.gender;
            var updatedActivity = profUpdate.activityLevel || p.activityLevel;
            var updatedBmi = afcCalcBMI(updatedHeight, updatedWeight);
            var updatedCalories = afcCalcCalories({ age: updatedAge, gender: updatedGender, height: updatedHeight, weight: updatedWeight, activityLevel: updatedActivity });
            if (updatedBmi) await afcUserSet("health/bmi", { value: updatedBmi, category: afcBMICategory(updatedBmi).label, height: updatedHeight, weight: updatedWeight, date: afcTodayKey() });
            if (updatedCalories) await afcUserSet("health/calories", updatedCalories);
            await afcUserUpdate("", { bmi: updatedBmi, calories: updatedCalories });
          }
          if (updates.name) {
            await afcUserUpdate("", updates);
          }

          /* If weight changed, log progress */
          if (result.weight !== undefined && result.weight !== "") {
            var todayKey = afcTodayKey();
            await afcUserSet("progress/weight/" + todayKey, Number(result.weight));
          }

          afcLoaderOff();
          afcToast("Profile updated \u2713", "success");
          loadProfile();
        } catch (err) {
          afcLoaderOff();
          afcToast(afcFriendlyAuthError(err), "error");
        }
      });
    }

    /* Change Photo — separate button rendered after edit modal is too complex for afcFormModal */
    /* We add a dedicated photo change flow inline */
    var photoBtn = document.createElement("button");
    photoBtn.className = "btn btn-soft mt-3";
    photoBtn.innerHTML = '<i class="bi bi-camera me-1"></i> CHANGE PHOTO';
    photoBtn.addEventListener("click", async function () {
      var file = await afcPickImage();
      if (!file) return;
      var err = afcValidateImage(file);
      if (err) { afcToast(err, "error"); return; }

      afcLoader("Uploading photo...");
      try {
        var url = await afcUpload("users/" + session.uid + "/profile/profile.jpg", file, function (pct) {
          afcToast("Uploading... " + pct + "%", "info", 800);
        });
        await afcUserUpdate("", { photoURL: url });
        afcLoaderOff();
        afcToast("Photo updated \u2713", "success");
        loadProfile();
      } catch (uploadErr) {
        afcLoaderOff();
        afcToast("Upload failed: " + uploadErr.message, "error");
      }
    });
    var btnContainer = qs(".d-flex.flex-wrap.gap-3");
    if (btnContainer) btnContainer.parentNode.insertBefore(photoBtn, btnContainer.nextSibling);

    /* Reset Data */
    var resetBtn = qs("#prof-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", async function () {
        var ok = await afcConfirm({ title: "Reset All Data?", body: "This will delete your daily logs, progress records and before/after photos. This cannot be undone.", okText: "Reset Everything", danger: true });
        if (!ok) return;
        afcLoader("Resetting data...");
        try {
          await Promise.all([
            afcDbRemove("users/" + session.uid + "/daily"),
            afcDbRemove("users/" + session.uid + "/progress"),
            afcDbRemove("users/" + session.uid + "/beforeAfter")
          ]);
          afcLoaderOff();
          afcToast("Data reset complete", "success");
          loadProfile();
        } catch (err) {
          afcLoaderOff();
          afcToast("Reset failed: " + err.message, "error");
        }
      });
    }

    /* Logout */
    var logoutBtn = qs("#prof-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function () {
        var ok = await afcConfirm({ title: "Log out?", body: "You can log back in any time.", okText: "Logout", danger: true });
        if (!ok) return;
        afcLoader("Logging out...");
        try { await afcSignOut(); } catch (e) { /* ignore */ }
        location.href = "login.html";
      });
    }
  }

  loadProfile();
})();
