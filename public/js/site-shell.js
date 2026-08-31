(() => {
  "use strict";
  const LOGO = "/assets/vsbil-logo.svg";
  const FOOTER = "vsbilGlobalFooter";
  const LOADER = "vsbilPageLoader";
  const TOKEN_KEY = "vsbil_access_token";
  const path = () => window.location.pathname.replace(/\/+$/, "") || "/";
  const isAuthPage = () => /\/(login|register)\.html$/i.test(path()) || document.body?.classList.contains("auth-page");
  const isBusinessPage = () => path() === "/business.html" || document.body?.classList.contains("business-page");
  const hasSessionToken = () => { try { return Boolean(localStorage.getItem(TOKEN_KEY)?.trim()); } catch { return false; } };

  async function getSession() {
    try {
      const token = localStorage.getItem(TOKEN_KEY)?.trim();
      if (!token) return null;
      const r = await fetch("/api/auth/session", { method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json",Authorization:`Bearer ${token}`}, credentials:"same-origin", body:JSON.stringify({accessToken:token}) });
      const d = await r.json().catch(() => null);
      return r.ok && d?.success && d.user ? d.user : null;
    } catch { return null; }
  }
  async function routeAuthenticatedAuthPage() { if (!isAuthPage() || !hasSessionToken()) return; const user = await getSession(); if (user) location.replace(user.status === "active" ? "/dashboard.html" : "/activate.html"); }

  function removeDuplicatePageChrome() {
    if (isBusinessPage() || isAuthPage()) return;
    document.querySelectorAll("header.topbar, header.navbar, .site-header, .public-header").forEach((element) => element.remove());
    document.querySelectorAll(".vsbil-app-shell .sidebar, .vsbil-app-shell .side-nav, .vsbil-app-shell .dashboard-sidebar").forEach((element) => element.remove());
    document.querySelectorAll('a[href="/shop.html"],a[href="shop.html"]').forEach((a) => a.setAttribute("href", "/marketplace.html"));
    document.querySelectorAll('a[href="/youtube.html"],a[href="youtube.html"]').forEach((a) => a.setAttribute("href", "/discover.html"));
  }

  function loader() {
    if (document.getElementById(LOADER) || isAuthPage() || isBusinessPage()) return;
    const e = document.createElement("div"); e.id=LOADER; e.className="vsbil-page-loader"; e.setAttribute("aria-label","Loading VSBIL");
    e.innerHTML=`<div class="vsbil-loader-box"><div class="vsbil-loader-mark"><img class="vsbil-loader-logo" src="${LOGO}" alt="VSBIL logo"></div><div class="vsbil-loader-name">VSBIL</div><div class="vsbil-loader-label">BUILD • ENGAGE • GROW</div></div>`;
    document.body.prepend(e);
    const hide=()=>requestAnimationFrame(()=>setTimeout(()=>e.classList.add("is-hidden"),500));
    addEventListener("load",hide,{once:true}); setTimeout(hide,1200);
  }

  function navigation() {
    if (isAuthPage() || isBusinessPage() || document.getElementById("vsbilGlobalNavigation")) return;
    document.body.classList.add("vsbil-app-shell");
    const links=[
      ["⌂","Home","/"],["◎","For You","/discover.html"],["◈","Campaigns","/creator.html"],
      ["▤","Business","/business.html"],["◇","Shop","/marketplace.html"],["◉","WhatsApp","/whatsapp-bot.html"],
      ["✉","Messages","/messages.html"],["♢","Notifications","/notifications.html"],["▦","Dashboard","/dashboard.html"],["⚙","Settings","/settings.html"]
    ];
    const current=path();
    const active=href=>href==="/"?current==="/":current===href;
    const nav=links.map(([icon,label,href])=>`<a href="${href}" class="${active(href)?"active":""}"><b aria-hidden="true">${icon}</b><span>${label}</span></a>`).join("");
    const aside=document.createElement("aside"); aside.id="vsbilGlobalNavigation"; aside.className="vsbil-global-sidebar";
    aside.innerHTML=`<a class="vsbil-global-nav-brand" href="/" aria-label="VSBIL home"><img src="${LOGO}" alt="VSBIL"><span>VSBIL</span></a><nav aria-label="Primary navigation">${nav}</nav><div class="vsbil-sidebar-account">${hasSessionToken()?`<a href="/profile.html"><b>●</b><span>Profile</span></a><a href="/settings.html"><b>⚙</b><span>Settings</span></a>`:`<a href="/login.html"><b>→</b><span>Sign in</span></a><a href="/register.html"><b>＋</b><span>Create account</span></a>`}</div>`;
    document.body.prepend(aside);
    const top=document.createElement("header"); top.id="vsbilGlobalTopbar"; top.className="vsbil-global-topbar";
    top.innerHTML=`<a class="vsbil-mobile-brand" href="/"><img src="${LOGO}" alt="VSBIL"><span>VSBIL</span></a><label class="vsbil-global-search"><span>⌕</span><input id="vsbilGlobalSearch" type="search" placeholder="Search VSBIL" aria-label="Search VSBIL"></label><div class="vsbil-global-actions"><a href="/notifications.html" aria-label="Notifications">♢</a>${hasSessionToken()?`<a href="/profile.html" class="vsbil-top-avatar" aria-label="Profile">U</a>`:`<a href="/login.html" class="vsbil-signin">Sign in</a>`}</div>`;
    document.body.prepend(top);
    const search = top.querySelector("#vsbilGlobalSearch");
    search?.addEventListener("keydown", (event) => { if (event.key === "Enter") { const q = search.value.trim(); if (q) location.href = `/discover.html?q=${encodeURIComponent(q)}`; } });
    const bottom=document.createElement("nav"); bottom.id="vsbilGlobalBottomNav"; bottom.className="vsbil-global-bottom-nav"; bottom.setAttribute("aria-label","Mobile navigation");
    const mobile=[links[0],links[1],links[2],links[4],links[8]];
    bottom.innerHTML=mobile.map(([icon,label,href])=>`<a href="${href}" class="${active(href)?"active":""}"><b>${icon}</b><span>${label}</span></a>`).join("");
    document.body.appendChild(bottom);
    document.body.classList.add("vsbil-shared-shell");
  }

  function footer() {
    if (isAuthPage() || isBusinessPage() || document.getElementById(FOOTER) || document.querySelector("footer.site-footer")) return;
    const accountLinks=hasSessionToken()?`<a href="/dashboard.html">Dashboard</a><a href="/profile.html">Profile</a><a href="/earnings.html">Rewards &amp; Wallet</a><a href="/settings.html">Settings</a><a href="/security.html">Security</a>`:`<a href="/login.html">Login</a><a href="/register.html">Create Account</a>`;
    document.body.insertAdjacentHTML("beforeend",`<footer id="${FOOTER}" class="site-footer vsbil-global-footer"><div class="vsbil-footer-inner"><div class="vsbil-footer-grid"><div class="vsbil-footer-brand"><a class="vsbil-footer-brandmark" href="/"><img src="${LOGO}" alt=""><span>VSBIL</span></a><p>A modern platform for creators, communities, verified commerce and practical business tools.</p><div class="vsbil-footer-status"><span class="vsbil-status-dot"></span>Platform online</div></div><div class="vsbil-footer-col"><h4>Platform</h4><a href="/about.html">About VSBIL</a><a href="/social.html">Community</a><a href="/activities.html">Activities</a><a href="/creator.html">Creator Hub</a><a href="/faq.html">Help Center</a></div><div class="vsbil-footer-col"><h4>Business</h4><a href="/business.html">Business Suite</a><a href="/marketplace.html">Marketplace</a><a href="/shop-admin.html">Shop Manager</a><a href="/order-track.html">Order Tracking</a><a href="/whatsapp-bot.html">WhatsApp Automation</a><a href="/advertise.html">Advertising</a></div><div class="vsbil-footer-col"><h4>Account</h4>${accountLinks}</div><div class="vsbil-footer-col"><h4>Trust &amp; Support</h4><a href="/support.html">Support &amp; Reports</a><a href="/contact.html">Contact Us</a><a href="/legal.html">Trust Center</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/security.html">Security</a><a href="/community-guidelines.html">Community Guidelines</a><a href="/acceptable-use.html">Acceptable Use</a></div></div><div class="vsbil-footer-bottom"><span>© ${new Date().getFullYear()} VSBIL. All rights reserved.</span><span class="vsbil-footer-legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/cookie-policy.html">Cookies</a><a href="/data-rights.html">Data Rights</a></span></div></div></footer>`);
  }
  function boot(){ if(isAuthPage()){ routeAuthenticatedAuthPage(); return; } removeDuplicatePageChrome(); loader(); navigation(); footer(); document.documentElement.classList.add("vsbil-shell-ready"); }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot,{once:true}):boot();
})();
