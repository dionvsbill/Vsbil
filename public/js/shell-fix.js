(() => {
  "use strict";
  const p = location.pathname.replace(/\/+$/, "") || "/";
  const auth = /\/(login|register|activation|auth-callback)\.html$/i.test(p) || document.body?.classList.contains("auth-page");
  const business = p === "/business.html" || document.body?.classList.contains("business-page");
  if (auth || business) return;

  /* Never allow page-specific shells to compete with the global shell. */
  const removeLegacy = () => {
    document.querySelectorAll("body > header.header, body > header.topbar, body > header.navbar, body > .site-header, body > .public-header, body > .topbar").forEach(el => el.remove());
    document.querySelectorAll("body > .layout > aside.sidebar, body > .layout > aside.right, body > aside.sidebar, body > .app > .shell > aside.sidebar, body > .shell > aside.sidebar").forEach(el => el.remove());
  };
  removeLegacy();

  const token = (() => { try { return localStorage.getItem("vsbil_access_token")?.trim() || ""; } catch { return ""; } })();
  const cached = (() => { try { return JSON.parse(localStorage.getItem("vsbil_user") || "null"); } catch { return null; } })();
  const initials = u => String(u?.username || u?.email || "U").trim().slice(0, 1).toUpperCase() || "U";

  const putAvatar = (el, u) => {
    if (!el) return;
    const url = typeof u?.avatar_url === "string" ? u.avatar_url.trim() : "";
    const fallback = initials(u);
    if (!url) { el.textContent = fallback; return; }
    const img = document.createElement("img");
    img.src = url; img.alt = "Profile"; img.loading = "eager"; img.decoding = "async";
    img.onerror = () => { el.textContent = fallback; };
    el.replaceChildren(img);
  };

  const hydrate = u => {
    if (!u) return;
    putAvatar(document.getElementById("vsbilTopAvatar"), u);
    putAvatar(document.getElementById("vsbilSidebarAvatar"), u);
    if (p === "/profile.html") {
      putAvatar(document.getElementById("avatar"), u);
      putAvatar(document.getElementById("composerAvatar"), u);
      const name = document.getElementById("name"); if (name) name.textContent = u.username || u.email || "VSBIL user";
      const handle = document.getElementById("handle"); if (handle) handle.textContent = u.username ? `@${u.username}` : "";
      const bio = document.getElementById("bio"); if (bio) bio.textContent = u.bio || "Welcome to VSBIL.";
      const about = document.getElementById("aboutUsername"); if (about) about.textContent = u.username ? `@${u.username}` : "—";
      const visibility = document.getElementById("visibilitySummary"); if (visibility) visibility.textContent = u.account_visibility || "public";
      const program = document.getElementById("programSummary"); if (program) program.textContent = u.content_participant ? "Creator program" : "Standard account";
      const cover = document.getElementById("cover"); if (cover && u.cover_url) cover.style.backgroundImage = `url("${u.cover_url.replaceAll('"', '%22')}")`;
    }
    window.dispatchEvent(new CustomEvent("vsbil:user-ready", { detail: u }));
  };
  hydrate(cached);

  if (token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    fetch(`/api/users/profile?_shell=${Date.now()}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(r => r.json().catch(() => null))
      .then(d => { if (d?.user) { try { localStorage.setItem("vsbil_user", JSON.stringify(d.user)); } catch {} hydrate(d.user); } })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
})();