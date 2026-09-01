"use strict";
(function () {
  /*
   * VSBIL GLOBAL APP SHELL
   *
   * Bottom navigation is intentionally limited to its five destinations:
   * Home, Discover, Campaigns, Shop and Profile.
   * Those destinations are NOT duplicated in the desktop/mobile sidebar.
   * Business has its own dedicated Business Suite shell and does not load
   * this file.
   */
  if (document.body?.dataset?.vsbilShell === "business") return;
  if (document.getElementById("vsbil-app-shell")) return;

  /* Remove legacy page-level navigation before installing the one global shell. */
  document.querySelectorAll(
    "body > header.header, body > header.topbar, body > header.site-header, body > .topbar"
  ).forEach((node) => node.remove());

  const legacySidebars = document.querySelectorAll(
    "body > .app > .shell > aside.sidebar, body > .layout > aside.sidebar"
  );
  legacySidebars.forEach((node) => node.remove());

  /* Dashboard previously owned a complete .app/.shell navigation frame. */
  const legacyDashboard = document.querySelector("body > .app");
  if (legacyDashboard) {
    const oldShell = legacyDashboard.querySelector(":scope > .shell");
    const main = oldShell?.querySelector(":scope > main");
    if (main) {
      document.body.insertBefore(main, legacyDashboard);
      legacyDashboard.remove();
    }
  }

  const root = document.createElement("div");
  root.id = "vsbil-app-shell";
  root.innerHTML = `
<header class="vs-topbar">
  <button class="vs-menu" id="vsMenu" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
  <a class="vs-brand" href="/" aria-label="VSBIL home">
    <img src="/assets/vsbil-logo.svg" alt="VSBIL">
    <span>VSBIL</span>
  </a>
  <div class="vs-search">
    <input id="vsSearch" type="search" placeholder="Search VSBIL" aria-label="Search VSBIL">
  </div>
  <div class="vs-actions">
    <a class="vs-icon" href="/notifications.html" aria-label="Notifications">♢</a>
    <a class="vs-avatar" id="vsAvatar" href="/profile.html" aria-label="Your profile">U</a>
  </div>
</header>
<div class="vs-layout">
  <aside class="vs-sidebar" id="vsSidebar">
    <nav class="vs-nav" aria-label="VSBIL navigation">
      <div class="vs-nav-section">WORKSPACE</div>
      <a data-nav="dashboard" href="/dashboard.html"><b>▦</b><span>Dashboard</span></a>
      <a data-nav="create-campaign" href="/creator.html"><b>＋</b><span>Create Campaign</span></a>
      <a data-nav="my-campaigns" href="/creator.html#mine"><b>▤</b><span>My Campaigns</span></a>
      <div class="vs-divider"></div>
      <div class="vs-nav-section">SERVICES</div>
      <a data-nav="business" href="/business.html"><b>▥</b><span>Business</span></a>
      <a data-nav="youtube" href="/settings.html#connections"><b>◉</b><span>YouTube</span></a>
      <a data-nav="whatsapp" href="/whatsapp-bot.html"><b>◌</b><span>WhatsApp</span></a>
      <a data-nav="messages" href="/messages.html"><b>✉</b><span>Messages</span></a>
      <div class="vs-divider"></div>
      <div class="vs-nav-section">ACCOUNT</div>
      <a data-nav="notifications" href="/notifications.html"><b>♢</b><span>Notifications</span></a>
      <a data-nav="earnings" href="/earnings.html"><b>₵</b><span>Earnings</span></a>
      <a data-nav="settings" href="/settings.html"><b>⚙</b><span>Settings</span></a>
      <a data-nav="support" href="/support.html"><b>?</b><span>Support</span></a>
    </nav>
    <div class="vs-side-note">
      <strong>VSBIL</strong>
      <p>Use the sidebar for workspace tools. Your primary navigation stays at the bottom on mobile.</p>
      <a href="/support.html" class="vs-side-cta">Get support</a>
    </div>
  </aside>
  <main class="vs-main-slot"></main>
</div>
<nav class="vs-bottom" aria-label="Primary navigation">
  <a data-nav="home" href="/"><b>⌂</b><span>Home</span></a>
  <a data-nav="discover" href="/discover.html"><b>◎</b><span>Discover</span></a>
  <a data-nav="campaigns" href="/activities.html"><b>▶</b><span>Campaigns</span></a>
  <a data-nav="shop" href="/shop.html"><b>◇</b><span>Shop</span></a>
  <a data-nav="profile" href="/profile.html"><b>●</b><span>Profile</span></a>
</nav>`;

  const firstContent = Array.from(document.body.children).find((node) => node !== root && node.tagName !== "SCRIPT");
  document.body.prepend(root);
  const slot = root.querySelector(".vs-main-slot");
  if (slot && firstContent && firstContent !== root) slot.replaceWith(firstContent);

  const path = location.pathname.toLowerCase();
  let active = "home";
  if (path.includes("activities")) active = "campaigns";
  else if (path.includes("creator")) active = location.hash === "#mine" ? "my-campaigns" : "create-campaign";
  else if (path.includes("dashboard")) active = "dashboard";
  else if (path.includes("business")) active = "business";
  else if (path.includes("whatsapp")) active = "whatsapp";
  else if (path.includes("messages")) active = "messages";
  else if (path.includes("notifications")) active = "notifications";
  else if (path.includes("earnings")) active = "earnings";
  else if (path.includes("settings")) active = "settings";
  else if (path.includes("support") || path.includes("appeal")) active = "support";
  else if (path.includes("profile")) active = "profile";
  else if (path.includes("discover")) active = "discover";
  else if (path.includes("shop")) active = "shop";

  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === active) link.classList.add("active");
  });

  const menu = document.getElementById("vsMenu");
  const sidebar = document.getElementById("vsSidebar");
  if (menu && sidebar) {
    menu.addEventListener("click", () => {
      const open = sidebar.classList.toggle("open");
      menu.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (event) => {
      if (!sidebar.classList.contains("open")) return;
      const target = event.target;
      if (target instanceof Node && !sidebar.contains(target) && !menu.contains(target)) {
        sidebar.classList.remove("open");
        menu.setAttribute("aria-expanded", "false");
      }
    });
    sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      sidebar.classList.remove("open");
      menu.setAttribute("aria-expanded", "false");
    }));
  }

  const cached = (() => {
    try { return JSON.parse(localStorage.getItem("vsbil_user") || "null"); }
    catch { return null; }
  })();

  function safeAvatarUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, location.origin);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      return url.href;
    } catch { return ""; }
  }

  function renderAvatar(user) {
    const avatar = document.getElementById("vsAvatar");
    if (!avatar) return;
    const imageUrl = safeAvatarUrl(user?.avatar_url || user?.avatarUrl || user?.profile_picture_url);
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "Profile";
      img.loading = "eager";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        avatar.textContent = String(user?.username || "U").trim().slice(0, 1).toUpperCase() || "U";
      };
      avatar.replaceChildren(img);
      return;
    }
    avatar.textContent = String(user?.username || user?.email || "U").trim().slice(0, 1).toUpperCase() || "U";
  }

  renderAvatar(cached || {});

  /* Refresh the same profile avatar on every authenticated page. */
  if (localStorage.getItem("vsbil_access_token") && window.VSBIL_AUTH?.api) {
    window.VSBIL_AUTH.api("/api/users/profile")
      .then((data) => {
        const user = data?.user || {};
        try { localStorage.setItem("vsbil_user", JSON.stringify(user)); } catch {}
        renderAvatar(user);
      })
      .catch(() => {});
  }

  const search = document.getElementById("vsSearch");
  if (search) search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && search.value.trim()) {
      location.href = `/discover.html?q=${encodeURIComponent(search.value.trim())}`;
    }
  });

  /* Creator page: selecting an objective opens only that form. */
  if (path.includes("creator")) {
    document.querySelectorAll("[data-form-panel]").forEach((panel) => panel.classList.remove("selected"));
    document.addEventListener("click", (event) => {
      const target = event.target;
      const trigger = target instanceof Element ? target.closest("[data-open]") : null;
      if (!trigger) return;
      const action = trigger.getAttribute("data-open");
      document.querySelectorAll("[data-form-panel]").forEach((panel) => panel.classList.remove("selected"));
      document.querySelector(`[data-form-panel="${CSS.escape(action || "")}"]`)?.classList.add("selected");
    }, true);
    if (location.hash === "#mine") document.getElementById("mine")?.scrollIntoView({ block: "start" });
  }
})();
