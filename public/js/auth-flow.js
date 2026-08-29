/* VSBIL AUTH FLOW — shared production client */
"use strict";
(function () {
  const KEYS = ["vsbil_access_token","vsbil_refresh_token","vsbil_expires_at","vsbil_expires_in","vsbil_token_type","vsbil_user"];

  function saveSession(session, user) {
    if (!session?.accessToken) return false;
    localStorage.setItem("vsbil_access_token", session.accessToken);
    if (session.refreshToken) localStorage.setItem("vsbil_refresh_token", session.refreshToken);
    if (session.expiresAt != null) localStorage.setItem("vsbil_expires_at", String(session.expiresAt));
    if (session.expiresIn != null) localStorage.setItem("vsbil_expires_in", String(session.expiresIn));
    localStorage.setItem("vsbil_token_type", session.tokenType || "bearer");
    if (user) localStorage.setItem("vsbil_user", JSON.stringify(user));
    return true;
  }

  function clearSession() { KEYS.forEach((key) => localStorage.removeItem(key)); }
  function getAccessToken() { return localStorage.getItem("vsbil_access_token")?.trim() || null; }
  function getRefreshToken() { return localStorage.getItem("vsbil_refresh_token")?.trim() || null; }

  async function request(path, body, options = {}) {
    const hasBody = body !== undefined;
    const method = options.method || (hasBody ? "POST" : "GET");
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (hasBody) headers.set("Content-Type", "application/json");

    const token = getAccessToken();
    if (token && path.startsWith("/api/")) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: "same-origin",
      body: hasBody ? JSON.stringify(body) : options.body
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success === false) {
      const error = new Error(data?.message || `Request failed (${response.status})`);
      error.code = data?.code || (response.status === 401 ? "AUTH_REQUIRED" : "REQUEST_FAILED");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function api(path, options = {}) {
    const token = getAccessToken();
    if (!token) {
      const error = new Error("Authentication required");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    return request(path, undefined, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
  }

  window.VSBIL_AUTH = Object.freeze({ request, api, saveSession, clearSession, getAccessToken, getRefreshToken });
})();
