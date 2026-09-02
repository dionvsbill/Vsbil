const token = localStorage.getItem("vsbil_access_token");
if (!token) location.replace("/login.html");

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) { location.replace("/dashboard.html"); throw new Error(data.message || "Access denied"); }
  if (!response.ok) { const error = new Error(data.message || "Request failed"); error.code = data.code; error.requiresManual = data.requiresManual; throw error; }
  return data;
};

let product = null;
let shops = [];

function status(message, error = false) {
  const el = $("status");
  el.classList.remove("hidden");
  el.textContent = message;
  el.style.border = error ? "1px solid #b42318" : "";
}

function renderImages() {
  $("images").innerHTML = (product?.images || []).map((url, index) => `
    <div class="image-card">
      <img src="${esc(url)}" alt="Product image ${index + 1}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'Image unavailable'}))">
      <small>${index === 0 ? "Cover" : `Image ${index + 1}`}</small>
    </div>`).join("") || "<span class='muted'>No source images were returned. Add image URLs above.</span>";
}

function syncManualImages() {
  product.images = $("manualImages").value.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^https:\/\//i.test(x)).slice(0, 5);
  renderImages();
}

async function loadShops() {
  const data = await api("/api/import/jumia/shops");
  shops = data.shops || [];
  $("shop").innerHTML = shops.map((shop) => `<option value="${esc(shop.id)}">${esc(shop.name)}${shop.is_published ? " · published" : ""}</option>`).join("");
}

$("manualImages").addEventListener("input", syncManualImages);

$("fetch").onclick = async () => {
  const url = $("url").value.trim();
  if (!url) return status("Paste a Jumia Ghana product link first.", true);
  $("fetch").disabled = true;
  try {
    status("Fetching product securely from Jumia…");
    const data = await api("/api/import/jumia/fetch", { method: "POST", body: JSON.stringify({ url }) });
    product = data.product;
    $("title").value = product.title;
    $("price").value = product.price;
    $("original").value = product.originalPrice ?? "";
    $("description").value = product.description;
    $("inStock").checked = Boolean(product.inStock);
    $("manualImages").value = (product.images || []).join("\n");
    renderImages();
    $("result").classList.remove("hidden");
    $("manualNote").classList.toggle("hidden", !data.requiresManual);
    status(data.stale ? "Jumia blocked a fresh request. Showing the last cached product; verify price, stock and images before publishing." : (data.cachedForHours ? `Product loaded. Server cache window: ${data.cachedForHours} hours.` : "Product loaded."));
  } catch (error) {
    if (error.requiresManual && /^https:\/\/(www\.)?jumia\.com\.gh\//i.test(url)) {
      product = { title: "", description: "", price: "", originalPrice: null, images: [], inStock: true, sourceUrl: url, currency: "GHS", productId: "" };
      $("title").value = "";
      $("price").value = "";
      $("original").value = "";
      $("description").value = "";
      $("manualImages").value = "";
      $("inStock").checked = true;
      renderImages();
      $("result").classList.remove("hidden");
      $("manualNote").classList.remove("hidden");
      status("Automatic fetch is blocked for this product. Enter the Jumia title, price, description, and image URLs below, then publish.", true);
    } else status(error.message, true);
  } finally { $("fetch").disabled = false; }
};

$("publish").onclick = async () => {
  if (!product) return;
  syncManualImages();
  const payload = {
    shopId: $("shop").value,
    sourceUrl: product.sourceUrl,
    title: $("title").value.trim(),
    description: $("description").value.trim(),
    images: product.images,
    price: Number($("price").value),
    originalPrice: $("original").value === "" ? null : Number($("original").value),
    inStock: $("inStock").checked,
    affiliateTag: $("affiliate").value.trim(),
  };
  $("publish").disabled = true;
  try {
    status("Publishing product…");
    const data = await api("/api/import/jumia/publish", { method: "POST", body: JSON.stringify(payload) });
    status(`Published ${data.product?.name || "product"} successfully. Buyers will be sent to Jumia through the configured affiliate link.`);
  } catch (error) {
    status(error.message, true);
  } finally { $("publish").disabled = false; }
};

loadShops().catch((error) => status(error.message, true));
