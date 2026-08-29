"use strict";

const token = () => localStorage.getItem("vsbil_access_token");
const headers = () => ({ Authorization: `Bearer ${token()}`, Accept: "application/json" });
const toast = document.getElementById("toast");

function show(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    location.href = "/login.html";
    throw new Error("Authentication required");
  }
  if (!response.ok) throw new Error(data?.message || "Request failed");
  return data;
}

document.querySelectorAll(".settings-nav button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".settings-nav button").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".settings-section").forEach((x) => x.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.section)?.classList.add("active");
  });
});

async function loadAccount() {
  try {
    const data = await api("/api/users/profile");
    const user = data.user;
    document.getElementById("username").textContent = user.username || "VSBIL user";
    document.getElementById("email").textContent = user.email || "";

    const status = document.getElementById("accountStatus");
    status.textContent = user.status || "Unknown";
    status.classList.toggle("ok", user.status === "active");

    const emailStatus = document.getElementById("emailStatus");
    const verified = Boolean(user.email_verified_at);
    emailStatus.textContent = verified ? "Verified" : "Not verified";
    emailStatus.classList.toggle("ok", verified);
    document.getElementById("sendCode").hidden = verified;
  } catch (error) {
    show(error.message);
  }
}

async function loadYoutube() {
  try {
    const data = await api("/api/youtube/connection");
    const state = document.getElementById("youtubeState");
    const connect = document.getElementById("connectYoutube");
    const disconnect = document.getElementById("disconnectYoutube");

    if (data.connected) {
      const c = data.connection;
      const safeTitle = escapeHtml(c.channel_title || "YouTube channel");
      const safeUrl = escapeHtml(c.channel_url || "");
      const thumb = escapeHtml(c.channel_thumbnail_url || "");
      state.innerHTML = `<div class="channel">${thumb ? `<img src="${thumb}" alt="YouTube channel">` : ""}<div><strong>${safeTitle}</strong><div class="muted">${safeUrl}</div><span class="status ok">Connected</span>${c.last_verified_at ? `<div class="muted">Last verified ${escapeHtml(new Date(c.last_verified_at).toLocaleString())}</div>` : ""}</div></div>`;
      connect.hidden = true;
      disconnect.hidden = false;
    } else {
      state.innerHTML = '<p class="muted">No YouTube channel is connected.</p>';
      connect.hidden = false;
      disconnect.hidden = true;
    }
  } catch (error) {
    show(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

document.getElementById("connectYoutube")?.addEventListener("click", () => {
  location.href = "/api/youtube/connect";
});

document.getElementById("disconnectYoutube")?.addEventListener("click", async () => {
  if (!confirm("Disconnect your YouTube account? You may lose access to YouTube verification features.")) return;
  try {
    await api("/api/youtube/connection", { method: "DELETE" });
    show("YouTube disconnected");
    await loadYoutube();
  } catch (error) {
    show(error.message);
  }
});

document.getElementById("sendCode")?.addEventListener("click", async () => {
  const button = document.getElementById("sendCode");
  try {
    button.disabled = true;
    await api("/api/verification/send", { method: "POST" });
    document.getElementById("codeBox").hidden = false;
    show("Verification code sent to your email");
  } catch (error) {
    show(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("verifyCode")?.addEventListener("click", async () => {
  const code = document.getElementById("code").value.trim();
  try {
    await api("/api/verification/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    document.getElementById("emailStatus").textContent = "Verified";
    document.getElementById("emailStatus").classList.add("ok");
    document.getElementById("sendCode").hidden = true;
    document.getElementById("codeBox").hidden = true;
    show("Email verified successfully");
  } catch (error) {
    show(error.message);
  }
});

const params = new URLSearchParams(location.search);
if (params.get("youtube") === "connected") show("YouTube connected successfully");
if (params.get("youtube") === "cancelled") show("YouTube connection was cancelled");

loadAccount();
loadYoutube();
