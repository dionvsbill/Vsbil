"use strict";

const form = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const message = document.getElementById("loginMessage");
const email = document.getElementById("email");
const password = document.getElementById("password");
const toggle = document.getElementById("passwordToggle");

function msg(text, type = "") {
  if (!message) return;
  message.textContent = text || "";
  message.className = `form-message${type ? ` ${type}` : ""}`;
}

toggle?.addEventListener("click", () => {
  if (!password) return;
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  toggle.textContent = show ? "Hide" : "Show";
  toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const normalizedEmail = email?.value.trim().toLowerCase() || "";
  const pw = password?.value || "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    msg("Enter a valid email address.", "error");
    email?.focus();
    return;
  }
  if (!pw || pw.length > 72) {
    msg("Enter your password.", "error");
    password?.focus();
    return;
  }

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.setAttribute("aria-busy", "true");
    loginBtn.textContent = "Signing in…";
  }

  try {
    // Use the same production authentication system as Google OAuth and the callback.
    const data = await window.VSBIL_AUTH.request("/api/auth/production/login", {
      email: normalizedEmail,
      password: pw
    });

    window.VSBIL_AUTH.saveSession(data.session, data.user);
    msg("Welcome back. Opening your dashboard…", "success");
    window.setTimeout(() => location.replace("/dashboard.html"), 350);
  } catch (error) {
    console.error("Login failed:", error);

    if (error?.code === "EMAIL_NOT_CONFIRMED" || error?.code === "EMAIL_NOT_VERIFIED") {
      sessionStorage.setItem("vsbil_verification_email", normalizedEmail);
      msg("Please verify your email before signing in.", "error");
      window.setTimeout(() => location.replace(`/verify-email.html?email=${encodeURIComponent(normalizedEmail)}`), 500);
    } else if (error?.code === "ACCOUNT_NOT_ACTIVE") {
      if (error.data?.session) window.VSBIL_AUTH.saveSession(error.data.session, error.data.user);
      sessionStorage.setItem("vsbil_pending_user_id", error.data?.user?.id || "");
      msg("Your account is verified. Activate it to continue.", "success");
      window.setTimeout(() => location.replace("/activation.html"), 500);
    } else {
      msg(error instanceof Error ? error.message : "Unable to sign in. Please try again.", "error");
    }
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.removeAttribute("aria-busy");
      loginBtn.textContent = "Login";
    }
  }
});

document.getElementById("registerBtn")?.addEventListener("click", () => location.replace("/register.html"));
