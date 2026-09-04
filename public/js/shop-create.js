(() => {
  "use strict";
  const form = document.getElementById("createShop");
  const message = document.getElementById("message");
  const token = () => localStorage.getItem("vsbil_access_token") || "";
  const show = (text, ok = false) => { message.hidden = false; message.textContent = text; message.classList.toggle("success", ok); };
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    if (button) button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/business-commerce/shops", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }, body: JSON.stringify(data) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Unable to create shop");
      show("Shop created. Opening your shop control center…", true);
      location.href = `/dashboard/shop/${encodeURIComponent(result.shop.id)}`;
    } catch (error) {
      show(error instanceof Error ? error.message : "Unable to create shop");
    } finally { if (button) button.disabled = false; }
  });
})();