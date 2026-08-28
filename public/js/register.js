"use strict";
const form = document.getElementById("registerForm");
const registerBtn = document.getElementById("registerBtn");
const message = document.getElementById("registerMessage");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const referralCodeInput = document.getElementById("referralCode");
const passwordToggle =
  document.getElementById("passwordToggle");
const loginBtn =
  document.getElementById("authLoginBtn");
/* =========================================================
   MESSAGE HELPER
   ========================================================= */
function showMessage(text, type = "") {
  if (!message) return;
  message.textContent = text;
  message.className = "form-message";
  if (type) {
    message.classList.add(type);
  }
}
/* =========================================================
   PASSWORD VISIBILITY
   ========================================================= */
passwordToggle?.addEventListener("click", () => {
  if (!password) return;
  const showing = password.type === "text";
  password.type = showing
    ? "password"
    : "text";
  passwordToggle.textContent =
    showing ? "Show" : "Hide";
  passwordToggle.setAttribute(
    "aria-label",
    showing
      ? "Show password"
      : "Hide password"
  );
});
/* =========================================================
   LOGIN BUTTON
   ========================================================= */
loginBtn?.addEventListener("click", () => {
  window.location.href = "/login.html";
});
/* =========================================================
   REGISTRATION
   ========================================================= */
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!usernameInput || !emailInput || !password || !confirmPassword) {
    showMessage(
      "The registration form is incomplete. Please refresh the page and try again.",
      "error"
    );
    return;
  }
  /* -------------------------------------------------------
     GET FORM VALUES
     ------------------------------------------------------- */
  const username =
    usernameInput.value.trim();
  const email =
    emailInput.value.trim().toLowerCase();
  const passwordValue =
    password.value;
  const confirmPasswordValue =
    confirmPassword.value;
  const referralCode =
    referralCodeInput?.value.trim() || "";
  /* -------------------------------------------------------
     BASIC VALIDATION
     ------------------------------------------------------- */
  if (!username) {
    showMessage(
      "Please enter a username.",
      "error"
    );
    usernameInput.focus();
    return;
  }
  if (username.length < 3) {
    showMessage(
      "Your username must contain at least 3 characters.",
      "error"
    );
    usernameInput.focus();
    return;
  }
  if (username.length > 30) {
    showMessage(
      "Your username cannot be longer than 30 characters.",
      "error"
    );
    usernameInput.focus();
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showMessage(
      "Username can only contain letters, numbers and underscores.",
      "error"
    );
    usernameInput.focus();
    return;
  }
  /* -------------------------------------------------------
     EMAIL VALIDATION
     ------------------------------------------------------- */
  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    showMessage(
      "Please enter a valid email address.",
      "error"
    );
    emailInput.focus();
    return;
  }
  /* -------------------------------------------------------
     PASSWORD VALIDATION
     ------------------------------------------------------- */
  if (passwordValue.length < 8) {
    showMessage(
      "Your password must contain at least 8 characters.",
      "error"
    );
    password.focus();
    return;
  }
  if (passwordValue.length > 72) {
    showMessage(
      "Your password is too long. Please use 72 characters or fewer.",
      "error"
    );
    password.focus();
    return;
  }
  if (passwordValue !== confirmPasswordValue) {
    showMessage(
      "Passwords do not match. Please check both password fields.",
      "error"
    );
    confirmPassword.focus();
    return;
  }
  /* -------------------------------------------------------
     PREVENT DOUBLE SUBMISSION
     ------------------------------------------------------- */
  if (registerBtn) {
    registerBtn.disabled = true;
    registerBtn.textContent =
      "Creating account...";
  }
  try {
    /* -----------------------------------------------------
       SEND REGISTRATION REQUEST
       ----------------------------------------------------- */
    const response = await fetch(
      "/api/auth/register",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          username,
          email,
          password: passwordValue,
          referralCode:
            referralCode || undefined
        })
      }
    );
    /* -----------------------------------------------------
       READ SERVER RESPONSE SAFELY
       ----------------------------------------------------- */
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The server returned an invalid response. Please try again."
      );
    }
    /* -----------------------------------------------------
       SERVER ERROR
       ----------------------------------------------------- */
    if (!response.ok || !data.success) {
      throw new Error(
        data.message ||
        "Unable to create account. Please try again."
      );
    }
    /* -----------------------------------------------------
       MAKE SURE USER ID WAS RETURNED
       ----------------------------------------------------- */
    const userId =
      data.user?.id;
    if (!userId) {
      console.error(
        "Registration succeeded but no user ID was returned:",
        data
      );
      throw new Error(
        "Your account was created, but we could not prepare the activation step. Please try again."
      );
    }
    /* -----------------------------------------------------
       SAVE PENDING USER ID
       
       activation.js uses this to initialize the
       GH₵50 Paystack activation payment.
       ----------------------------------------------------- */
    sessionStorage.setItem(
      "vsbil_pending_user_id",
      userId
    );
    /* -----------------------------------------------------
       SAVE OPTIONAL USERNAME FOR UI
       ----------------------------------------------------- */
    sessionStorage.setItem(
      "vsbil_pending_username",
      data.user?.username ||
      username
    );
    /* Store the temporary Supabase session so the pending account can securely pay for activation. */
    if (data.session?.accessToken && data.session?.refreshToken) {
      localStorage.setItem("vsbil_access_token", data.session.accessToken);
      localStorage.setItem("vsbil_refresh_token", data.session.refreshToken);
      localStorage.setItem("vsbil_expires_in", String(data.session.expiresIn ?? ""));
      localStorage.setItem("vsbil_expires_at", String(data.session.expiresAt ?? ""));
      localStorage.setItem("vsbil_token_type", data.session.tokenType || "bearer");
      localStorage.setItem("vsbil_user", JSON.stringify(data.user));
    }
    /* -----------------------------------------------------
       SUCCESS MESSAGE
       ----------------------------------------------------- */
    showMessage(
      "Account created successfully. Redirecting to activation...",
      "success"
    );
    /* -----------------------------------------------------
       RESET FORM
       ----------------------------------------------------- */
    form.reset();
    /* -----------------------------------------------------
       GO TO ACTIVATION
       ----------------------------------------------------- */
    setTimeout(() => {
      window.location.href =
        "/activation.html";
    }, 1000);
  } catch (error) {
    console.error(
      "Registration error:",
      error
    );
    /* -----------------------------------------------------
       USER-FRIENDLY ERROR
       ----------------------------------------------------- */
    let errorMessage =
      "Something went wrong while creating your account. Please try again.";
    if (error instanceof Error && error.message) {
      errorMessage = error.message;
    }
    showMessage(
      errorMessage,
      "error"
    );
  } finally {
    /* -----------------------------------------------------
       RESTORE BUTTON
       ----------------------------------------------------- */
    if (registerBtn) {
      registerBtn.disabled = false;
      registerBtn.textContent =
        "Create Account";
    }
  }
});