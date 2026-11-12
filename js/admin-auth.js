/* ============================================================
   AI FITNESS COACH — ADMIN AUTHENTICATION (LocalStorage)
   ------------------------------------------------------------
   Demo credentials, hardcoded on purpose so the panel is reachable:

       email:    admin@gmail.com
       password: admin1234

   SECURITY NOTE — READ THIS
   This is a frontend-only demo. Those credentials are visible in
   plain text in this file, and the resulting "session" is a single
   LocalStorage key that anyone can write from devtools. There is no
   server, so nothing here can stop a determined user from reaching
   the admin data. This is a UX gate only. Real admin auth requires
   a backend that verifies identity and authorizes every request.
   ============================================================ */

var AFC_ADMIN_EMAIL = "admin@gmail.com";
var AFC_ADMIN_PASSWORD = "admin1234";

/**
 * afcAdminLogin(email, password) -> {email, currentAdmin, since}
 * Checks the demo credentials and writes afc_admin_session.
 * Throws Error("NOT_ADMIN") when they do not match.
 */
window.afcAdminLogin = async function (email, password) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  var cleanPass = String(password || "");

  if (!afcValidEmail(cleanEmail)) {
    var bad = new Error("Please enter a valid email address.");
    bad.code = "auth/invalid-email";
    throw bad;
  }

  if (cleanEmail !== AFC_ADMIN_EMAIL || cleanPass !== AFC_ADMIN_PASSWORD) {
    var denied = new Error("Incorrect admin email or password.");
    denied.code = "NOT_ADMIN";
    throw denied;
  }

  /* Deliberately does not touch afc_current_user: the admin session
     is independent, so an administrator can also be signed in as a
     normal user in the same browser. */
  afcSetAdminSession(cleanEmail);
  return afcGetAdminSession();
};

/**
 * afcAdminLogout()
 * Clears the admin session only and returns to the admin login.
 */
window.afcAdminLogout = async function () {
  afcClearAdminSession();
  window.AFC_ADMIN_SESSION = null;
  location.href = "admin-login.html";
};
