(() => {
  "use strict";
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const isProfile = path === "/profile.html";
  const isSettings = path === "/settings.html";
  if (!isProfile && !isSettings) return;

  const TOKEN_KEY = "vsbil_access_token";
  const USER_KEY = "vsbil_user";
  const token = () => localStorage.getItem(TOKEN_KEY)?.trim() || "";
  const cachedUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || "{}"); } catch { return {}; } };
  const $ = (id) => document.getElementById(id);
  const text = (id, value, fallback = "—") => { const e = $(id); if (e) e.textContent = value ?? fallback; };
  const initials = (name) => String(name || "U").trim().slice(0, 1).toUpperCase() || "U";

  async function api(url, options = {}) {
    const t = token();
    if (!t) throw new Error("Authentication required");
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${t}`);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const r = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok || d?.success === false) throw new Error(d?.message || `Request failed (${r.status})`);
    return d;
  }

  function loadScript(src) {
    return new Promise((resolve) => {
      if ([...document.scripts].some(s => s.src.includes(src))) return resolve();
      const s = document.createElement("script");
      s.src = `${src}?v=20260901-2`;
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  function saveUser(user) {
    try { localStorage.setItem(USER_KEY, JSON.stringify({ ...cachedUser(), ...user })); } catch {}
  }

  function avatar(el, user) {
    if (!el) return;
    const url = user?.avatar_url || user?.avatarUrl || user?.picture || user?.photo_url || null;
    if (url) el.innerHTML = `<img src="${String(url).replaceAll('"', '&quot;')}" alt="" loading="lazy">`;
    else el.textContent = initials(user?.username || user?.displayName);
  }

  function hydrateAvatars(user) {
    document.querySelectorAll("#avatar,#topAvatar,#composerAvatar,#avatarLink,.vsbil-top-avatar,.mini-avatar,.post-avatar").forEach(el => avatar(el, user));
  }

  function stopLoading() {
    document.querySelectorAll("#name,#bio,#accountIdentity,#creatorStatus,#securityActivity").forEach(el => {
      if (/^Loading|^Checking/.test(el.textContent.trim())) el.textContent = "Unable to load this information.";
    });
  }

  async function getMe() {
    const local = cachedUser();
    try {
      const d = await api("/api/auth/production/me");
      const u = d.user || {};
      saveUser(u);
      return { ...local, ...u };
    } catch {
      return local;
    }
  }

  async function fixProfile() {
    if (!token()) { location.replace("/login.html?returnTo=%2Fprofile.html"); return; }
    const local = await getMe();
    let profile = local;
    try {
      const d = await api(`/api/users/public/${encodeURIComponent(local.username || local.id)}`);
      profile = { ...profile, ...(d.user || {}) };
    } catch {}
    saveUser(profile);
    hydrateAvatars(profile);
    text("name", profile.username || profile.displayName || "VSBIL User");
    text("handle", profile.username ? `@${profile.username}${profile.role === "creator" ? " · Creator" : ""}` : "@user");
    text("bio", profile.bio || "Welcome to my VSBIL profile.");
    text("followers", profile.followers ?? 0, "0");
    text("following", profile.following ?? 0, "0");
    text("aboutUsername", profile.username || "—");
    text("memberSince", profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "—");
    text("aboutRole", profile.role || "member");
    text("aboutVisibility", profile.account_visibility || "public");
    text("aboutDiscoverable", profile.discoverable === false ? "No" : "Yes");
    text("aboutCreator", profile.content_participant ? "Active" : "Not enrolled");
    text("aboutBio", profile.bio || "No biography added yet.");
    text("visibilitySummary", profile.account_visibility || "public");
    text("programSummary", profile.content_participant ? "Active" : "Not enrolled");
    text("reachSummary", Number(profile.followers || 0) + Number(profile.following || 0));
    text("aboutEmailVerified", profile.email_verified_at ? "Verified" : "Not verified");
    text("aboutGoogleVerified", profile.google_verified_at ? "Verified" : "Not linked");
    text("aboutPhoneVerified", profile.phone_verified_at ? "Verified" : "Not verified");
    text("aboutLastActive", profile.last_active_at ? new Date(profile.last_active_at).toLocaleString() : "Not available");
    const cover = $("cover");
    if (cover && profile.cover_url) cover.style.backgroundImage = `url("${profile.cover_url.replaceAll('"', '%22')}")`;
    const feed = $("feed");
    if (feed && /Loading posts/i.test(feed.textContent || "")) {
      try {
        const p = await api(`/api/users/public/${encodeURIComponent(profile.username || profile.id)}/posts`);
        const posts = p.posts || [];
        text("postsCount", posts.length, "0");
        if (!posts.length) feed.innerHTML = '<div class="card empty"><strong>No public posts yet.</strong>Posts you publish will appear on your profile timeline.</div>';
      } catch { feed.innerHTML = '<div class="card empty"><strong>No posts available.</strong>There are no posts to display right now.</div>'; }
    }
  }

  function setSwitch(el, value) { if (!el) return; el.classList.toggle("on", !!value); el.setAttribute("aria-pressed", String(!!value)); }

  async function fixSettings() {
    if (!token()) { location.replace("/login.html?returnTo=%2Fsettings.html"); return; }
    await loadScript("/js/settings.js");
    const user = await getMe();
    hydrateAvatars(user);
    try {
      const d = await api("/api/users/profile");
      Object.assign(user, d.user || {});
      saveUser(user);
    } catch {}
    hydrateAvatars(user);
    text("accountIdentity", `${user.username || "VSBIL user"} • ${user.email || ""}`.trim());
    if ($("visibility")) $("visibility").value = user.account_visibility || "public";
    if ($("messages")) $("messages").value = user.allow_direct_messages || "everyone";
    setSwitch($("discoverable"), user.discoverable !== false);

    try {
      const d = await api("/api/social/settings");
      const s = d.settings || {};
      document.querySelectorAll("[data-social]").forEach(el => setSwitch(el, !!s[el.dataset.social]));
      ["theme","language","autoplay","video_quality","sensitive_content"].forEach(id => { if ($(id) && s[id] != null) $(id).value = s[id]; });
    } catch {
      document.querySelectorAll("[data-social]").forEach(el => setSwitch(el, false));
    }

    try {
      const d = await api("/api/creator-program/program");
      const joined = !!d.joined;
      text("creatorStatus", d.earningEligible ? "Active • eligible for creator earning features" : joined ? "Joined • activation/eligibility required" : d.activationRequired ? "Activate your account before joining" : "Not enrolled");
      if ($("creatorJoin")) $("creatorJoin").style.display = joined ? "none" : "inline-flex";
      if ($("creatorLeave")) $("creatorLeave").style.display = joined ? "inline-flex" : "none";
    } catch (e) { text("creatorStatus", e.message || "Creator program unavailable"); }

    try {
      const d = await api("/api/users/settings/security-activity");
      const e = $("securityActivity");
      if (e) e.innerHTML = (d.events || []).length ? d.events.slice(0, 20).map(x => `<div class="event"><strong>${String(x.event_type || "Security event")}</strong><br><small>${x.created_at ? new Date(x.created_at).toLocaleString() : ""}</small></div>`).join("") : "No recent security activity.";
    } catch { text("securityActivity", "No recent security activity."); }
  }

  document.addEventListener("click", async (event) => {
    const el = event.target.closest?.("[data-action]");
    if (!el || !isSettings) return;
    if (el.dataset.action === "youtube") { event.preventDefault(); location.assign("/api/youtube/connect"); }
    if (el.dataset.action === "security-activity") {
      event.preventDefault();
      try {
        const d = await api("/api/users/settings/security-activity");
        const e = $("securityActivity");
        if (e) e.innerHTML = (d.events || []).map(x => `<div class="event"><strong>${String(x.event_type || "Security event")}</strong><br><small>${x.created_at ? new Date(x.created_at).toLocaleString() : ""}</small></div>`).join("") || "No recent security activity.";
      } catch (x) { text("securityActivity", x.message); }
    }
  }, true);

  const boot = () => Promise.resolve().then(() => isProfile ? fixProfile() : fixSettings()).catch(err => { console.error("VSBIL profile/settings hydration", err); stopLoading(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
