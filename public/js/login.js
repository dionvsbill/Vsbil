/*
=========================================================
VSBIL LOGIN
login.js
=========================================================
Handles:
- Login
- Supabase access-token storage
- Refresh-token storage
- Session validation
- Pending-account detection
- Password visibility
- Register navigation
- Clean session replacement
=========================================================
*/
"use strict";
/* =========================================================
   ELEMENTS
   ========================================================= */
const form =
  document.getElementById("loginForm");
const loginBtn =
  document.getElementById("loginBtn");
const message =
  document.getElementById("loginMessage");
const emailInput =
  document.getElementById("email");
const passwordInput =
  document.getElementById("password");
const passwordToggle =
  document.getElementById("passwordToggle");
const registerBtn =
  document.getElementById("registerBtn");
/* =========================================================
   PASSWORD TOGGLE
   ========================================================= */
passwordToggle?.addEventListener(
  "click",
  () => {
    if (!passwordInput) {
      return;
    }
    const showing =
      passwordInput.type === "text";
    passwordInput.type =
      showing
        ? "password"
        : "text";
    passwordToggle.textContent =
      showing
        ? "Show"
        : "Hide";
  }
);
/* =========================================================
   REGISTER BUTTON
   ========================================================= */
registerBtn?.addEventListener(
  "click",
  () => {
    window.location.replace(
      "/register.html"
    );
  }
);
/* =========================================================
   MESSAGE
   ========================================================= */
function showMessage(
  text,
  type = ""
) {
  if (!message) {
    return;
  }
  message.textContent =
    text;
  message.className =
    "form-message";
  if (type) {
    message.classList.add(
      type
    );
  }
}
/* =========================================================
   CLEAR AUTH SESSION
   ========================================================= */
function clearSession() {
  const keys = [
    "vsbil_access_token",
    "vsbil_refresh_token",
    "vsbil_expires_at",
    "vsbil_expires_in",
    "vsbil_token_type",
    "vsbil_user"
  ];
  keys.forEach((key) => {
    localStorage.removeItem(
      key
    );
  });
}
/* =========================================================
   STORE AUTH SESSION
   ========================================================= */
function storeSession(
  session,
  user
) {
  if (
    !session ||
    !session.accessToken ||
    !session.refreshToken
  ) {
    throw new Error(
      "Login session is incomplete."
    );
  }
  if (!user?.id) {
    throw new Error(
      "Unable to load your account."
    );
  }
  /*
   * Access token
   */
  localStorage.setItem(
    "vsbil_access_token",
    session.accessToken
  );
  /*
   * Refresh token
   */
  localStorage.setItem(
    "vsbil_refresh_token",
    session.refreshToken
  );
  /*
   * Token type
   */
  localStorage.setItem(
    "vsbil_token_type",
    session.tokenType ||
    "bearer"
  );
  /*
   * Expiration
   */
  if (
    session.expiresAt !==
      undefined &&
    session.expiresAt !==
      null
  ) {
    localStorage.setItem(
      "vsbil_expires_at",
      String(
        session.expiresAt
      )
    );
  }
  if (
    session.expiresIn !==
      undefined &&
    session.expiresIn !==
      null
  ) {
    localStorage.setItem(
      "vsbil_expires_in",
      String(
        session.expiresIn
      )
    );
  }
  /*
   * User profile
   */
  localStorage.setItem(
    "vsbil_user",
    JSON.stringify(user)
  );
}
/* =========================================================
   LOGIN
   ========================================================= */
form?.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    showMessage("");
    /* =====================================================
       CHECK ELEMENTS
       ===================================================== */
    if (
      !emailInput ||
      !passwordInput ||
      !loginBtn
    ) {
      console.error(
        "Login form elements are missing."
      );
      return;
    }
    /* =====================================================
       FORM VALUES
       ===================================================== */
    const email =
      emailInput.value
        .trim()
        .toLowerCase();
    const password =
      passwordInput.value;
    /* =====================================================
       VALIDATION
       ===================================================== */
    if (
      !email ||
      !password
    ) {
      showMessage(
        "Please enter your email and password.",
        "error"
      );
      return;
    }
    if (
      password.length <
      8
    ) {
      showMessage(
        "Invalid email or password.",
        "error"
      );
      return;
    }
    /* =====================================================
       CLEAR ANY OLD SESSION
       ===================================================== */
    clearSession();
    /* =====================================================
       DISABLE BUTTON
       ===================================================== */
    loginBtn.disabled =
      true;
    loginBtn.textContent =
      "Signing in...";
    try {
      /* ===================================================
         LOGIN REQUEST
         =================================================== */
      const response =
        await fetch(
          "/api/auth/login",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type":
                "application/json",
              "Accept":
                "application/json"
            },
            body:
              JSON.stringify({
                email,
                password
              })
          }
        );
      /* ===================================================
         PARSE RESPONSE
         =================================================== */
      const data =
        await response
          .json()
          .catch(() => null);
      /* ===================================================
         SERVER ERROR
         =================================================== */
      if (
        !response.ok ||
        !data?.success
      ) {
        /*
         * Account exists but has not
         * completed activation.
         */
        if (
          data?.code ===
          "ACCOUNT_NOT_ACTIVE"
        ) {
          if (
            data.user?.id
          ) {
            localStorage.setItem(
              "vsbil_pending_user_id",
              data.user.id
            );
          }
          showMessage(
            data.message ||
              "Your account has not been activated yet.",
            "error"
          );
          /*
           * Send directly to activation.
           */
          setTimeout(
            () => {
              window.location.replace(
                "/activation.html"
              );
            },
            900
          );
          return;
        }
        throw new Error(
          data?.message ||
          "Invalid email or password."
        );
      }
      /* ===================================================
         EXTRACT SESSION
         =================================================== */
      const session =
        data.session;
      const user =
        data.user;
      if (!session) {
        console.error(
          "Login response has no session:",
          data
        );
        throw new Error(
          "Login session was not created."
        );
      }
      if (
        !session.accessToken ||
        !session.refreshToken
      ) {
        console.error(
          "Incomplete authentication session:",
          session
        );
        throw new Error(
          "Login session is incomplete."
        );
      }
      if (!user?.id) {
        console.error(
          "Login response has no user:",
          data
        );
        throw new Error(
          "Unable to load your account."
        );
      }
      /* ===================================================
         ACCOUNT STATUS
         =================================================== */
      const accountStatus =
        String(
          user.status || ""
        ).toLowerCase();
      if (
        accountStatus !==
        "active"
      ) {
        localStorage.setItem(
          "vsbil_pending_user_id",
          user.id
        );
        showMessage(
          "Your account has not been activated yet.",
          "error"
        );
        setTimeout(
          () => {
            window.location.replace(
              "/activation.html"
            );
          },
          900
        );
        return;
      }
      /* ===================================================
         STORE SESSION
         =================================================== */
      storeSession(
        session,
        user
      );
      /*
       * Remove old activation marker.
       */
      localStorage.removeItem(
        "vsbil_pending_user_id"
      );
      /* ===================================================
         FINAL SESSION CHECK
         =================================================== */
      const accessToken =
        localStorage.getItem(
          "vsbil_access_token"
        );
      if (!accessToken) {
        clearSession();
        throw new Error(
          "Authentication session could not be saved."
        );
      }
      /* ===================================================
         SUCCESS
         =================================================== */
      showMessage(
        "Login successful. Opening your dashboard...",
        "success"
      );
      /* ===================================================
         REDIRECT
         =================================================== */
      setTimeout(
        () => {
          window.location.replace(
            "/dashboard.html"
          );
        },
        500
      );
    } catch (error) {
      console.error(
        "Login error:",
        error
      );
      /*
       * Never leave a partially-created
       * authentication session behind.
       */
      clearSession();
      showMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
        "error"
      );
    } finally {
      loginBtn.disabled =
        false;
      loginBtn.textContent =
        "Login";
    }
  }
);