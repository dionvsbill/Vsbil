(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const money = (v) => `GHS ${Number(v || 0).toFixed(2)}`;
  const image = (url, alt) => url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src='/assets/vsbil-logo.svg'">` : `<div class="product-placeholder"><img src="/assets/vsbil-logo.svg" alt=""></div>`;

  async function load(q = "") {
    const response = await fetch(`/api/marketplace/shops${q ? `?q=${encodeURIComponent(q)}` : ""}`, { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Unable to load marketplace");
    render(data.shops || [], data.products || []);
  }

  function render(shops, products) {
    $("#shopCount").textContent = `${shops.length} published shop${shops.length === 1 ? "" : "s"}`;
    $("#shops").innerHTML = shops.length ? shops.map((shop) => `<article class="shop-card"><div class="shop-logo">${shop.logo_url ? image(shop.logo_url, shop.name) : `<img src="/assets/vsbil-logo.svg" alt="">`}</div><div class="shop-card-body"><span class="verified">✓ Published shop</span><h3>${esc(shop.name)}</h3><p>${esc(shop.description || "Explore products from this VSBIL storefront.")}</p><div class="shop-meta">${esc(shop.address || "Ghana")} · ${esc(shop.currency || "GHS")}</div><a class="primary-btn" href="/store.html?shop=${encodeURIComponent(shop.store_slug)}">Visit shop</a></div></article>`).join("") : `<div class="empty-card">No published shops match your search yet.</div>`;

    const shopMap = new Map(shops.map((shop) => [shop.id, shop]));
    $("#products").innerHTML = products.length ? products.map((product) => { const shop = shopMap.get(product.shop_id); const oldPrice = Number(product.selling_price || 0); const sale = Number(product.sale_price || oldPrice); return `<article class="product-card">${image(product.image_url, product.name)}<div class="product-info"><span class="product-shop">${esc(shop?.name || "VSBIL Shop")}</span><h3>${esc(product.name)}</h3><p>${esc(product.description || "")}</p><div class="prices"><strong>${money(sale)}</strong>${sale < oldPrice ? `<del>${money(oldPrice)}</del>` : ""}</div><span class="stock ${product.available ? "in" : "out"}">${product.available ? "In stock" : "Out of stock"}</span>${shop?.store_slug ? `<a href="/store.html?shop=${encodeURIComponent(shop.store_slug)}">View product &amp; shop →</a>` : ""}</div></article>`; }).join("") : `<div class="empty-card">Published products will appear here.</div>`;
  }

  $("#marketSearchButton").addEventListener("click", () => load($("#marketSearch").value.trim()).catch((e) => alert(e.message)));
  $("#marketSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#marketSearchButton").click(); });
  load(new URLSearchParams(location.search).get("q") || "").catch((e) => { $("#shops").innerHTML = `<div class="empty-card">${esc(e.message)}</div>`; $("#products").innerHTML = ""; });
})();
