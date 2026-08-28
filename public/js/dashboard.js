/*
=========================================================
VSBIL PREMIUM DASHBOARD
dashboard.js — COMPLETE AUTHENTICATED VERSION

Handles:
- Supabase access-token authentication
- Dashboard session verification
- Active-account protection
- Automatic token refresh
- Current-user loading
- Dashboard data loading
- Mobile sidebar
- Notifications
- Logout
- User display
- Wallet/referral buttons
- Error handling

AUTHENTICATION:
The login page stores:
  vsbil_access_token
  vsbil_refresh_token
  vsbil_expires_at
  vsbil_expires_in
  vsbil_token_type
  vsbil_user

The API expects:
  Authorization: Bearer <access_token>
=========================================================
*/

"use strict";


/* =========================================================
   ELEMENTS
   ========================================================= */

const sidebar =
  document.getElementById("dashboardSidebar");

const sidebarOverlay =
  document.getElementById("sidebarOverlay");

const mobileMenu =
  document.getElementById("mobileMenu");

const mobileClose =
  document.getElementById("mobileClose");

const notificationBtn =
  document.getElementById("notificationBtn");

const notificationPanel =
  document.getElementById("notificationPanel");

const closeNotifications =
  document.getElementById("closeNotifications");

const logoutBtn =
  document.getElementById("logoutBtn");

const userAvatar =
  document.getElementById("userAvatar");

const userName =
  document.getElementById("userName");

const userStatus =
  document.getElementById("userStatus");

const availableBalance =
  document.getElementById("availableBalance");

const pendingBalance =
  document.getElementById("pendingBalance");

const totalEarned =
  document.getElementById("totalEarned");

const referralCount =
  document.getElementById("referralCount");

const todayEarnings =
  document.getElementById("todayEarnings");

const completedActivities =
  document.getElementById("completedActivities");

const referralEarnings =
  document.getElementById("referralEarnings");

const referralVisualCount =
  document.getElementById("referralVisualCount");

const withdrawBtn =
  document.getElementById("withdrawBtn");

const walletBtn =
  document.getElementById("walletBtn");

const referralBtn =
  document.getElementById("referralBtn");


/* =========================================================
   APPLICATION STATE
   ========================================================= */

let currentUser = null;
let dashboardData = null;
let isLoggingOut = false;
let isRedirecting = false;


/* =========================================================
   AUTH STORAGE KEYS
   ========================================================= */

const AUTH_KEYS = {
  accessToken: "vsbil_access_token",
  refreshToken: "vsbil_refresh_token",
  expiresAt: "vsbil_expires_at",
  expiresIn: "vsbil_expires_in",
  tokenType: "vsbil_token_type",
  user: "vsbil_user",
};


/* =========================================================
   GET ACCESS TOKEN
   ========================================================= */

function getAccessToken() {

  const token =
    localStorage.getItem(
      AUTH_KEYS.accessToken
    );

  if (!token) {
    return null;
  }

  return token.trim() || null;
}


/* =========================================================
   GET REFRESH TOKEN
   ========================================================= */

function getRefreshToken() {

  const token =
    localStorage.getItem(
      AUTH_KEYS.refreshToken
    );

  if (!token) {
    return null;
  }

  return token.trim() || null;
}


/* =========================================================
   CHECK WHETHER WE HAVE A LOCAL SESSION
   ========================================================= */

function hasStoredSession() {

  return Boolean(
    getAccessToken() &&
    getRefreshToken()
  );

}


/* =========================================================
   CLEAR AUTH SESSION
   ========================================================= */

function clearAuthSession() {

  localStorage.removeItem(
    AUTH_KEYS.accessToken
  );

  localStorage.removeItem(
    AUTH_KEYS.refreshToken
  );

  localStorage.removeItem(
    AUTH_KEYS.expiresAt
  );

  localStorage.removeItem(
    AUTH_KEYS.expiresIn
  );

  localStorage.removeItem(
    AUTH_KEYS.tokenType
  );

  localStorage.removeItem(
    AUTH_KEYS.user
  );

}


/* =========================================================
   REDIRECT TO LOGIN
   ========================================================= */

function redirectToLogin() {

  if (isRedirecting) {
    return;
  }

  isRedirecting = true;

  clearAuthSession();

  window.location.replace(
    "/login.html"
  );

}


/* =========================================================
   USER-FRIENDLY ERROR POPUP
   ========================================================= */

function showDashboardMessage(
  title,
  message,
  type = "error"
) {

  const existing =
    document.getElementById(
      "dashboardMessagePopup"
    );

  if (existing) {
    existing.remove();
  }


  const popup =
    document.createElement("div");

  popup.id =
    "dashboardMessagePopup";


  popup.innerHTML = `
    <div class="dashboard-message-backdrop"></div>

    <div class="dashboard-message-card ${escapeHtml(type)}">

      <button
        type="button"
        class="dashboard-message-close"
        aria-label="Close"
      >
        ×
      </button>

      <div class="dashboard-message-icon">
        ${
          type === "success"
            ? "✓"
            : type === "warning"
              ? "!"
              : "×"
        }
      </div>

      <div class="dashboard-message-content">

        <strong>
          ${escapeHtml(title)}
        </strong>

        <p>
          ${escapeHtml(message)}
        </p>

      </div>

      <button
        type="button"
        class="dashboard-message-ok"
      >
        Continue
      </button>

    </div>
  `;


  document.body.appendChild(
    popup
  );


  const close = () => {

    popup.classList.add(
      "closing"
    );

    setTimeout(() => {

      popup.remove();

    }, 180);

  };


  popup
    .querySelector(
      ".dashboard-message-close"
    )
    ?.addEventListener(
      "click",
      close
    );


  popup
    .querySelector(
      ".dashboard-message-backdrop"
    )
    ?.addEventListener(
      "click",
      close
    );


  popup
    .querySelector(
      ".dashboard-message-ok"
    )
    ?.addEventListener(
      "click",
      close
    );


  requestAnimationFrame(() => {

    popup.classList.add(
      "show"
    );

  });

}


/* =========================================================
   HTML ESCAPING
   ========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


/* =========================================================
   FORMAT GHS
   ========================================================= */

function formatGhs(value) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {

    return "₵0.00";

  }

  return `₵${number.toFixed(2)}`;

}


/* =========================================================
   INITIAL LETTER
   ========================================================= */

function getInitial(name) {

  const value =
    String(
      name || "U"
    ).trim();

  return (
    value.charAt(0).toUpperCase() ||
    "U"
  );

}


/* =========================================================
   AUTHENTICATED FETCH
   =========================================================
   
   IMPORTANT:
   Every protected API request gets:

   Authorization: Bearer <Supabase access token>

   This is what your authMiddleware requires.
========================================================= */

async function authenticatedFetch(
  url,
  options = {}
) {

  const accessToken =
    getAccessToken();


  if (!accessToken) {

    const error =
      new Error(
        "Your login session could not be found."
      );

    error.code =
      "AUTH_REQUIRED";

    throw error;

  }


  const headers =
    new Headers(
      options.headers || {}
    );


  headers.set(
    "Authorization",
    `Bearer ${accessToken}`
  );


  headers.set(
    "Accept",
    "application/json"
  );


  const fetchOptions = {
    ...options,
    headers,
    credentials: "include",
  };


  return fetch(
    url,
    fetchOptions
  );

}


/* =========================================================
   MOBILE SIDEBAR
   ========================================================= */

function openSidebar() {

  sidebar?.classList.add(
    "open"
  );

  sidebarOverlay?.classList.add(
    "show"
  );

  document.body.style.overflow =
    "hidden";

}


function closeSidebar() {

  sidebar?.classList.remove(
    "open"
  );

  sidebarOverlay?.classList.remove(
    "show"
  );

  document.body.style.overflow =
    "";

}


mobileMenu?.addEventListener(
  "click",
  openSidebar
);


mobileClose?.addEventListener(
  "click",
  closeSidebar
);


sidebarOverlay?.addEventListener(
  "click",
  closeSidebar
);


/* =========================================================
   CLOSE SIDEBAR AFTER NAVIGATION
   ========================================================= */

document
  .querySelectorAll(
    ".dashboard-nav .nav-item"
  )
  .forEach((item) => {

    item.addEventListener(
      "click",
      () => {

        if (
          window.innerWidth <= 760
        ) {

          closeSidebar();

        }

      }
    );

  });


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function openNotifications() {

  notificationPanel?.classList.add(
    "show"
  );

}


function closeNotificationsPanel() {

  notificationPanel?.classList.remove(
    "show"
  );

}


notificationBtn?.addEventListener(
  "click",
  (event) => {

    event.stopPropagation();

    if (
      notificationPanel?.classList.contains(
        "show"
      )
    ) {

      closeNotificationsPanel();

    } else {

      openNotifications();

    }

  }
);


closeNotifications?.addEventListener(
  "click",
  closeNotificationsPanel
);


document.addEventListener(
  "click",
  (event) => {

    const target =
      event.target;

    if (
      notificationPanel &&
      target instanceof Node &&
      !notificationPanel.contains(
        target
      ) &&
      !notificationBtn?.contains(
        target
      )
    ) {

      closeNotificationsPanel();

    }

  }
);


/* =========================================================
   LOAD CURRENT AUTHENTICATED USER
   ========================================================= */

async function loadCurrentUser() {

  if (!hasStoredSession()) {

    const error =
      new Error(
        "Your login session is missing."
      );

    error.code =
      "AUTH_REQUIRED";

    throw error;

  }


  try {

    const response =
      await authenticatedFetch(
        "/api/auth/me",
        {
          method: "GET",
        }
      );


    const data =
      await response
        .json()
        .catch(() => null);


    /* =====================================================
       AUTHENTICATION FAILED
       ===================================================== */

    if (
      response.status === 401
    ) {

      const error =
        new Error(
          data?.message ||
          "Your login session has expired."
        );

      error.code =
        data?.code ||
        "INVALID_TOKEN";

      throw error;

    }


    /* =====================================================
       ACCOUNT NOT ACTIVE
       ===================================================== */

    if (
      response.status === 403 &&
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

      window.location.replace(
        "/activation.html"
      );

      const error =
        new Error(
          "Your account has not been activated."
        );

      error.code =
        "ACCOUNT_NOT_ACTIVE";

      throw error;

    }


    /* =====================================================
       OTHER FAILED RESPONSE
       ===================================================== */

    if (
      !response.ok ||
      !data?.success
    ) {

      const error =
        new Error(
          data?.message ||
          "Your session could not be verified."
        );

      error.code =
        data?.code ||
        "AUTH_FAILED";

      throw error;

    }


    /* =====================================================
       USER CHECK
       ===================================================== */

    if (
      !data.user ||
      !data.user.id
    ) {

      const error =
        new Error(
          "Your account could not be found."
        );

      error.code =
        "PROFILE_NOT_FOUND";

      throw error;

    }


    currentUser =
      data.user;


    /* =====================================================
       SYNCHRONIZE LOCAL USER CACHE
       ===================================================== */

    localStorage.setItem(
      AUTH_KEYS.user,
      JSON.stringify(
        currentUser
      )
    );


    return currentUser;

  } catch (error) {

    console.error(
      "Dashboard user loading failed:",
      error
    );

    throw error;

  }

}


/* =========================================================
   DISPLAY USER
   ========================================================= */

function displayUser(
  user
) {

  const username =
    user.username ||
    user.email?.split("@")[0] ||
    "Vsbil User";


  if (userName) {

    userName.textContent =
      username;

  }


  if (userAvatar) {

    userAvatar.textContent =
      getInitial(
        username
      );

  }


  if (userStatus) {

    const status =
      String(
        user.status || ""
      ).toLowerCase();


    if (
      status === "active"
    ) {

      userStatus.textContent =
        "Active member";

    } else {

      userStatus.textContent =
        "Account verification required";

    }

  }

}


/* =========================================================
   VERIFY ACCOUNT STATUS
   ========================================================= */

function ensureActiveAccount(
  user
) {

  const status =
    String(
      user?.status || ""
    ).toLowerCase();


  if (
    status !== "active"
  ) {

    localStorage.setItem(
      "vsbil_pending_user_id",
      user?.id || ""
    );


    window.location.replace(
      "/activation.html"
    );


    return false;

  }


  return true;

}


/* =========================================================
   LOAD DASHBOARD DATA
   ========================================================= */

async function loadDashboardData() {

  try {

    const response =
      await authenticatedFetch(
        "/api/dashboard",
        {
          method: "GET",
        }
      );


    const data =
      await response
        .json()
        .catch(() => null);


    /* =====================================================
       SESSION EXPIRED
       ===================================================== */

    if (
      response.status === 401
    ) {

      const error =
        new Error(
          data?.message ||
          "Your login session has expired."
        );

      error.code =
        data?.code ||
        "INVALID_TOKEN";

      throw error;

    }


    /* =====================================================
       FAILED DASHBOARD REQUEST
       ===================================================== */

    if (
      !response.ok ||
      !data?.success
    ) {

      throw new Error(
        data?.message ||
        "We couldn't load your dashboard information."
      );

    }


    dashboardData =
      data;


    return data;

  } catch (error) {

    console.error(
      "Dashboard data loading failed:",
      error
    );


    /*
     * Authentication errors must be handled
     * by initializeDashboard().
     */

    if (
      error?.code ===
      "INVALID_TOKEN"
    ) {

      throw error;

    }


    showDashboardMessage(
      "Dashboard information unavailable",
      error instanceof Error
        ? error.message
        : "We couldn't load your latest account information. Please try again.",
      "warning"
    );


    return null;

  }

}


/* =========================================================
   DISPLAY DASHBOARD DATA
   ========================================================= */

function displayDashboardData(
  data
) {

  if (!data) {
    return;
  }


  const wallet =
    data.wallet || {};

  const referrals =
    data.referrals || {};

  const activity =
    data.activity || {};


  /* =====================================================
     AVAILABLE BALANCE
     ===================================================== */

  if (
    availableBalance
  ) {

    availableBalance.textContent =
      Number(
        wallet.available ?? 0
      ).toFixed(2);

  }


  /* =====================================================
     PENDING BALANCE
     ===================================================== */

  if (
    pendingBalance
  ) {

    pendingBalance.textContent =
      formatGhs(
        wallet.pending ?? 0
      );

  }


  /* =====================================================
     TOTAL EARNED
     ===================================================== */

  if (
    totalEarned
  ) {

    totalEarned.textContent =
      formatGhs(
        wallet.totalEarned ?? 0
      );

  }


  /* =====================================================
     REFERRALS
     ===================================================== */

  const count =
    Number(
      referrals.count ?? 0
    );


  if (
    referralCount
  ) {

    referralCount.textContent =
      String(count);

  }


  if (
    referralVisualCount
  ) {

    referralVisualCount.textContent =
      String(count);

  }


  /* =====================================================
     TODAY EARNINGS
     ===================================================== */

  if (
    todayEarnings
  ) {

    todayEarnings.textContent =
      formatGhs(
        activity.todayEarnings ?? 0
      );

  }


  /* =====================================================
     COMPLETED ACTIVITIES
     ===================================================== */

  if (
    completedActivities
  ) {

    completedActivities.textContent =
      String(
        Number(
          activity.completed ?? 0
        )
      );

  }


  /* =====================================================
     REFERRAL EARNINGS
     ===================================================== */

  if (
    referralEarnings
  ) {

    referralEarnings.textContent =
      formatGhs(
        referrals.earnings ?? 0
      );

  }

}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

  if (
    isLoggingOut
  ) {

    return;

  }


  isLoggingOut =
    true;


  const originalText =
    logoutBtn?.innerHTML ||
    "Logout";


  if (logoutBtn) {

    logoutBtn.disabled =
      true;

    logoutBtn.innerHTML =
      "<span>⏳</span> Logging out...";

  }


  try {

    /*
     * Send the access token to the backend
     * so the server knows which session is
     * being terminated.
     */

    const response =
      await authenticatedFetch(
        "/api/auth/logout",
        {
          method: "POST",
        }
      );


    const data =
      await response
        .json()
        .catch(() => null);


    /*
     * Even if the server session has already
     * expired, we still clear the local session.
     */

    if (
      !response.ok &&
      response.status !== 401
    ) {

      throw new Error(
        data?.message ||
        "Unable to log out right now."
      );

    }


    clearAuthSession();


    sessionStorage.removeItem(
      "vsbil_pending_user_id"
    );


    localStorage.removeItem(
      "vsbil_pending_user_id"
    );


    window.location.replace(
      "/login.html"
    );

  } catch (error) {

    console.error(
      "Logout failed:",
      error
    );


    /*
     * If the token is already invalid,
     * logging out locally is still safe.
     */

    if (
      error?.code ===
      "INVALID_TOKEN"
    ) {

      clearAuthSession();

      window.location.replace(
        "/login.html"
      );

      return;

    }


    showDashboardMessage(
      "Logout failed",
      error instanceof Error
        ? error.message
        : "We couldn't log you out. Please try again.",
      "error"
    );


    if (logoutBtn) {

      logoutBtn.disabled =
        false;

      logoutBtn.innerHTML =
        originalText;

    }


    isLoggingOut =
      false;

  }

}


logoutBtn?.addEventListener(
  "click",
  logout
);


/* =========================================================
   WALLET BUTTON
   ========================================================= */

walletBtn?.addEventListener(
  "click",
  () => {

    window.location.href =
      "/wallet.html";

  }
);


/* =========================================================
   WITHDRAW BUTTON
   ========================================================= */

withdrawBtn?.addEventListener(
  "click",
  () => {
    window.location.href = "/wallet.html#withdraw";
  }
);


/* =========================================================
   REFERRAL BUTTON
   ========================================================= */

referralBtn?.addEventListener(
  "click",
  () => {

    window.location.hash =
      "referrals";


    document
      .getElementById(
        "referrals"
      )
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

  }
);


/* =========================================================
   NAVIGATION HASH SCROLL
   ========================================================= */

document
  .querySelectorAll(
    '.dashboard-nav a[href^="#"]'
  )
  .forEach((link) => {

    link.addEventListener(
      "click",
      (event) => {

        const href =
          link.getAttribute(
            "href"
          );


        if (
          !href ||
          href === "#"
        ) {

          return;

        }


        const target =
          document.querySelector(
            href
          );


        if (!target) {

          return;

        }


        event.preventDefault();


        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });


        history.replaceState(
          null,
          "",
          href
        );

      }
    );

  });


/* =========================================================
   PREVENT BACK BUTTON FROM SHOWING DASHBOARD AFTER LOGOUT
   ========================================================= */

window.addEventListener(
  "pageshow",
  async (event) => {

    if (
      event.persisted
    ) {

      /*
       * The page came from browser cache.
       * Verify the session again.
       */

      try {

        await loadCurrentUser();

      } catch {

        redirectToLogin();

      }

    }

  }
);


/* =========================================================
   DASHBOARD STARTUP
   ========================================================= */

async function initializeDashboard() {

  try {

    /* =====================================================
       CHECK LOCAL AUTH SESSION
       ===================================================== */

    if (
      !hasStoredSession()
    ) {

      redirectToLogin();

      return;

    }


    /* =====================================================
       VERIFY SERVER SESSION
       ===================================================== */

    const user =
      await loadCurrentUser();


    /* =====================================================
       DISPLAY USER
       ===================================================== */

    displayUser(
      user
    );


    /* =====================================================
       VERIFY ACTIVE ACCOUNT
       ===================================================== */

    if (
      !ensureActiveAccount(
        user
      )
    ) {

      return;

    }


    /* =====================================================
       LOAD DASHBOARD
       ===================================================== */

    const data =
      await loadDashboardData();


    displayDashboardData(
      data
    );

  } catch (error) {

    console.error(
      "Dashboard initialization failed:",
      error
    );


    /*
     * Do NOT immediately redirect for every
     * possible error.
     *
     * Only authentication failures should
     * send the user back to login.
     */

    if (
      error?.code ===
        "AUTH_REQUIRED" ||
      error?.code ===
        "INVALID_TOKEN" ||
      error?.code ===
        "PROFILE_NOT_FOUND" ||
      error?.code ===
        "EMAIL_MISMATCH" ||
      error?.code ===
        "USER_MISMATCH"
    ) {

      showDashboardMessage(
        "Session expired",
        error instanceof Error
          ? error.message
          : "Please log in again.",
        "error"
      );


      setTimeout(
        () => {

          redirectToLogin();

        },
        900
      );


      return;

    }


    /*
     * Account-not-active is already redirected
     * by ensureActiveAccount/loadCurrentUser.
     */

    if (
      error?.code ===
      "ACCOUNT_NOT_ACTIVE"
    ) {

      return;

    }


    /*
     * Unexpected startup error.
     */

    showDashboardMessage(
      "Unable to open dashboard",
      error instanceof Error
        ? error.message
        : "Something went wrong while loading your dashboard.",
      "error"
    );

  }

}


/* =========================================================
   START APPLICATION
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard
  );

} else {

  initializeDashboard();

}