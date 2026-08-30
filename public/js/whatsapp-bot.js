"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");
  let state = { bot: null, subscription: null, flows: [] };

  function show(message, error = false) {
    notice.textContent = message || "";
    notice.classList.toggle("error", error);
  }
  function esc(value) { return String(value ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
  async function api(path, options = {}) {
    try { return await window.VSBIL_AUTH.api(path, options); }
    catch (error) {
      if (error?.code === "AUTH_REQUIRED" || error?.status === 401) { location.replace("/login.html"); throw error; }
      throw error;
    }
  }

  function render() {
    const connected = state.bot?.status === "connected";
    $("connectionStatus").textContent = connected ? `Connected${state.bot.display_phone_number ? ` · ${state.bot.display_phone_number}` : ""}` : "Not connected";
    $("connectionDot").style.background = connected ? "#6ee7b7" : "#94a3b8";
    const sub = state.subscription;
    const active = Boolean(sub?.active);
    $("subscriptionStatus").textContent = active ? `${String(sub.plan).toUpperCase()} plan active` : "No active subscription";
    $("periodEnd").textContent = active && sub.current_period_end ? `Active until ${new Date(sub.current_period_end).toLocaleDateString()}.` : "Choose a plan to enable automated replies.";
    $("disconnectBtn").hidden = !connected;
    $("flows").innerHTML = state.flows.length ? state.flows.map((f) => `<div class="flow-row"><strong>${esc(f.keyword)}</strong><p>${esc(f.reply_text)}</p><div class="flow-actions"><button data-edit="${esc(f.id)}">Edit</button><button class="delete" data-delete="${esc(f.id)}">Delete</button></div></div>`).join("") : '<p class="muted">No auto-replies yet. Add your first keyword above.</p>';
  }

  async function load() {
    try {
      const data = await api("/api/whatsapp/bot");
      state = { bot: data.bot, subscription: data.subscription, flows: data.flows || [] };
      render();
      const params = new URLSearchParams(location.search);
      if (params.get("payment") === "verify" && params.get("reference")) {
        show("Verifying your subscription payment…");
        const verified = await api(`/api/whatsapp/subscription/verify?reference=${encodeURIComponent(params.get("reference"))}`);
        show(`Subscription active through ${new Date(verified.currentPeriodEnd).toLocaleDateString()}.`);
        history.replaceState({}, "", "/whatsapp-bot.html");
        const refreshed = await api("/api/whatsapp/bot");
        state = { bot: refreshed.bot, subscription: refreshed.subscription, flows: refreshed.flows || [] }; render();
      }
      await loadMessages();
    } catch (error) { show(error.message || "Unable to load WhatsApp settings", true); }
  }

  async function loadMessages() {
    try {
      const data = await api("/api/whatsapp/messages?limit=100");
      $("messages").innerHTML = data.messages?.length ? data.messages.map((m) => `<tr><td>${esc(new Date(m.created_at).toLocaleString())}</td><td>${esc(m.sender_phone)}</td><td>${esc(m.incoming_text)}</td><td>${esc(m.matched_keyword || "—")}</td><td>${esc(m.status)}</td></tr>`).join("") : '<tr><td colspan="5" class="muted">No messages recorded yet.</td></tr>';
    } catch (error) { $("messages").innerHTML = `<tr><td colspan="5">${esc(error.message)}</td></tr>`; }
  }

  $("connectForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const btn = $("connectBtn"); btn.disabled = true; show("Verifying credentials with Meta…");
    try {
      const data = await api("/api/whatsapp/bot", { method: "POST", body: JSON.stringify({ phoneNumberId: $("phoneNumberId").value, accessToken: $("accessToken").value, businessName: $("businessName").value, displayPhoneNumber: $("displayPhoneNumber").value }) });
      $("accessToken").value = ""; show(data.message); await load();
    } catch (error) { show(error.message || "Unable to connect WhatsApp", true); } finally { btn.disabled = false; }
  });

  $("disconnectBtn").addEventListener("click", async () => {
    if (!confirm("Disconnect this WhatsApp number? Existing auto-replies will stop immediately.")) return;
    try { await api("/api/whatsapp/bot", { method: "DELETE" }); show("WhatsApp number disconnected."); await load(); }
    catch (error) { show(error.message, true); }
  });

  $("flowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { const data = await api("/api/whatsapp/flows", { method: "POST", body: JSON.stringify({ keyword: $("keyword").value, replyText: $("replyText").value }) }); state.flows.push(data.flow); $("keyword").value = ""; $("replyText").value = ""; render(); show("Auto-reply saved."); }
    catch (error) { show(error.message, true); }
  });

  $("flows").addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.dataset.delete;
    if (id) { try { await api(`/api/whatsapp/flows/${encodeURIComponent(id)}`, { method: "DELETE" }); state.flows = state.flows.filter((f) => f.id !== id); render(); show("Auto-reply deleted."); } catch (e) { show(e.message, true); } return; }
    const editId = target.dataset.edit;
    if (editId) {
      const flow = state.flows.find((f) => f.id === editId); if (!flow) return;
      const keyword = prompt("Keyword", flow.keyword); if (keyword === null) return;
      const replyText = prompt("Reply text", flow.reply_text); if (replyText === null) return;
      try { const data = await api(`/api/whatsapp/flows/${encodeURIComponent(editId)}`, { method: "PUT", body: JSON.stringify({ keyword, replyText, isActive: flow.is_active }) }); state.flows = state.flows.map((f) => f.id === editId ? data.flow : f); render(); show("Auto-reply updated."); } catch (e) { show(e.message, true); }
    }
  });

  document.querySelectorAll(".plan").forEach((button) => button.addEventListener("click", async () => {
    try { const plan = button.dataset.plan; const data = await api("/api/whatsapp/subscription/initialize", { method: "POST", body: JSON.stringify({ plan }) }); location.href = data.authorization_url; }
    catch (error) { show(error.message, true); }
  }));
  $("refreshMessages").addEventListener("click", loadMessages);
  load();
})();
