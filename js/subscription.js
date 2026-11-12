/* ============================================================
   AI FITNESS COACH — SUBSCRIPTION PAGE
   Paid plans, subscription status, and simulated checkout.
   ============================================================ */
(async function () {
  let session;
  try { session = await requireAuth(); } catch (e) { return; }
  document.body.classList.add("subscription-page");
  afcMountLayout("subscription");

  var FALLBACK_PRICING = [
    { key: "plan-basic", name: "Basic", tier: "basic", price: 4.99, durationDays: 30, featured: false, active: true, features: ["Core workout access", "Full workout library", "Your personalized diet plan", "Progress and streak tracking"] },
    { key: "plan-premium", name: "Cloudy", tier: "premium", price: 89.99, durationDays: 365, featured: true, active: true, features: ["Everything in Basic", "12 months of access", "New plans every month", "Exclusive programs", "Priority support"] },
    { key: "plan-pro", name: "Cloudy", tier: "pro", price: 9.99, durationDays: 30, featured: false, active: true, features: ["Everything in Basic", "4-week personalized program", "AI assistant", "Before & after gallery"] }
  ];

  var selectedPlan = null;
  var paidPlanKeys = ["plan-basic", "plan-premium", "plan-pro"];
  function isPaidPlan(plan) {
    return !!plan && paidPlanKeys.indexOf(plan.key) >= 0;
  }
  function durationLabel(days) {
    var n = Number(days) || 0;
    return n % 365 === 0 && n >= 365 ? (n / 365) + " year" + (n === 365 ? "" : "s") :
      n % 30 === 0 && n >= 30 ? (n / 30) + " month" + (n === 30 ? "" : "s") :
      n + " day" + (n === 1 ? "" : "s");
  }
  function displayPlanName(plan) {
    var key = typeof plan === "string" ? plan : plan && (plan.key || plan.planId);
    var name = typeof plan === "string" ? plan : plan && plan.name;
    return key === "plan-premium" || key === "plan-pro" || /^(premium|pro)$/i.test(String(name || "")) ? "Cloudy" : (name || "Basic");
  }
  var checkoutModalEl = qs("#checkoutModal");
  var checkoutBody = qs("#checkoutBody");
  var confirmBtn = qs("#confirmPurchaseBtn");
  var modalInstance = null;

  /* ---- Banner rendering ---- */
  async function renderBanner() {
    var banner = qs("#trialBanner");
    var manageSection = qs("#manageSection");
    var manageInfo = qs("#manageInfo");

    var sub = await afcUserGet("subscription");
    var hasPrem = await afcHasPremium();
    if (!hasPrem) sub = await afcUserGet("subscription");
    if (hasPrem && sub) {
      var remaining = Math.max(0, afcDaysBetween(afcTodayKey(), sub.endDate) + 1);
      var total = Math.max(1, Number(sub.durationDays) || 1);
      var elapsed = Math.max(0, total - remaining);
      banner.innerHTML =
        '<div class="tile tile-pad anim-scale" style="border-left:4px solid var(--success)">' +
        '<div class="d-flex align-items-start gap-3">' +
        '<i class="bi bi-patch-check-fill text-success" style="font-size:2rem" aria-hidden="true"></i>' +
        '<div class="flex-grow-1"><h5 class="mb-1 text-success">Current Subscription</h5>' +
        '<p class="mb-1 fw-bold">' + afcEscape(displayPlanName(sub)) + ' Plan · Active</p>' +
        '<p class="mb-2 text-muted-2">' + remaining + ' days remaining · Ends ' + afcFmtDate(sub.endDate) + '</p>' +
        '<div class="d-flex justify-content-between small text-muted-2 mb-1"><span>Day ' + Math.min(total, elapsed + 1) + ' of ' + total + '</span><span>' + durationLabel(total) + '</span></div>' +
        '<div class="progress-2" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + Math.min(total, elapsed + 1) + '"><div class="bar" style="width:' + Math.min(100, elapsed / total * 100) + '%"></div></div>' +
        '<div class="d-flex justify-content-between small text-muted-2 mt-1"><span>Started ' + afcFmtDate(sub.startDate) + '</span><span>Expires ' + afcFmtDate(sub.endDate) + '</span></div></div>' +
        '</div></div>';
      manageSection.classList.remove("d-none");
      manageInfo.textContent = displayPlanName(sub) + " Plan is active for " + durationLabel(sub.durationDays) + ".";
      return;
    }
    banner.innerHTML =
      '<div class="tile tile-pad anim-scale" style="border-left:4px solid var(--warning)">' +
      '<div class="d-flex align-items-center gap-3">' +
      '<i class="bi bi-gem text-warning" style="font-size:2rem" aria-hidden="true"></i>' +
      '<div><h5 class="mb-1">' + (sub && sub.status === "expired" ? "Your subscription has expired" : "Choose a Plan") + '</h5>' +
      '<p class="mb-0 text-muted-2">Select a paid plan to continue your fitness journey.</p></div>' +
      '</div></div>';
    manageSection.classList.add("d-none");
  }

  /* ---- Plans grid ---- */
  function renderPlans(plans) {
    var grid = qs("#plansGrid");
    if (!plans || !plans.length) {
      grid.innerHTML = '<div class="col-12 empty-state"><i class="bi bi-gem" aria-hidden="true"></i><p>No plans available right now.</p></div>';
      return;
    }
    plans.sort(function (a, b) { return paidPlanKeys.indexOf(a.key) - paidPlanKeys.indexOf(b.key); });
    grid.innerHTML = plans.map(function (p) {
      var featClass = p.featured ? " featured" : "";
      var feats = (p.features || []).map(function (f) {
        f = String(f).replace(/Everything in Free/ig, "Core workout access");
        return '<li class="mb-1"><i class="bi bi-check-circle-fill text-success me-2" aria-hidden="true"></i>' + afcEscape(f) + "</li>";
      }).join("");
      return '<div class="col-sm-6 col-lg-4 reveal">' +
        '<div class="tile tile-pad plan-card h-100' + featClass + '">' +
        (p.featured ? '<span class="position-absolute top-0 end-0 m-2 badge rounded-pill bg-primary">POPULAR</span>' : "") +
        '<h5 class="fw-bold mb-1">' + afcEscape(displayPlanName(p)) + '</h5>' +
        '<div class="plan-price gradient-text">$' + Number(p.price).toFixed(2) + '</div>' +
        '<div class="text-muted-2 mb-3" style="font-size:.82rem">per ' + (p.durationDays || 30) + ' days</div>' +
        '<ul class="list-unstyled small mb-3" style="line-height:1.7">' + feats + '</ul>' +
        '<button class="btn btn-fire w-100 mt-auto buy-plan-btn" data-key="' + afcEscape(p.key) + '">BUY PLAN</button>' +
        '</div></div>';
    }).join("");
    /* Plans are inserted after the initial page reveal pass. Reveal them now
       so dynamically rendered cards are not left at opacity: 0. */
    afcInitReveals();
  }

  /* ---- Load pricing (live listener) ---- */
  function loadPricing() {
    /* Keep the page actionable while the live pricing collection loads. */
    renderPlans(FALLBACK_PRICING.slice());
    afcDbOnValue("pricing", function (data) {
      var plans = [];
      if (data) {
        Object.keys(data).forEach(function (k) {
          var p = data[k];
          if (p && p.active !== false && paidPlanKeys.indexOf(k) >= 0) {
            p.key = k;
            plans.push(p);
          }
        });
      }
      FALLBACK_PRICING.forEach(function (fallback) {
        if (!plans.some(function (plan) { return plan.key === fallback.key; })) plans.push(fallback);
      });
      renderPlans(plans);
    }).catch(function () {
      renderPlans(FALLBACK_PRICING.slice());
    });
  }

  /* ---- Checkout flow ---- */
  function openCheckout(planKey) {
    var cards = qsa(".buy-plan-btn");
    /* Find plan data from the current rendered grid by re-reading pricing cache or fallback */
    /* We'll look up from the DOM data-key and find in our last-known plans */
    afcDbGet("pricing/" + planKey).then(function (p) {
      if (p) p.key = planKey;
      if (!p || !isPaidPlan(p)) {
        var fb = FALLBACK_PRICING.find(function (f) { return f.key === planKey; });
        p = fb || null;
      }
      if (!p) { afcToast("Plan not found.", "error"); return; }
      selectedPlan = p;
      var today = afcTodayKey();
      var selectedDays = p.durationDays || 30;
      var end = afcAddDays(today, selectedDays - 1);
      checkoutBody.innerHTML =
        '<div class="mb-3"><strong>Plan:</strong> ' + afcEscape(displayPlanName(p)) + '</div>' +
        '<div class="mb-3"><strong>Price:</strong> $' + Number(p.price).toFixed(2) + '</div>' +
        '<div class="mb-3"><strong>Duration:</strong> ' + durationLabel(p.durationDays || 30) + '</div>' +
        '<div class="mb-3"><strong>Start:</strong> ' + afcFmtDate(today) + '</div>' +
        '<div class="mb-3"><strong>End:</strong> <span data-checkout-end>' + afcFmtDate(end) + '</span></div>' +
        '<hr><div class="mb-3"><label class="form-label">Demo payment method</label><select class="form-select" id="demoPaymentMethod"><option>Demo card ending 4242</option><option>Demo wallet</option></select></div><p class="text-muted-2 small mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>This is a simulated checkout — no real payment is processed.</p>';
      if (!modalInstance) modalInstance = new bootstrap.Modal(checkoutModalEl);
      modalInstance.show();
    }).catch(function () {
      afcToast("Could not load plan details.", "error");
    });
  }

  confirmBtn.addEventListener("click", async function () {
    if (!selectedPlan) return;
    afcBusy(confirmBtn, true, "Processing...");
    try {
      var today = afcTodayKey();
      var durationDays = selectedPlan.durationDays || 30;
      var end = afcAddDays(today, durationDays - 1);
      var userProfile = afcNormalizeUserProfile(session.profile || session);
      await afcUserSet("subscription", {
        planId: selectedPlan.key,
        planName: displayPlanName(selectedPlan),
        price: selectedPlan.price,
        paymentMethod: "demo",
        paymentStatus: "confirmed",
        status: "active",
        startDate: today,
        endDate: end,
        expiryDate: end,
        durationDays: durationDays,
        fitnessGoal: userProfile.goal,
        fitnessLevel: userProfile.level
      });
      if (modalInstance) modalInstance.hide();
      afcConfetti();
      var purchasedPlanName = displayPlanName(selectedPlan);
      afcToast("Thank you! You have successfully purchased the " + purchasedPlanName + " Plan.", "success");
      afcToast("Your " + purchasedPlanName + " Plan is active for " + durationLabel(durationDays) + ".", "info");
      try { localStorage.setItem("afc_subscription_notice", JSON.stringify({ planName: purchasedPlanName, durationDays: durationDays })); } catch (e) {}
      window.location.href = "dashboard.html";
    } catch (e) {
      afcToast("Could not activate plan. Please try again.", "error");
    } finally {
      afcBusy(confirmBtn, false);
    }
  });

  /* ---- Buy button delegation ---- */
  qs("#plansGrid").addEventListener("click", function (e) {
    var btn = e.target.closest(".buy-plan-btn");
    if (btn) openCheckout(btn.dataset.key);
  });

  /* ---- Cancel subscription ---- */
  qs("#cancelSubBtn").addEventListener("click", async function () {
    var ok = await afcConfirm({
      title: "Cancel Subscription?",
      body: "Your Cloudy access will be revoked immediately. This cannot be undone easily.",
      okText: "Cancel Subscription",
      danger: true
    });
    if (!ok) return;
    afcLoader("Cancelling...");
    try {
      await afcUserUpdate("subscription", { status: "cancelled" });
      afcToast("Subscription cancelled.", "info");
      await renderBanner();
    } catch (e) {
      afcToast("Could not cancel. Please try again.", "error");
    } finally {
      afcLoaderOff();
    }
  });

  /* ---- Init ---- */
  await renderBanner();
  loadPricing();
})();
