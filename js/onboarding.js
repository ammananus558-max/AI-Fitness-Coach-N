/* AI FITNESS COACH - focused profile setup */
(async function () {
  var session;
  try { session = await requireAuth({ allowIncomplete: true }); } catch (e) { return; }

  /* Setup deliberately does not mount the application shell/sidebar. */
  var mainEl = qs("#mainContent");
  var profile = session.profile && session.profile.profile || {};
  var data = {
    name: session.profile && session.profile.name || "",
    age: profile.age || "",
    gender: profile.gender || "",
    heightUnit: profile.heightUnit || "cm",
    heightCm: profile.height || "",
    heightFt: profile.heightFt || "",
    heightIn: profile.heightIn || "",
    weight: profile.weight || "",
    activityLevel: profile.activityLevel || "",
    goal: session.profile && session.profile.goal || "",
    fitnessLevel: session.profile && (session.profile.fitnessLevel || session.profile.profile && session.profile.profile.fitnessLevel) || "",
    photoURL: session.profile && session.profile.photoURL || ""
  };
  var currentStep = 0;
  var steps = ["name", "age", "gender", "height", "weight", "activityLevel", "goal", "fitnessLevel", "photo", "complete"];

  function render() {
    var key = steps[currentStep];
    var html = '<div class="onboarding-card"><div class="tile tile-pad anim-fade-up">' +
      '<div class="d-flex justify-content-between align-items-center mb-3"><span class="chip fire">PROFILE SETUP</span><span class="text-muted-2 fw-bold">' +
      afcEscape(stepLabel(key)) + "</span></div><div class=\"ob-progress mb-4\">";
    steps.forEach(function (_, i) { html += '<div class="ob-segment' + (i < currentStep ? " done" : i === currentStep ? " active" : "") + '"></div>'; });
    html += "</div>";

    if (key === "name") html += field("Full name", "ob-input", "text", data.name, "Enter your full name");
    if (key === "age") html += field("Age", "ob-input", "number", data.age, "Enter your age", 'min="10" max="120"');
    if (key === "gender") {
      html += '<div class="pill-row mb-3" role="radiogroup">';
      [{ v: "male", t: "Male" }, { v: "female", t: "Female" }, { v: "other", t: "Prefer not to say" }].forEach(function (g) {
        html += '<button type="button" class="pill-option' + (data.gender === g.v ? " selected" : "") + '" data-value="' + g.v + '">' + g.t + "</button>";
      });
      html += "</div>";
    }
    if (key === "height") {
      html += '<div class="btn-group w-100 mb-3" role="group"><button type="button" class="btn ' + (data.heightUnit === "cm" ? "btn-fire" : "btn-ghost") + '" data-unit="cm">CM</button><button type="button" class="btn ' + (data.heightUnit === "ft" ? "btn-fire" : "btn-ghost") + '" data-unit="ft">FT</button></div>';
      if (data.heightUnit === "cm") html += field("Height (cm)", "ob-height-cm", "number", data.heightCm, "e.g. 175", 'min="90" max="250"');
      else html += '<div class="row g-2"><div class="col-6">' + field("Feet", "ob-height-ft", "number", data.heightFt, "5", 'min="3" max="8"') + '</div><div class="col-6">' + field("Inches", "ob-height-in", "number", data.heightIn, "9", 'min="0" max="11"') + "</div></div>";
    }
    if (key === "weight") html += field("Weight (kg)", "ob-input", "number", data.weight, "Enter your weight", 'min="25" max="500"');
    if (key === "activityLevel") html += '<div class="row g-3 mb-3">' + [
      ["light", "Light Activity", "Little or no exercise"], ["moderate", "Moderate Activity", "Exercise 3-5 days/week"],
      ["active", "Active", "Exercise 4-6 days/week"], ["very", "Very Active", "Hard exercise 6-7 days/week"]
    ].map(function (v) { return '<div class="col-12 col-md-6"><div class="select-card tile' + (data.activityLevel === v[0] ? " selected" : "") + '" data-value="' + v[0] + '" tabindex="0"><div class="sel-icon"><i class="bi bi-activity"></i></div><h4>' + v[1] + "</h4><p>" + v[2] + "</p></div></div>"; }).join("") + "</div>";
    if (key === "goal") {
      html += '<div class="row g-3 mb-3">' + [
        ["weight-loss", "Lose Weight"], ["gain-muscle", "Gain Muscle"], ["general", "Stay Healthy"], ["fitness", "Improve Fitness"]
      ].map(function (v) { return '<div class="col-12 col-md-6"><div class="select-card tile' + (data.goal === v[0] ? " selected" : "") + '" data-value="' + v[0] + '" tabindex="0"><div class="sel-icon"><i class="bi bi-bullseye"></i></div><h4>' + v[1] + "</h4></div></div>"; }).join("") + "</div>";
    }
    if (key === "fitnessLevel") html += '<div class="row g-3 mb-3">' + [
      ["beginner", "Beginner", "New to fitness or returning."], ["intermediate", "Intermediate", "Regularly active and training."], ["advanced", "Advanced", "Experienced and performance focused."]
    ].map(function (v) { return '<div class="col-12 col-md-4"><div class="select-card tile' + (data.fitnessLevel === v[0] ? " selected" : "") + '" data-value="' + v[0] + '" tabindex="0"><div class="sel-icon"><i class="bi ' + (v[0] === "beginner" ? "bi-emoji-smile" : v[0] === "intermediate" ? "bi-star-half" : "bi-award-fill") + '"></i></div><h4>' + v[1] + "</h4><p>" + v[2] + "</p></div></div>"; }).join("") + "</div>";
    if (key === "photo") {
      html += '<div class="text-center mb-3"><span class="avatar-lg d-inline-grid place-items-center" id="ob-preview" style="background:var(--grad-fire);color:#fff;font-size:2rem">' +
        (data.photoURL ? '<img src="' + afcEscape(data.photoURL) + '" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : '<i class="bi bi-person-fill"></i>') +
        '</span></div><input type="file" class="form-control mb-2" id="ob-photo" accept="image/jpeg,image/png,image/webp"><p class="text-muted-2 small">Optional. You can skip only this photo step.</p>';
    }
    if (key === "complete") {
      var heightCm = getHeightCm();
      var bmi = afcCalcBMI(heightCm, Number(data.weight));
      var calories = afcCalcCalories({ age: Number(data.age), gender: data.gender, height: heightCm, weight: Number(data.weight), activityLevel: data.activityLevel });
      html += '<div class="tile tile-pad mb-3"><h4 class="gradient-text">Your plan is ready</h4><div class="row g-3"><div class="col-6"><div class="stat-label">BMI</div><div class="stat-value">' + bmi + "</div></div><div class=\"col-6\"><div class=\"stat-label\">DAILY CALORIES</div><div class=\"stat-value\">" + (calories ? calories.target : "—") + "</div></div></div></div>";
    }
    html += '<div class="invalid-feedback-2 mb-3" id="ob-error" role="alert"></div><div class="d-flex gap-3 mt-4">' +
      '<button class="btn btn-ghost flex-fill" id="ob-back"' + (currentStep === 0 ? " disabled" : "") + ">BACK</button>" +
      (key === "photo" ? '<button class="btn btn-ghost flex-fill" id="ob-skip">SKIP</button>' : "") +
      '<button class="btn btn-fire flex-fill" id="ob-next">' + (key === "complete" ? "SAVE PROFILE" : "CONTINUE") + "</button></div></div></div>";
    mainEl.innerHTML = html;
    bind();
  }

  function stepLabel(key) { return ({ name: "Name", age: "Age", gender: "Gender", height: "Height", weight: "Weight", activityLevel: "Activity Level", goal: "Fitness Goal", fitnessLevel: "Fitness Level", photo: "Profile Image", complete: "Automatic Calculation" })[key]; }
  function field(label, id, type, value, placeholder, attrs) { return '<div class="mb-3"><label class="form-label" for="' + id + '">' + label + '</label><input class="form-control" id="' + id + '" type="' + type + '" value="' + afcEscape(value) + '" placeholder="' + placeholder + '" ' + (attrs || "") + "></div>"; }
  function getHeightCm() {
    if (data.heightUnit === "ft") return Math.round(((Number(data.heightFt) * 12) + Number(data.heightIn)) * 2.54 * 10) / 10;
    return Number(data.heightCm);
  }
  function validate() {
    var key = steps[currentStep], error = qs("#ob-error");
    if (error) error.textContent = "";
    if (key === "name") data.name = qs("#ob-input").value.trim();
    if (key === "age") data.age = qs("#ob-input").value;
    if (key === "weight") data.weight = qs("#ob-input").value;
    if (key === "height") {
      data.heightUnit = data.heightUnit || "cm";
      if (data.heightUnit === "cm") data.heightCm = qs("#ob-height-cm").value;
      else { data.heightFt = qs("#ob-height-ft").value; data.heightIn = qs("#ob-height-in").value; }
    }
    var valid = key === "name" ? data.name.length >= 2 :
      key === "age" ? afcIsNumber(data.age, 10, 120) :
      key === "height" ? afcIsNumber(getHeightCm(), 90, 250) :
      key === "weight" ? afcIsNumber(data.weight, 25, 500) :
      key === "gender" ? !!data.gender : key === "activityLevel" ? !!data.activityLevel : key === "goal" ? !!data.goal : key === "fitnessLevel" ? !!data.fitnessLevel : true;
    if (!valid && error) error.textContent = "Please enter or select a valid value.";
    return valid;
  }
  function bind() {
    var key = steps[currentStep], next = qs("#ob-next");
    qsa("[data-unit]").forEach(function (b) { b.addEventListener("click", function () { data.heightUnit = b.dataset.unit; render(); }); });
    qsa(".pill-option").forEach(function (b) { b.addEventListener("click", function () { data.gender = b.dataset.value; render(); }); });
    qsa(".select-card").forEach(function (b) { b.addEventListener("click", function () { if (key === "activityLevel") data.activityLevel = b.dataset.value; else if (key === "fitnessLevel") data.fitnessLevel = b.dataset.value; else data.goal = b.dataset.value; render(); }); });
    var photo = qs("#ob-photo");
    if (photo) photo.addEventListener("change", async function () { var file = photo.files && photo.files[0]; if (!file) return; var err = afcValidateImage(file); if (err) { qs("#ob-error").textContent = err; return; } data.photoURL = await afcCompressImage(file); qs("#ob-preview").innerHTML = '<img src="' + data.photoURL + '" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; });
    if (qs("#ob-skip")) qs("#ob-skip").addEventListener("click", function () { currentStep++; render(); });
    if (qs("#ob-back")) qs("#ob-back").addEventListener("click", function () { if (currentStep) { currentStep--; render(); } });
    if (next) next.addEventListener("click", async function () { if (key !== "complete" && !validate()) return; if (currentStep < steps.length - 1) { currentStep++; render(); } else await saveProfile(); });
  }
  async function saveProfile() {
    afcLoader("Saving profile...");
    try {
      var height = getHeightCm(), bmi = afcCalcBMI(height, Number(data.weight));
      var calories = afcCalcCalories({ age: Number(data.age), gender: data.gender, height: height, weight: Number(data.weight), activityLevel: data.activityLevel });
      await afcUserSet("profile", { age: Number(data.age), gender: data.gender, height: height, heightUnit: data.heightUnit, heightFt: data.heightFt, heightIn: data.heightIn, weight: Number(data.weight), activityLevel: data.activityLevel, fitnessLevel: data.fitnessLevel });
      await afcUserSet("health/bmi", { value: bmi, category: afcBMICategory(bmi).label, height: height, weight: Number(data.weight), date: afcTodayKey() });
      await afcUserSet("health/calories", calories);
      await afcUserSet("goal", data.goal);
      await afcUserSet("fitnessLevel", data.fitnessLevel);
      await afcUserUpdate("", { name: data.name, photoURL: data.photoURL || "", onboardingCompleted: true, bmi: bmi, calories: calories });
      afcLoaderOff(); afcToast("Profile saved!", "success"); location.href = "dashboard.html";
    } catch (err) { afcLoaderOff(); afcToast(afcFriendlyAuthError(err), "error"); }
  }
  render();
})();
