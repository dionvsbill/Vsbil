"use strict";

/*
 * VSBIL REGISTRATION CLIENT
 *
 * auth-flow.js is loaded by register.html first and exposes
 * window.VSBIL_AUTH. Keep all authentication requests going
 * through that shared client so error handling and session
 * behaviour stay consistent across the application.
 */

const form = document.getElementById("registerForm");
const registerBtn = document.getElementById("registerBtn");
const message = document.getElementById("registerMessage");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const referralCodeInput = document.getElementById("referralCode");
const passwordToggle = document.getElementById("passwordToggle");
const loginBtn = document.getElementById("authLoginBtn");

function showMessage(text, type = "") {
  if (!message) return;
  message.textContent = text || "";
  message.className = `form-message${type ? ` ${type}` : ""}`;
}

function getAuthClient() {
  if (window.VSBIL_AUTH && typeof window.VSBIL_AUTH.request === "function") {
    return window.VSBIL_AUTH;
  }

  console.error("VSBIL_AUTH is unavailable. auth-flow.js was not loaded.");
  showMessage("Authentication is temporarily unavailable. Please refresh and try again.", "error");
  return null;
}

passwordToggle?.addEventListener("click", () => {
  if (!password) return;
  const showing = password.type === "text";
  password.type = showing ? "password" : "text";
  passwordToggle.textContent = showing ? "Show" : "Hide";
  passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
});

const invite = new URLSearchParams(window.location.search).get("ref");
if (invite && referralCodeInput) referralCodeInput.value = invite.trim();

loginBtn?.addEventListener("click", () => window.location.replace("/login.html"));

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const username = usernameInput?.value.trim().toLowerCase() || "";
  const email = emailInput?.value.trim().toLowerCase() || "";
  const pw = password?.value || "";
  const cp = confirmPassword?.value || "";
  const ref = referralCodeInput?.value.trim() || "";

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    showMessage("Username must be 3–30 letters, numbers or underscores.", "error");
    usernameInput?.focus();
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    showMessage("Enter a valid email address.", "error");
    emailInput?.focus();
    return;
  }

  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,72}$/.test(pw)) {
    showMessage("Use 10–72 characters with uppercase, lowercase, a number and a symbol.", "error");
    password?.focus();
    return;
  }

  if (pw !== cp) {
    showMessage("Your passwords do not match.", "error");
    confirmPassword?.focus();
    return;
  }

  const auth = getAuthClient();
  if (!auth) return;

  if (registerBtn) {
    registerBtn.disabled = true;
    registerBtn.setAttribute("aria-busy", "true");
    registerBtn.textContent = "Creating account…";
  }

  try {
    /* Backend route mounted at /api/auth in src/app.ts. */
    const data = await auth.request("/api/auth/register", {
      username,
      email,
      password: pw,
      ...(ref ? { referralCode: ref } : {})
    });

    if (data.session) {
      auth.saveSession(data.session, data.user);
    }

    sessionStorage.setItem("vsbil_verification_email", email);
    sessionStorage.setItem("vsbil_pending_user_id", data.user?.id || "");

    showMessage(
      data.message || "Account created. Activation is required.",
      "success"
    );

    /* The current backend creates the account and marks it pending. */
    setTimeout(() => {
      window.location.replace("/activation.html");
    }, 600);
  } catch (error) {
    console.error("Registration failed:", error);
    showMessage(
      error instanceof Error ? error.message : "Unable to create your account. Please try again.",
      "error"
    );
  } finally {
    if (registerBtn) {
      registerBtn.disabled = false;
      registerBtn.removeAttribute("aria-busy");
      registerBtn.textContent = "Create Account";
    }
  }
});
