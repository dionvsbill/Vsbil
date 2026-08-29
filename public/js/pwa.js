(() => {
  "use strict";

  const register = async () => {
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.info("[VSBIL] service worker ready", registration.scope);
    } catch (error) {
      console.warn("[VSBIL] service worker registration failed", error);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register, { once: true });
  } else {
    register();
  }
})();
