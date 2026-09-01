"use strict";
(function () {
  const root = document.createElement("div");
  root.id = "vsbil-app-shell";
  root.innerHTML = `
    <header class="vs-topbar">
      <button class="vs-menu" id="vsMenu" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
      <a class="vs-brand" href="/" aria-label="VSBIL home"><img src="/assets/vsbil-logo.svg" alt="VSBIL"><span>VSBIL</span></a>
      <div class="vs-search"><input id="vsSearch" type="search" placeholder="Search VSBIL" aria-label="Search VSBIL"></div>
      <div class="vs-actions"><a class="vs-icon" href="/discover.html" aria-label="Discover">⌕</a><a class="vs-icon" href="/notifications.html" aria-label="Notifications">♢</a><a class="vs-avatar" id="vsAvatar" href="/profile.html" aria-label="Your profile">U</a></div>
    </header>
    <div class="vs-layout">
      <aside class="vs-sidebar" id="vsSidebar">
        <nav class="vs-nav" aria-label="VSBIL navigation">
          <a data-nav="home" href="/"><b>⌂</b><span>Home</span></a>
          <a data-nav="discover" href="/discover.html"><b>◎</b><span>For You</span></a>
          <a data-nav="dashboard" href="/dashboard.html"><b>▦</b><span>Dashboard</span></a>
          <a data-nav="profile" href="/profile.html"><b>●</b><span>Profile</span></a>
          <div class="vs-divider"></div>
          <a data-nav="campaigns" href="/activities.html"><b>▶</b><span>Campaigns</span></a>
          <a data-nav="create-campaign" href="/creator.html"><b>＋</b><span>Create Campaign</span></a>
          <a data-nav="my-campaigns" href="/creator.html#mine"><b>▤</b><span>My Campaigns</span></a>
          <div class="vs-divider"></div>
          <a data-nav="shop" href="/shop.html"><b>◇</b><span>Shop</span></a>
          <a data-nav="business" href="/business.html"><b>▥</b><span>Business</span></a>
          <a data-nav="youtube" href="/settings.html#connections"><b>◉</b><span>YouTube</span></a>
          <a data-nav="whatsapp" href="/whatsapp-bot.html"><b>◌</b><span>WhatsApp</span></a>
          <a data-nav="messages" href="/messages.html"><b>✉</b><span>Messages</span></a>
          <a data-nav="notifications" href="/notifications.html"><b>♢</b><span>Notifications</span></a>
          <a data-nav="settings" href="/settings.html"><b>⚙</b><span>Settings</span></a>
        </nav>
        <div class="vs-side-note"><strong>Campaign center</strong><p>Discover available opportunities or create your own campaign.</p><a href="/creator.html" class="vs-side-cta">Create campaign</a></div>
      </aside>
      <div class="vs-main-slot"></div>
    </div>
    <nav class="vs-bottom" aria-label="Mobile navigation"><a data-nav="home" href="/"><b>⌂</b><span>Home</span></a><a data-nav="discover" href="/discover.html"><b>◎</b><span>Discover</span></a><a data-nav="campaigns" href="/activities.html"><b>▶</b><span>Campaigns</span></a><a data-nav="shop" href="/shop.html"><b>◇</b><span>Shop</span></a><a data-nav="profile" href="/profile.html"><b>●</b><span>Profile</span></a></nav>`;
  document.body.prepend(root);
  const slot = root.querySelector(".vs-main-slot");
  while (slot && root.nextSibling) slot.parentNode.insertBefore(root.nextSibling, slot);
  if (slot) slot.remove();
  const path = location.pathname.toLowerCase();
  let active = path.includes("activities") ? "campaigns" : path.includes("creator") ? (location.hash === "#mine" ? "my-campaigns" : "create-campaign") : path.includes("discover") ? "discover" : path.includes("dashboard") ? "dashboard" : path.includes("profile") ? "profile" : path.includes("shop") ? "shop" : path.includes("business") ? "business" : path.includes("whatsapp") ? "whatsapp" : path.includes("messages") ? "messages" : path.includes("notifications") ? "notifications" : path.includes("settings") ? "settings" : path.includes("youtube") ? "youtube" : "home";
  document.querySelectorAll("[data-nav]").forEach(a => { if (a.dataset.nav === active) a.classList.add("active"); });
  const menu = document.getElementById("vsMenu"), sidebar = document.getElementById("vsSidebar");
  if (menu && sidebar) menu.addEventListener("click", () => { const open = sidebar.classList.toggle("open"); menu.setAttribute("aria-expanded", String(open)); });
  document.querySelectorAll(".vs-sidebar a").forEach(a => a.addEventListener("click", () => { sidebar?.classList.remove("open"); menu?.setAttribute("aria-expanded", "false"); }));
  if (localStorage.getItem("vsbil_access_token") && window.VSBIL_AUTH?.api) window.VSBIL_AUTH.api("/api/users/profile").then(d => { const u=d.user||{}, a=document.getElementById("vsAvatar"); if(a) a.innerHTML=u.avatar_url?`<img src="${String(u.avatar_url).replace(/\"/g,"&quot;")}" alt="Profile">`:String(u.username||"U").slice(0,1).toUpperCase(); }).catch(()=>{});
  const search=document.getElementById("vsSearch"); if(search) search.addEventListener("keydown",e=>{if(e.key==="Enter"&&search.value.trim()) location.href=`/discover.html?q=${encodeURIComponent(search.value.trim())}`});
})();
