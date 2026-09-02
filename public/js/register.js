"use strict";

const form = document.getElementById("registerForm");
const registerBtn = document.getElementById("registerBtn");
const message = document.getElementById("registerMessage");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const referralCodeInput = document.getElementById("referralCode");
const passwordToggle = document.getElementById("passwordToggle");
const googleRegisterBtn = document.getElementById("googleRegisterBtn");
const loginBtn = document.getElementById("authLoginBtn");

function showMessage(text, type = "") {
  if (!message) return;
  message.textContent = text || "";
  message.className = `form-message${type ? ` ${type}` : ""}`;
}

function getAuthClient() {
  if (window.VSBIL_AUTH && typeof window.VSBIL_AUTH.request === "function") return window.VSBIL_AUTH;
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

const invite = (new URLSearchParams(window.location.search).get("ref") || "").trim().toUpperCase();
if (invite && referralCodeInput) referralCodeInput.value = invite;

// Keep the referral code visible when the user switches from registration to login.
if (loginBtn) {
  loginBtn.addEventListener("click", (event) => {
    event.preventDefault();
    const target = new URL("/login.html", window.location.origin);
    if (invite) target.searchParams.set("ref", invite);
    window.location.replace(target.toString());
  });
}

// Google signup keeps the referral code in the OAuth redirect and the trusted callback.
googleRegisterBtn?.addEventListener("click", async () => {
  const button = googleRegisterBtn;
  const auth = getAuthClient();
  if (!auth) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Connecting…";
  try {
    const endpoint = invite ? `/api/auth/google?ref=${encodeURIComponent(invite)}` : "/api/auth/google";
    const data = await auth.request(endpoint);
    if (!data?.url) throw new Error("Google authentication is not configured.");
    window.location.assign(data.url);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Unable to connect to Google.", "error");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Continue with Google";
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const username = usernameInput?.value.trim().toLowerCase() || "";
  const email = emailInput?.value.trim().toLowerCase() || "";
  const pw = password?.value || "";
  const cp = confirmPassword?.value || "";
  const ref = referralCodeInput?.value.trim().toUpperCase() || "";

  if (!/^[a-z0-9_]{3,30}$/.test(username)) return showMessage("Username must be 3–30 letters, numbers or underscores.", "error");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return showMessage("Enter a valid email address.", "error");
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,72}$/.test(pw)) return showMessage("Use 10–72 characters with uppercase, lowercase, a number and a symbol.", "error");
  if (pw !== cp) return showMessage("Your passwords do not match.", "error");

  const auth = getAuthClient();
  if (!auth) return;
  registerBtn.disabled = true;
  registerBtn.setAttribute("aria-busy", "true");
  registerBtn.textContent = "Creating account…";

  try {
    const data = await auth.request("/api/auth/register", {
      username,
      email,
      password: pw,
      ...(ref ? { referralCode: ref } : {})
    });
    if (data.session) auth.saveSession(data.session, data.user);
    sessionStorage.setItem("vsbil_verification_email", email);
    sessionStorage.setItem("vsbil_pending_user_id", data.user?.id || "");
    showMessage(data.message || "Account created. Activation is required.", "success");
    setTimeout(() => window.location.replace("/activation.html"), 600);
  } catch (error) {
    console.error("Registration failed:", error);
    showMessage(error instanceof Error ? error.message : "Unable to create your account. Please try again.", "error");
  } finally {
    registerBtn.disabled = false;
    registerBtn.removeAttribute("aria-busy");
    registerBtn.textContent = "Create Account";
  }
});
