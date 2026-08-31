(() => {
  "use strict";
  const LOGO = "/assets/vsbil-logo.svg";
  const FOOTER = "vsbilGlobalFooter";
  const LOADER = "vsbilPageLoader";
  const TOKEN_KEY = "vsbil_access_token";
  const isAuthPage = () => document.body?.classList.contains("auth-page") || /\/(login|register)\.html$/i.test(window.location.pathname);
  const hasSessionToken = () => { try { return Boolean(localStorage.getItem(TOKEN_KEY)?.trim()); } catch { return false; } };
  async function getSession() {
    try {
      const token = localStorage.getItem(TOKEN_KEY)?.trim();
      if (!token) return null;
      const r = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ accessToken: token }) });
      const d = await r.json().catch(() => null);
      return r.ok && d?.success && d.user ? d.user : null;
    } catch { return null; }
  }
  async function routeAuthenticatedAuthPage() {
    if (!isAuthPage() || !hasSessionToken()) return;
    const user = await getSession();
    if (user) {
      const target = user.status === "active" ? "/dashboard.html" : "/activate.html";
      if (location.pathname !== target) location.replace(target);
    } else if (hasSessionToken()) {
      ["vsbil_access_token", "vsbil_refresh_token", "vsbil_expires_at", "vsbil_expires_in", "vsbil_token_type", "vsbil_user"].forEach(k => localStorage.removeItem(k));
    }
  }
  async function homeSession() {
    if (location.pathname !== "/" || !hasSessionToken()) return;
    const user = await getSession();
    if (!user) return;
    const login = document.querySelector('a.login-btn[href="/login.html"]');
    if (login) { login.textContent = "Dashboard"; login.href = "/dashboard.html"; login.classList.add("is-authenticated"); }
    const create = [...document.querySelectorAll('a.primary-btn')].find(a => /create account/i.test(a.textContent || ""));
    if (create) { create.textContent = "Open Dashboard"; create.href = "/dashboard.html"; }
    document.querySelectorAll('a[href="/register.html"],a[href="/login.html"]').forEach(a => { if (/create account|login/i.test(a.textContent || "")) { a.textContent = "Dashboard"; a.href = "/dashboard.html"; } });
  }
  function loader() {
    if (document.getElementById(LOADER)) return;
    const e = document.createElement("div");
    e.id = LOADER; e.className = "vsbil-page-loader"; e.setAttribute("aria-label", "Loading VSBIL");
    e.innerHTML = `<div class="vsbil-loader-box"><div class="vsbil-loader-mark"><img class="vsbil-loader-logo" src="${LOGO}" alt="VSBIL logo"></div><div class="vsbil-loader-name" aria-hidden="true">VSBIL</div><div class="vsbil-loader-label">BUILD • ENGAGE • GROW</div></div>`;
    document.body.prepend(e);
    const hide = () => requestAnimationFrame(() => setTimeout(() => e.classList.add("is-hidden"), 1150));
    addEventListener("load", hide, { once: true }); setTimeout(hide, 1800);
  }
  function navigation() {
    if (isAuthPage() || !hasSessionToken() || document.getElementById("vsbilGlobalNavigation")) return;
    document.body.classList.add("vsbil-authenticated-shell");
    const links = [
      ["⌂", "Home", "/"], ["◎", "For You", "/discover.html"], ["▦", "Dashboard", "/dashboard.html"],
      ["◈", "Campaigns", "/creator.html"], ["◇", "Shop", "/shop-admin.html"], ["▤", "Business", "/business.html"],
      ["◉", "WhatsApp", "/whatsapp-bot.html"], ["✉", "Messages", "/messages.html"], ["♢", "Notifications", "/notifications.html"],
      ["⚙", "Settings", "/settings.html"]
    ];
    const current = location.pathname;
    const nav = links.map(([icon, label, href]) => `<a href="${href}" class="${current === href ? "active" : ""}"><b>${icon}</b><span>${label}</span></a>`).join("");
    if (!document.querySelector(".sidebar")) {
      const aside = document.createElement("aside"); aside.id = "vsbilGlobalNavigation"; aside.className = "vsbil-global-sidebar";
      aside.innerHTML = `<a class="vsbil-global-nav-brand" href="/"><img src="${LOGO}" alt="VSBIL"><span>VSBIL</span></a><nav>${nav}</nav>`;
      document.body.prepend(aside);
    }
    const bottom = document.createElement("nav"); bottom.id = "vsbilGlobalBottomNav"; bottom.className = "vsbil-global-bottom-nav"; bottom.setAttribute("aria-label", "Primary navigation");
    const bottomLinks = links.slice(0, 5).map(([icon, label, href]) => `<a href="${href}" class="${current === href ? "active" : ""}"><b>${icon}</b><span>${label}</span></a>`).join("");
    bottom.innerHTML = bottomLinks;
    document.body.appendChild(bottom);
  }
  function footer(isAuthenticated) {
    if (isAuthPage() || document.getElementById(FOOTER) || document.querySelector("footer.site-footer")) return;
    const accountLinks = isAuthenticated
      ? `<a href="/dashboard.html">Dashboard</a><a href="/profile.html">Profile</a><a href="/wallet.html">Rewards &amp; Wallet</a><a href="/settings.html">Settings</a><a href="/security.html">Security</a>`
      : `<a href="/login.html">Login</a><a href="/register.html">Create Account</a><a href="/dashboard.html">Dashboard</a><a href="/profile.html">Profile</a>`;
    document.body.insertAdjacentHTML("beforeend", `<footer id="${FOOTER}" class="site-footer vsbil-global-footer"><div class="vsbil-footer-inner"><div class="vsbil-footer-grid"><div class="vsbil-footer-brand"><a class="vsbil-footer-brandmark" href="/" aria-label="VSBIL home"><img src="${LOGO}" alt=""><span>VSBIL</span></a><p>A modern platform for creators, communities, verified commerce and practical business tools.</p><div class="vsbil-footer-status"><span class="vsbil-status-dot"></span>Platform online</div></div><div class="vsbil-footer-col"><h4>Platform</h4><a href="/about.html">About VSBIL</a><a href="/social.html">Community</a><a href="/activities.html">Activities</a><a href="/creator.html">Creator Hub</a><a href="/faq.html">Help Center</a></div><div class="vsbil-footer-col"><h4>Business</h4><a href="/business.html">Business Suite</a><a href="/shop-admin.html">Shop &amp; Storefront</a><a href="/order-track.html">Order Tracking</a><a href="/whatsapp-bot.html">WhatsApp Automation</a><a href="/advertise.html">Advertising</a></div><div class="vsbil-footer-col"><h4>Account</h4>${accountLinks}</div><div class="vsbil-footer-col"><h4>Trust &amp; Support</h4><a href="/support.html">Support &amp; Reports</a><a href="/contact.html">Contact Us</a><a href="/legal.html">Trust Center</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/security.html">Security</a><a href="/community-guidelines.html">Community Guidelines</a><a href="/acceptable-use.html">Acceptable Use</a></div></div><div class="vsbil-footer-bottom"><span>© ${new Date().getFullYear()} VSBIL. All rights reserved.</span><span class="vsbil-footer-legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/cookie-policy.html">Cookies</a><a href="/data-rights.html">Data Rights</a></span></div></div></footer>`);
  }
  async function boot() {
    await routeAuthenticatedAuthPage();
    loader();
    const authenticated = hasSessionToken();
    navigation();
    footer(authenticated);
    homeSession();
    document.documentElement.classList.add("vsbil-shell-ready");
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot, { once: true }) : boot();
})();
