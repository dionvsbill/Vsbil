(() => {
  "use strict";
  const token = () => localStorage.getItem("vsbil_access_token") || "";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  async function api(path, opt = {}) {
    const h = new Headers(opt.headers || {});
    h.set("Accept", "application/json");
    h.set("Authorization", `Bearer ${token()}`);
    if (opt.body) h.set("Content-Type", "application/json");
    const r = await fetch(path, { ...opt, headers: h, credentials: "include" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(Error(d.message || "Unable to complete that request."), { data: d, code: d.code });
    return d;
  }
  function media(p) {
    if (!p.media_url) return "";
    const url = esc(p.media_url);
    if (p.media_type === "video") return `<video class="social-post-media" src="${url}" controls playsinline preload="metadata"></video>`;
    return `<img class="social-post-media" src="${url}" alt="Post media" loading="lazy" referrerpolicy="no-referrer">`;
  }
  async function metrics(id) {
    try { return (await api(`/api/social-monetization/posts/${encodeURIComponent(id)}/metrics`)).metrics || {}; }
    catch { return {}; }
  }
  async function renderMetrics(article, id) {
    const m = await metrics(id);
    const el = article.querySelector("[data-metrics]");
    if (el) el.innerHTML = `♡ ${Number(m.likes || 0)} · ${Number(m.comments || 0)} comments · ${Number(m.views || 0)} views`;
  }
  async function recordView(id) {
    try { await api(`/api/social-monetization/posts/${encodeURIComponent(id)}/view`, { method: "POST" }); } catch {}
  }
  function commentBox(id) {
    return `<div class="social-comment-box" data-comments="${esc(id)}"><input maxlength="1000" placeholder="Write a comment…"><button type="button">Post</button><div class="social-comment-notice"></div></div>`;
  }
  async function feed() {
    const el = document.getElementById("feed");
    if (!el) return;
    try {
      const d = await api("/api/social/feed");
      if (!d.posts?.length) {
        el.innerHTML = '<div class="feed-empty">No posts yet. Share an update or follow more creators.</div>';
        return;
      }
      el.innerHTML = d.posts.map(p => `<article class="social-post" data-post-id="${esc(p.id)}">
        <div class="social-post-head">
          <a class="social-avatar" href="/profile.html?id=${encodeURIComponent(p.user_id)}">${esc((p.users?.username || "U")[0]).toUpperCase()}</a>
          <div><strong>${esc(p.users?.username || "VSBIL User")}</strong> ${p.users?.shop_verification_level && p.users.shop_verification_level !== "none" ? '<span class="verified-badge">✓ Verified</span>' : ''}<div class="social-muted">${new Date(p.created_at).toLocaleString()}</div></div>
        </div>
        ${p.body ? `<div class="social-post-body">${esc(p.body)}</div>` : ""}
        ${media(p)}
        <div class="social-actions">
          <button data-like="${esc(p.id)}" type="button">♡ Like</button>
          <button data-comment-toggle="${esc(p.id)}" type="button">Comment</button>
          <button data-report="${esc(p.id)}" type="button">Report</button>
        </div>
        <div class="social-muted social-metrics" data-metrics>Loading engagement…</div>
        ${commentBox(p.id)}
      </article>`).join("");

      el.querySelectorAll("[data-like]").forEach(b => b.onclick = async () => {
        try { await api(`/api/social/posts/${encodeURIComponent(b.dataset.like)}/like`, { method: "POST" }); b.textContent = "♥ Liked"; b.disabled = true; await renderMetrics(b.closest("article"), b.dataset.like); }
        catch (e) { b.textContent = e.message; }
      });
      el.querySelectorAll("[data-report]").forEach(b => b.onclick = () => location.href = `/support.html?postId=${encodeURIComponent(b.dataset.report)}`);
      el.querySelectorAll("[data-comment-toggle]").forEach(b => b.onclick = () => {
        const box = b.closest("article")?.querySelector(".social-comment-box");
        if (box) box.classList.toggle("is-open");
      });
      el.querySelectorAll("[data-comments]").forEach(box => {
        const id = box.dataset.comments;
        box.querySelector("button").onclick = async () => {
          const input = box.querySelector("input"), notice = box.querySelector(".social-comment-notice");
          try {
            if (!input.value.trim()) return;
            await api(`/api/social/posts/${encodeURIComponent(id)}/comments`, { method: "POST", body: JSON.stringify({ body: input.value.trim() }) });
            input.value = ""; notice.textContent = "Comment posted."; await renderMetrics(box.closest("article"), id);
          } catch (e) { notice.textContent = e.message; }
        };
      });
      el.querySelectorAll("article[data-post-id]").forEach(article => {
        const id = article.dataset.postId;
        renderMetrics(article, id);
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) { recordView(id); observer.disconnect(); }
        }, { threshold: 0.55 });
        observer.observe(article);
      });
    } catch (e) {
      el.innerHTML = `<div class="feed-empty">${esc(e.message)}</div>`;
    }
  }
  async function program() {
    const b = document.getElementById("join");
    try {
      const d = await api("/api/creator-program/program");
      const status = document.getElementById("creatorStatus");
      if (d.joined) { if (b) { b.textContent = "Creator program active"; b.disabled = true; } if (status) status.textContent = "Eligible content can earn from finalized platform ad revenue."; }
      else if (status) status.textContent = d.activationRequired ? "Activate your earning account first." : "Join the creator program to publish monetizable content.";
    } catch {}
  }
  async function earnings() {
    const el = document.getElementById("creatorEarnings");
    if (!el) return;
    try {
      const d = await api("/api/social-monetization/earnings");
      el.textContent = `Creator earnings: GHS ${Number(d.total || 0).toFixed(2)}`;
    } catch { el.textContent = "Creator earnings unavailable"; }
  }
  window.VSBIL_SOCIAL_REFRESH = feed;
  document.addEventListener("DOMContentLoaded", () => {
    feed(); program(); earnings();
    const b = document.getElementById("join");
    b?.addEventListener("click", async () => {
      try {
        await api("/api/creator-program/program/join", { method: "POST", body: JSON.stringify({ acceptTerms: true }) });
        b.textContent = "Creator program active"; b.disabled = true; await program();
      } catch (e) { alert(e.message); }
    });
  });
})();
