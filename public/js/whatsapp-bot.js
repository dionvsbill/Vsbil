"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");
  let state = { bot: null, subscription: null, flows: [] };

  function show(message, error = false) {
    notice.textContent = message || "";
    notice.classList.toggle("error", error);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c]));
  }

  async function api(path, options = {}) {
    try {
      return await window.VSBIL_AUTH.api(path, options);
    } catch (error) {
      if (error?.code === "AUTH_REQUIRED" || error?.status === 401) {
        location.replace("/login.html");
        throw error;
      }
      throw error;
    }
  }

  function render() {
    const connected = state.bot?.status === "connected";
    const subscription = state.subscription;
    const active = Boolean(subscription?.active);

    $("connectionStatus").textContent = connected
      ? `Connected${state.bot.display_phone_number ? ` · ${state.bot.display_phone_number}` : ""}`
      : "Not connected";
    $("connectionDot").style.background = connected ? "#6ee7b7" : "#94a3b8";
    $("subscriptionStatus").textContent = active
      ? `${String(subscription.plan).toUpperCase()} plan active`
      : "No active subscription";
    $("periodEnd").textContent = active && subscription.current_period_end
      ? `Active until ${new Date(subscription.current_period_end).toLocaleDateString()}.`
      : "Connect a number, then choose a plan.";

    $("disconnectBtn").hidden = !connected;
    document.querySelectorAll(".plan").forEach((button) => {
      button.disabled = !connected;
      button.setAttribute("aria-disabled", connected ? "false" : "true");
    });

    $("flows").innerHTML = state.flows.length
      ? state.flows.map((flow) => `<div class="flow-row"><strong>${esc(flow.keyword)}</strong><p>${esc(flow.reply_text)}</p><div class="flow-actions"><button type="button" data-edit="${esc(flow.id)}">Edit</button><button type="button" class="delete" data-delete="${esc(flow.id)}">Delete</button></div></div>`).join("")
      : '<p class="muted">No auto-replies yet.</p>';
  }

  async function load() {
    try {
      const data = await api("/api/whatsapp/bot");
      state = { bot: data.bot, subscription: data.subscription, flows: data.flows || [] };
      render();

      const params = new URLSearchParams(location.search);
      if (params.get("payment") === "verify" && params.get("reference")) {
        show("Verifying payment…");
        const verified = await api(`/api/whatsapp/subscription/verify?reference=${encodeURIComponent(params.get("reference"))}`);
        show(`Subscription active through ${new Date(verified.currentPeriodEnd).toLocaleDateString()}.`);
        history.replaceState({}, "", "/whatsapp-bot.html");
        const refreshed = await api("/api/whatsapp/bot");
        state = { bot: refreshed.bot, subscription: refreshed.subscription, flows: refreshed.flows || [] };
        render();
      }
      await loadMessages();
    } catch (error) {
      show(error.message || "Unable to load WhatsApp settings", true);
    }
  }

  async function loadMessages() {
    try {
      const data = await api("/api/whatsapp/messages?limit=100");
      $("messages").innerHTML = data.messages?.length
        ? data.messages.map((message) => `<tr><td>${esc(new Date(message.created_at).toLocaleString())}</td><td>${esc(message.sender_phone)}</td><td>${esc(message.incoming_text)}</td><td>${esc(message.matched_keyword || "—")}</td><td>${esc(message.status)}</td></tr>`).join("")
        : '<tr><td colspan="5" class="muted">No messages recorded yet.</td></tr>';
    } catch (error) {
      $("messages").innerHTML = `<tr><td colspan="5">${esc(error.message)}</td></tr>`;
    }
  }

  $("connectForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("connectBtn");
    button.disabled = true;
    show("Verifying credentials…");
    try {
      const data = await api("/api/whatsapp/bot", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: $("phoneNumberId").value,
          accessToken: $("accessToken").value,
          businessName: $("businessName").value,
          displayPhoneNumber: $("displayPhoneNumber").value,
        }),
      });
      $("accessToken").value = "";
      show(data.message);
      await load();
    } catch (error) {
      show(error.message || "Unable to connect WhatsApp", true);
    } finally {
      button.disabled = false;
    }
  });

  $("disconnectBtn").addEventListener("click", async () => {
    if (!confirm("Disconnect this WhatsApp number? Automated replies will stop.")) return;
    try {
      await api("/api/whatsapp/bot", { method: "DELETE" });
      show("WhatsApp number disconnected.");
      await load();
    } catch (error) {
      show(error.message, true);
    }
  });

  $("flowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/whatsapp/flows", {
        method: "POST",
        body: JSON.stringify({ keyword: $("keyword").value, replyText: $("replyText").value }),
      });
      state.flows.push(data.flow);
      $("keyword").value = "";
      $("replyText").value = "";
      render();
      show("Auto-reply saved.");
    } catch (error) {
      show(error.message, true);
    }
  });

  $("flows").addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const deleteId = target.dataset.delete;
    if (deleteId) {
      try {
        await api(`/api/whatsapp/flows/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
        state.flows = state.flows.filter((flow) => flow.id !== deleteId);
        render();
        show("Auto-reply deleted.");
      } catch (error) {
        show(error.message, true);
      }
      return;
    }
    const editId = target.dataset.edit;
    if (!editId) return;
    const flow = state.flows.find((item) => item.id === editId);
    if (!flow) return;
    const keyword = prompt("Keyword", flow.keyword);
    if (keyword === null) return;
    const replyText = prompt("Reply text", flow.reply_text);
    if (replyText === null) return;
    try {
      const data = await api(`/api/whatsapp/flows/${encodeURIComponent(editId)}`, {
        method: "PUT",
        body: JSON.stringify({ keyword, replyText, isActive: flow.is_active }),
      });
      state.flows = state.flows.map((item) => item.id === editId ? data.flow : item);
      render();
      show("Auto-reply updated.");
    } catch (error) {
      show(error.message, true);
    }
  });

  document.querySelectorAll(".plan").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) {
      show("Connect your WhatsApp number before choosing a plan.", true);
      return;
    }
    const plan = button.dataset.plan;
    button.disabled = true;
    show("Starting secure payment…");
    try {
      const data = await api("/api/whatsapp/subscription/initialize", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      if (!data?.authorization_url) throw new Error("Payment provider did not return a checkout link.");
      location.assign(data.authorization_url);
    } catch (error) {
      show(error.message || "Unable to start subscription payment. Please try again.", true);
      render();
    }
  }));

  $("refreshMessages").addEventListener("click", loadMessages);
  load();
})();
