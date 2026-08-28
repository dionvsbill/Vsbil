/* =========================================================
   VSBIL — PREMIUM ACTIVATION SYSTEM
   ========================================================= */
const activateBtn = document.getElementById("activateBtn");
const activationMessage =
  document.getElementById("activationMessage");
const activationIcon =
  document.getElementById("activationIcon");
const pendingUserId =
  sessionStorage.getItem("vsbil_pending_user_id");
/* =========================================================
   MODAL ELEMENTS
   ========================================================= */
const messageModal =
  document.getElementById("messageModal");
const messageBackdrop =
  document.getElementById("messageBackdrop");
const messageClose =
  document.getElementById("messageClose");
const messageIcon =
  document.getElementById("messageIcon");
const messageEyebrow =
  document.getElementById("messageEyebrow");
const messageTitle =
  document.getElementById("messageTitle");
const messageText =
  document.getElementById("messageText");
const messagePrimary =
  document.getElementById("messagePrimary");
const messageSecondary =
  document.getElementById("messageSecondary");
const messageHelp =
  document.getElementById("messageHelp");
const messageHelpBtn =
  document.getElementById("messageHelpBtn");
/* =========================================================
   DASHBOARD
   ========================================================= */
const DASHBOARD_URL = "/dashboard.html";
/* =========================================================
   STATE
   ========================================================= */
let verificationInProgress = false;
let paymentInitializationInProgress = false;
/* =========================================================
   UTILITY
   ========================================================= */
function setActivationMessage(text, type = "") {
  if (!activationMessage) return;
  activationMessage.textContent = text;
  activationMessage.className =
    "activation-note";
  if (type) {
    activationMessage.classList.add(type);
  }
}
/* =========================================================
   BUTTON LOADING STATE
   ========================================================= */
function setButtonLoading(loading, text = "Preparing payment...") {
  if (!activateBtn) return;
  if (loading) {
    activateBtn.disabled = true;
    activateBtn.classList.add("loading");
    const btnText =
      activateBtn.querySelector(".btn-text");
    if (btnText) {
      btnText.textContent = text;
    }
  } else {
    activateBtn.disabled = false;
    activateBtn.classList.remove("loading");
    const btnText =
      activateBtn.querySelector(".btn-text");
    if (btnText) {
      btnText.textContent =
        "Activate for GH₵50";
    }
  }
}
/* =========================================================
   MODAL
   ========================================================= */
function openMessage({
  type = "info",
  eyebrow = "VSBIL",
  title = "Important information",
  text = "",
  primaryText = "Continue",
  primaryAction = null,
  secondaryText = "",
  secondaryAction = null,
  showClose = true,
  showHelp = false,
}) {
  if (!messageModal) return;
  messageModal.classList.remove(
    "success",
    "error",
    "warning"
  );
  messageIcon?.classList.remove(
    "success",
    "error",
    "warning"
  );
  if (
    type === "success" ||
    type === "error" ||
    type === "warning"
  ) {
    messageIcon?.classList.add(type);
  }
  /* Icon */
  if (messageIcon) {
    if (type === "success") {
      messageIcon.textContent = "✓";
    } else if (type === "error") {
      messageIcon.textContent = "!";
    } else if (type === "warning") {
      messageIcon.textContent = "⚠";
    } else {
      messageIcon.textContent = "i";
    }
  }
  /* Text */
  if (messageEyebrow) {
    messageEyebrow.textContent =
      eyebrow;
  }
  if (messageTitle) {
    messageTitle.textContent =
      title;
  }
  if (messageText) {
    messageText.textContent =
      text;
  }
  /* Primary */
  if (messagePrimary) {
    messagePrimary.hidden = false;
    messagePrimary.textContent =
      primaryText;
    messagePrimary.onclick = () => {
      if (typeof primaryAction === "function") {
        primaryAction();
      } else {
        closeMessage();
      }
    };
  }
  /* Secondary */
  if (messageSecondary) {
    if (secondaryText) {
      messageSecondary.hidden = false;
      messageSecondary.textContent =
        secondaryText;
      messageSecondary.onclick = () => {
        if (
          typeof secondaryAction ===
          "function"
        ) {
          secondaryAction();
        }
      };
    } else {
      messageSecondary.hidden = true;
      messageSecondary.onclick = null;
    }
  }
  /* Close */
  if (messageClose) {
    messageClose.hidden = !showClose;
  }
  /* Help */
  if (messageHelp) {
    messageHelp.hidden = !showHelp;
  }
  /* Open */
  messageModal.classList.add("open");
  messageModal.setAttribute(
    "aria-hidden",
    "false"
  );
  /* Prevent background scrolling */
  document.body.style.overflow =
    "hidden";
}
function closeMessage() {
  if (!messageModal) return;
  messageModal.classList.remove("open");
  messageModal.setAttribute(
    "aria-hidden",
    "true"
  );
  document.body.style.overflow =
    "";
}
/* =========================================================
   MODAL EVENTS
   ========================================================= */
messageClose?.addEventListener(
  "click",
  closeMessage
);
messageBackdrop?.addEventListener(
  "click",
  closeMessage
);
messageHelpBtn?.addEventListener(
  "click",
  () => {
    openMessage({
      type: "info",
      eyebrow: "VSBIL SUPPORT",
      title: "Need help?",
      text:
        "Please contact Vsbil support and include your payment reference if you have one. Never share your password, card PIN or secret payment information.",
      primaryText: "Close",
      showHelp: false,
    });
  }
);
/* =========================================================
   ESC KEY
   ========================================================= */
document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Escape" &&
      messageModal?.classList.contains("open")
    ) {
      closeMessage();
    }
  }
);
/* =========================================================
   GET PAYMENT REFERENCE
   ========================================================= */
function getPaymentReference() {
  const params =
    new URLSearchParams(
      window.location.search
    );
  /*
   * Paystack normally returns:
   *
   * ?trxref=REFERENCE&reference=REFERENCE
   */
  const reference =
    params.get("reference");
  const trxref =
    params.get("trxref");
  return reference || trxref || null;
}
/* =========================================================
   VERIFY PAYMENT
   ========================================================= */
async function verifyPayment(reference) {
  if (!reference) return;
  if (verificationInProgress) return;
  verificationInProgress = true;
  /* Update page */
  if (activateBtn) {
    activateBtn.disabled = true;
    activateBtn.classList.add(
      "loading"
    );
    const btnText =
      activateBtn.querySelector(
        ".btn-text"
      );
    if (btnText) {
      btnText.textContent =
        "Verifying payment...";
    }
  }
  setActivationMessage(
    "Securely confirming your payment...",
    "warning"
  );
  /*
   * Important:
   *
   * The browser does NOT decide
   * whether the payment succeeded.
   *
   * Our backend asks Paystack.
   */
  try {
    const response =
      await fetch(
        `/api/payment/verify?reference=${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: {
            "Accept":
              "application/json",
          },
        }
      );
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The payment server returned an invalid response."
      );
    }
    /* -----------------------------------------
       SUCCESS
       ----------------------------------------- */
    if (
      response.ok &&
      data.success
    ) {
      setActivationMessage(
        "Payment confirmed. Your account is active.",
        "success"
      );
      if (activationIcon) {
        activationIcon.textContent =
          "✓";
      }
      /*
       * Remove the pending registration
       * marker because activation is complete.
       */
      sessionStorage.removeItem(
        "vsbil_pending_user_id"
      );
      openMessage({
        type: "success",
        eyebrow:
          "PAYMENT CONFIRMED",
        title:
          "Your account is active! 🎉",
        text:
          "Your GH₵50 activation payment has been verified successfully. Your Vsbil account is now active and ready to use.",
        primaryText:
          "Continue to Dashboard →",
        primaryAction:
          () => {
            window.location.href =
              DASHBOARD_URL;
          },
        showClose:
          false,
        showHelp:
          false,
      });
      return;
    }
    /* -----------------------------------------
       PAYMENT STILL PROCESSING
       ----------------------------------------- */
    if (
      data.status === "pending"
    ) {
      openMessage({
        type: "warning",
        eyebrow:
          "PAYMENT PROCESSING",
        title:
          "Your payment is still processing",
        text:
          "We haven't received final confirmation yet. Please don't make another payment. Wait a moment and try verifying again.",
        primaryText:
          "Check Again",
        primaryAction:
          () => {
            closeMessage();
            verificationInProgress =
              false;
            verifyPayment(reference);
          },
        secondaryText:
          "Return to Activation",
        secondaryAction:
          () => {
            closeMessage();
            verificationInProgress =
              false;
            setButtonLoading(
              false
            );
            setActivationMessage(
              "Your payment is still being processed.",
              "warning"
            );
          },
        showClose:
          true,
        showHelp:
          true,
      });
      return;
    }
    /* -----------------------------------------
       PAYMENT NOT COMPLETED
       ----------------------------------------- */
    if (
      data.message ===
      "Payment has not been completed"
    ) {
      openMessage({
        type: "warning",
        eyebrow:
          "PAYMENT NOT COMPLETED",
        title:
          "Payment wasn't completed",
        text:
          "The payment provider has not confirmed this transaction as successful. If you cancelled the payment, you can safely try again.",
        primaryText:
          "Try Again",
        primaryAction:
          () => {
            closeMessage();
            verificationInProgress =
              false;
            setButtonLoading(
              false
            );
            setActivationMessage(
              "You can try the activation payment again.",
              "warning"
            );
          },
        secondaryText:
          "Close",
        secondaryAction:
          () => {
            closeMessage();
            verificationInProgress =
              false;
            setButtonLoading(
              false
            );
          },
        showHelp:
          true,
      });
      return;
    }
    /* -----------------------------------------
       AMOUNT ERROR
       ----------------------------------------- */
    if (
      data.message ===
      "Payment amount is incorrect"
    ) {
      openMessage({
        type: "error",
        eyebrow:
          "PAYMENT ERROR",
        title:
          "Payment amount could not be confirmed",
        text:
          "The transaction amount does not match the Vsbil activation amount. Please do not make another payment. Contact support if money was deducted.",
        primaryText:
          "Close",
        primaryAction:
          () => {
            closeMessage();
            verificationInProgress =
              false;
          },
        showHelp:
          true,
      });
      return;
    }
    /* -----------------------------------------
       ACCOUNT MISMATCH
       ----------------------------------------- */
    if (
      data.message ===
      "Payment account mismatch"
    ) {
      openMessage({
        type: "error",
        eyebrow:
          "SECURITY CHECK",
        title:
          "We couldn't match this payment",
        text:
          "For your protection, Vsbil stopped the activation because the payment does not match this account. Please contact support before trying again.",
        primaryText:
          "Close",
        primaryAction:
          () => {
            closeMessage();
            verificationInProgress =
              false;
          },
        showHelp:
          true,
      });
      return;
    }
    /* -----------------------------------------
       UNKNOWN ERROR
       ----------------------------------------- */
    openMessage({
      type: "error",
      eyebrow:
        "VERIFICATION ERROR",
      title:
        "We couldn't confirm your payment",
      text:
        "Your payment may still be processing. Please don't pay again yet. Wait a moment and try again.",
      primaryText:
        "Try Again",
      primaryAction:
        () => {
          closeMessage();
          verificationInProgress =
            false;
          verifyPayment(reference);
        },
      secondaryText:
        "Return to Activation",
      secondaryAction:
        () => {
          closeMessage();
          verificationInProgress =
            false;
          setButtonLoading(
            false
          );
        },
      showHelp:
        true,
    });
  } catch (error) {
    console.error(
      "Payment verification error:",
      error
    );
    openMessage({
      type: "error",
      eyebrow:
        "CONNECTION PROBLEM",
      title:
        "We couldn't reach Vsbil",
      text:
        "We couldn't confirm your payment because of a connection problem. Your payment has not been assumed successful. Please check your connection and try again.",
      primaryText:
        "Try Again",
      primaryAction:
        () => {
          closeMessage();
          verificationInProgress =
            false;
          verifyPayment(reference);
        },
      secondaryText:
        "Close",
      secondaryAction:
        () => {
          closeMessage();
          verificationInProgress =
            false;
          setButtonLoading(
            false
          );
        },
      showHelp:
        true,
    });
  }
}
/* =========================================================
   INITIALIZE PAYMENT
   ========================================================= */
async function initializePayment() {
  if (!pendingUserId) {
    openMessage({
      type: "error",
      eyebrow:
        "REGISTRATION SESSION",
      title:
        "Your registration session expired",
      text:
        "We couldn't find the account information needed to start activation. Please register again to continue.",
      primaryText:
        "Register Again",
      primaryAction:
        () => {
          window.location.href =
            "/register.html";
        },
      secondaryText:
        "Go Home",
      secondaryAction:
        () => {
          window.location.href =
            "/";
        },
      showHelp:
        false,
    });
    return;
  }
  if (
    paymentInitializationInProgress
  ) {
    return;
  }
  paymentInitializationInProgress =
    true;
  setButtonLoading(
    true,
    "Preparing payment..."
  );
  setActivationMessage(
    "Connecting to secure payment...",
    "warning"
  );
  try {
    const response =
      await fetch(
        "/api/payment/initialize",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "Accept":
              "application/json",
            "Authorization":
              `Bearer ${localStorage.getItem("vsbil_access_token") || ""}`,
          },
          body: JSON.stringify({
            userId:
              pendingUserId,
          }),
        }
      );
    let data;
    try {
      data =
        await response.json();
    } catch {
      throw new Error(
        "The payment service returned an invalid response."
      );
    }
    if (
      !response.ok ||
      !data.success
    ) {
      /*
       * If the backend says an activation
       * payment is already pending, we can
       * still use its reference if available.
       */
      if (
        data.reference &&
        data.message ===
          "An activation payment is already pending"
      ) {
        openMessage({
          type: "warning",
          eyebrow:
            "PAYMENT ALREADY STARTED",
          title:
            "You already have a payment in progress",
          text:
            "An activation payment has already been created for this account. Please don't create another payment.",
          primaryText:
            "Check Payment",
          primaryAction:
            () => {
              closeMessage();
              paymentInitializationInProgress =
                false;
              verifyPayment(
                data.reference
              );
            },
          secondaryText:
            "Close",
          secondaryAction:
            () => {
              closeMessage();
              paymentInitializationInProgress =
                false;
              setButtonLoading(
                false
              );
            },
          showHelp:
            true,
        });
        return;
      }
      throw new Error(
        data.message ||
        "Unable to start payment."
      );
    }
    if (
      !data.authorizationUrl
    ) {
      throw new Error(
        "The payment provider did not return a checkout link."
      );
    }
    setActivationMessage(
      "Opening secure payment...",
      "success"
    );
    /*
     * Paystack checkout
     */
    window.location.href =
      data.authorizationUrl;
  } catch (error) {
    console.error(
      "Payment initialization error:",
      error
    );
    openMessage({
      type: "error",
      eyebrow:
        "PAYMENT UNAVAILABLE",
      title:
        "We couldn't start your payment",
      text:
        error instanceof Error &&
        error.message
          ? error.message
          : "We couldn't connect to the payment service. Please try again in a moment.",
      primaryText:
        "Try Again",
      primaryAction:
        () => {
          closeMessage();
          paymentInitializationInProgress =
            false;
          initializePayment();
        },
      secondaryText:
        "Close",
      secondaryAction:
        () => {
          closeMessage();
          paymentInitializationInProgress =
            false;
          setButtonLoading(
            false
          );
          setActivationMessage(
            "Ready for secure activation."
          );
        },
      showHelp:
        true,
    });
  }
}
/* =========================================================
   ACTIVATE BUTTON
   ========================================================= */
activateBtn?.addEventListener(
  "click",
  () => {
    if (
      paymentInitializationInProgress ||
      verificationInProgress
    ) {
      return;
    }
    initializePayment();
  }
);
/* =========================================================
   PAGE STARTUP
   ========================================================= */
(function initializeActivationPage() {
  /*
   * First priority:
   *
   * Did Paystack send us back with
   * a transaction reference?
   */
  const reference =
    getPaymentReference();
  if (reference) {
    /*
     * The user has returned from Paystack.
     * Automatically verify the payment.
     */
    verifyPayment(reference);
    return;
  }
  /*
   * No Paystack reference.
   *
   * Show normal activation state.
   */
  if (!pendingUserId) {
    setActivationMessage(
      "Your registration session could not be found.",
      "error"
    );
    if (activateBtn) {
      activateBtn.disabled = true;
    }
    /*
     * Don't silently leave the user
     * wondering what happened.
     */
    setTimeout(() => {
      openMessage({
        type: "error",
        eyebrow:
          "REGISTRATION SESSION",
        title:
          "We couldn't find your account session",
        text:
          "Your registration information is no longer available on this device. Please register again to continue.",
        primaryText:
          "Register Again",
        primaryAction:
          () => {
            window.location.href =
              "/register.html";
          },
        secondaryText:
          "Go Home",
        secondaryAction:
          () => {
            window.location.href =
              "/";
          },
        showHelp:
          false,
      });
    }, 350);
    return;
  }
  setActivationMessage(
    "Ready for secure activation."
  );
})();