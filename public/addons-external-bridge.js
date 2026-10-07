/* HL2SBPP Addons external navigation */
window.ADDONS_SITE_URL = "https://hl2sbpp-addonss.onrender.com";

(function () {
  function getId(el) {
    let n = el;
    while (n && n !== document.body) {
      const values = [
        n.dataset && (n.dataset.addonId || n.dataset.id),
        n.getAttribute && (n.getAttribute("data-addon-id") || n.getAttribute("data-id"))
      ];
      for (const v of values) {
        if (v !== null && v !== undefined && String(v) !== "") return String(v);
      }

      const href = n.getAttribute && n.getAttribute("href");
      const m = href && href.match(/\/(?:addon|addons)\/(\d+)/i);
      if (m) return m[1];

      n = n.parentElement;
    }
    return null;
  }

  document.addEventListener("click", function (event) {
    const target = event.target.closest && event.target.closest(
      "[data-addon-id], [data-id], .addon-card, .addon-item, .addon, [href*='/addon/'], [href*='/addons/']"
    );
    if (!target) return;

    const id = getId(target);
    if (!id) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    window.location.replace(
      window.ADDONS_SITE_URL.replace(/\/+$/, "") +
      "/addon/" + encodeURIComponent(id)
    );
  }, true);
})();
