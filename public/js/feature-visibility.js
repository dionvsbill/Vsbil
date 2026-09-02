(()=>{
  "use strict";
  const rules = [
    ["creator_program", ["/creator.html"]],
    ["business_suite", ["/business.html", "/shop-admin.html", "/order-track.html", "/advertise.html"]],
    ["marketplace", ["/marketplace.html", "/shop.html"]],
    ["youtube", ["/youtube.html", "/settings.html#connections"]],
    ["whatsapp", ["/whatsapp-bot.html"]],
    ["social", ["/social.html", "/discover.html"]],
    ["social_monetization", ["/social-monetization.html"]],
    ["activities", ["/activities.html"]],
    ["support", ["/support.html"]],
    ["verification", ["/verification.html"]],
    ["jumia_import", ["/admin/import/jumia"]],
    ["landlord", ["/landlord.html"]],
    ["services", ["/services.html"]],
    ["church", ["/church.html"]],
    ["funeral", ["/funeral.html"]]
  ];
  const normalize = href => {
    try { return new URL(href, location.origin).pathname.toLowerCase(); } catch { return ""; }
  };
  const apply = features => {
    for (const [key, paths] of rules) {
      if (features[key] !== false) continue;
      document.querySelectorAll("a[href],button[data-feature]").forEach(el => {
        const explicit = el.getAttribute("data-feature");
        const href = normalize(el.getAttribute("href") || "");
        if (explicit === key || paths.some(path => href === path || href.startsWith(path + "#"))) {
          el.hidden = true;
          el.setAttribute("aria-hidden", "true");
          el.setAttribute("data-feature-disabled", key);
        }
      });
    }
  };
  fetch("/api/features", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (data?.success && data.features) apply(data.features); })
    .catch(() => {});
})();
