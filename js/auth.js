/* ============================================================
   AI FITNESS COACH — AUTH HELPERS
   Shared logic for login / signup / welcome pages.
   Depends on: utils.js, storage.js, app.js
   ============================================================ */

/**
 * afcAfterAuthRoute(user)
 * Sends a freshly authenticated user to onboarding the first time,
 * and to the dashboard afterwards.
 */
window.afcAfterAuthRoute = async function (user) {
  try {
    var data = await afcDbGet("users/" + user.uid);
    location.href = (!data || !data.onboardingCompleted) ? "onboarding.html" : "dashboard.html";
  } catch (e) {
    location.href = "onboarding.html";
  }
};
