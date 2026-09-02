(() => {
  "use strict";
  const token = localStorage.getItem("vsbil_access_token");
  if (!token) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  const api = async (path, options = {}) => { const r = await fetch("/api/admin" + path, { ...options, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(options.headers || {}) }, credentials: "include" }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || "Request failed"); return d; };
  let session = null;
  let refreshQueued = false;
  let realtimeChannel = null;

  const money = (n) => "₵" + (Number(n || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = (n) => Number(n || 0).toLocaleString();
  const dayLabel = (iso) => { const d = new Date(iso + "T00:00:00Z"); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

  function stat(label, value, detail = "") { return `<article class="pro-stat"><div class="pro-stat-label">${esc(label)}</div><div class="pro-stat-value">${esc(value)}</div><div class="pro-stat-detail">${esc(detail)}</div></article>`; }
  function chart(title, subtitle, id) { return `<section class="pro-panel pro-chart"><div class="pro-panel-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><span class="pro-live">LIVE</span></div><div class="chart-frame"><canvas id="${id}"></canvas></div></section>`; }

  function drawChart(id, labels, datasets, type = "line") {
    const canvas = $(id); if (!canvas || !window.Chart) return;
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new window.Chart(canvas, { type, data: { labels, datasets: datasets.map(d => ({ label: d.label, data: d.data, borderWidth: 2, tension: .35, fill: type === "line" ? false : undefined, borderRadius: type === "bar" ? 5 : undefined })) }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: datasets.length > 1 } }, scales: type === "bar" || type === "line" ? { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(148,163,184,.10)" } } } : undefined } });
  }

  async function renderOverview() {
    const [analytics, base] = await Promise.all([api("/analytics"), api("/overview")]);
    const k = analytics.kpis; const s = base.stats;
    $("title").textContent = "Command Center";
    $("content").innerHTML = `<div class="pro-overview"><div class="pro-hero"><div><span class="eyebrow">VSBIL OPERATIONS</span><h2>System command center</h2><p>Live operational intelligence across users, money, campaigns and security.</p></div><div class="hero-status"><span class="status-orb"></span><div><b>Realtime connected</b><small>Database events are streamed into this console.</small></div></div></div><div class="pro-stat-grid">${stat("Total users", compact(s.users), `${compact(k.newUsers)} new in 30 days`)}${stat("Active users", compact(s.activeUsers), "Current account status")}${stat("Payment volume", money(k.paymentVolume), `${compact(k.successfulPayments)} successful payments`)}${stat("Withdrawals", money(k.withdrawalVolume), `${compact(k.approvedWithdrawals)} approved / paid`)}${stat("Submissions", compact(k.approvedSubmissions), "Approved in 30 days")}${stat("Security events", compact(k.securityEvents), "30-day event stream")}${stat("Pending withdrawals", compact(s.pendingWithdrawals), "Requires operations review")}${stat("Pending submissions", compact(s.pendingSubmissions), "Requires review")}</div><div class="pro-chart-grid">${chart("User growth","New registrations over the last 30 days","usersChart")}${chart("Payment volume","Successful payment volume by day","paymentsChart")}</div><div class="pro-chart-grid">${chart("Withdrawal volume","Approved and paid withdrawal volume","withdrawalsChart")}${chart("Security activity","Security events by day","securityChart")}</div><div class="pro-bottom-grid"><section class="pro-panel"><div class="pro-panel-head"><div><h2>Operational queue</h2><p>Items requiring administrator attention.</p></div></div><div class="queue">${queue("Pending payments",s.pendingPayments,"payments")}${queue("Pending withdrawals",s.pendingWithdrawals,"withdrawals")}${queue("Pending submissions",s.pendingSubmissions,"submissions")}${queue("Suspended / banned users",s.suspendedUsers,"users")}</div></section><section class="pro-panel"><div class="pro-panel-head"><div><h2>System posture</h2><p>Current control-plane state.</p></div></div><div class="posture"><div><span>API</span><b>Online</b></div><div><span>Realtime</span><b>Connected</b></div><div><span>Feature controls</span><b>Server enforced</b></div><div><span>Admin security</span><b>RBAC enabled</b></div></div></section></div></div>`;
    const labels = analytics.series.users.map(x => dayLabel(x.day));
    drawChart("usersChart", labels, [{ label: "New users", data: analytics.series.users.map(x => x.value) }]);
    drawChart("paymentsChart", labels, [{ label: "GHS pesewas", data: analytics.series.payments.map(x => x.value) }]);
    drawChart("withdrawalsChart", labels, [{ label: "GHS pesewas", data: analytics.series.withdrawals.map(x => x.value) }]);
    drawChart("securityChart", labels, [{ label: "Events", data: analytics.series.security.map(x => x.value) }]);
  }
  function queue(label, value, view) { return `<button class="queue-row" onclick="render('${view}')"><span><b>${esc(label)}</b><small>Open operations queue</small></span><strong>${compact(value)}</strong><span class="queue-arrow">›</span></button>`; }

  async function renderSupport() {
    const d = await api("/support-tickets?limit=300");
    $("title").textContent = "Support Operations";
    $("content").innerHTML = `<section class="pro-panel"><div class="pro-panel-head"><div><h2>Support queue</h2><p>Resolve customer issues without exposing sensitive financial or security data.</p></div><span class="pro-counter">${d.tickets.filter(t => ["open","in_progress"].includes(t.status)).length} open</span></div><div class="support-grid">${d.tickets.map(t => `<article class="support-ticket"><div><span class="status">${esc(t.status)}</span><b>${esc(t.reference || "Support request")}</b></div><p>${esc(t.message)}</p><small>${esc(t.name || t.email || "User")} · ${new Date(t.created_at).toLocaleString()}</small><div class="ticket-actions"><button onclick="updateSupport('${t.id}','in_progress')">In progress</button><button onclick="updateSupport('${t.id}','resolved')">Resolve</button></div></article>`).join("") || '<div class="empty">No support tickets.</div>'}</div></section>`;
  }
  window.updateSupport = async (id, status) => { await api(`/support-tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); renderSupport(); };

  async function renderAdmins() {
    if (!session || session.role !== "admin") return;
    const d = await api("/admins");
    $("title").textContent = "Admin Management";
    $("content").innerHTML = `<section class="pro-panel"><div class="pro-panel-head"><div><h2>Administrator access</h2><p>Super Admin only. The protected super administrator cannot be deleted, suspended or demoted.</p></div><span class="pro-counter">${d.admins.length} admins</span></div><div class="admin-list">${d.admins.map(a => `<article class="admin-row"><div><b>${esc(a.username)}</b><small>${esc(a.email)}</small></div><span class="role-chip">${esc(a.role)}</span><span class="status">${esc(a.status)}</span>${a.email.toLowerCase() === "billphamous@gmail.com" ? '<span class="protected-chip">PROTECTED</span>' : `<select onchange="changeAdmin('${a.id}',this.value)"><option value="${esc(a.role)}" selected>${esc(a.role)}</option><option value="admin">Super Admin</option><option value="support_admin">Support Admin</option></select><button class="danger" onclick="removeAdmin('${a.id}')">Remove</button>`}</article>`).join("")}</div></section>`;
  }
  window.changeAdmin = async (id, role) => { await api(`/admins/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }); renderAdmins(); };
  window.removeAdmin = async (id) => { if (!confirm("Remove administrator access? The account will remain a normal user.")) return; await api(`/admins/${id}`, { method: "DELETE" }); renderAdmins(); };

  async function bootRealtime() {
    try {
      const cfg = await api("/realtime-config");
      if (!window.supabase || !cfg.url || !cfg.key) return;
      const client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
      client.realtime.setAuth(token);
      realtimeChannel = client.channel("vsbil-admin-operations");
      ["users", "payments", "withdrawals", "activity_submissions", "support_tickets", "account_security_events", "audit_logs"].forEach(table => {
        realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleRefresh(table));
      });
      realtimeChannel.subscribe(status => { document.body.dataset.realtime = status; const el = document.querySelector(".hero-status b"); if (el) el.textContent = status === "SUBSCRIBED" ? "Realtime connected" : "Realtime " + status.toLowerCase(); });
    } catch (e) { console.warn("Admin realtime unavailable", e); }
  }
  function scheduleRefresh(table) {
    if (refreshQueued) return; refreshQueued = true;
    setTimeout(async () => { refreshQueued = false; try { if (table === "support_tickets" && $("title")?.textContent === "Support Operations") await renderSupport(); else if ($("title")?.textContent === "Command Center") await renderOverview(); } catch (e) { console.warn("Realtime refresh", e); } }, 250);
  }

  function installShell() {
    document.body.classList.add("admin-pro-shell");
    const nav = document.querySelector("aside nav"); if (!nav) return;
    const buttons = [...nav.querySelectorAll("button")];
    buttons.forEach(b => { if (b.dataset.view === "overview") { const clone = b.cloneNode(true); b.replaceWith(clone); clone.addEventListener("click", renderOverview); } });
    const support = document.createElement("button"); support.className = "admin-pro-nav"; support.innerHTML = "Support <span id=\"supportBadge\"></span>"; support.addEventListener("click", renderSupport); nav.insertBefore(support, nav.children[1] || null);
    if (session?.role === "admin") { const admins = document.createElement("button"); admins.className = "admin-pro-nav"; admins.textContent = "Admin Management"; admins.addEventListener("click", renderAdmins); nav.appendChild(admins); }
    const existing = document.querySelector(".admin-top"); if (existing) existing.insertAdjacentHTML("afterbegin", `<span class="role-chip">${session?.role === "admin" ? "SUPER ADMIN" : "SUPPORT ADMIN"}</span>`);
  }

  async function boot() {
    try { session = (await api("/session")).user; } catch { return; }
    installShell();
    await renderOverview();
    bootRealtime();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
