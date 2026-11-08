/*!
 * GoUplift embed loader.
 *
 * Put this on any page, once:
 *
 *   <div data-gouplift-org="your-organization-slug"></div>
 *   <script async src="https://<gouplift domain>/embed.js"></script>
 *
 * Optional attributes on the div:
 *   data-limit="6"        how many fundraisers to show (1-24, default 6)
 *   data-theme="dark"     "light" (default) or "dark"
 *
 * It shows the organization's active fundraisers in an iframe served from
 * GoUplift and keeps the iframe exactly as tall as its content. For pages
 * that add the div after load (single-page apps), call GoUpliftEmbed.scan().
 *
 * Plain ES5 with no dependencies on purpose: it runs on other people's sites.
 * Keep it backward compatible, since sites will have this URL hard-coded.
 */
(function () {
  "use strict";

  if (window.GoUpliftEmbed) return;

  // document.currentScript is set while a classic script runs, async included.
  // The fallback covers the rare browser or loader that doesn't set it.
  var script = document.currentScript;
  if (!script) {
    var candidates = document.querySelectorAll('script[src*="embed.js"]');
    script = candidates[candidates.length - 1];
  }
  if (!script || !script.src) return;

  // The iframe is always loaded from the origin this script came from, so the
  // same snippet works on staging and production without changes.
  var origin = new URL(script.src, window.location.href).origin;

  var RESIZE_MESSAGE = "gouplift:embed:resize";
  var MAX_HEIGHT = 20000;
  var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var frames = [];

  function mount(container) {
    if (container.getAttribute("data-gouplift-mounted")) return;

    var slug = container.getAttribute("data-gouplift-org");
    if (!slug || !SLUG_PATTERN.test(slug)) return;
    container.setAttribute("data-gouplift-mounted", "true");

    var query = [];
    var limit = container.getAttribute("data-limit");
    if (limit && /^\d{1,3}$/.test(limit)) query.push("limit=" + limit);
    var theme = container.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") query.push("theme=" + theme);

    var iframe = document.createElement("iframe");
    iframe.src =
      origin +
      "/embed/organizations/" +
      encodeURIComponent(slug) +
      (query.length ? "?" + query.join("&") : "");
    iframe.title = "Fundraisers on GoUplift";
    iframe.loading = "lazy";
    // Tall enough to avoid a collapsed box before the first resize message.
    iframe.style.cssText =
      "display:block;width:100%;max-width:100%;border:0;height:420px;";

    container.appendChild(iframe);
    frames.push(iframe);
  }

  function scan() {
    var containers = document.querySelectorAll("[data-gouplift-org]");
    for (var i = 0; i < containers.length; i++) mount(containers[i]);
  }

  // Only a resize message from GoUplift's own origin, sent by one of the
  // iframes this script created, is acted on; the value is a bounded number.
  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.type !== RESIZE_MESSAGE) return;

    var height = Number(data.height);
    if (!isFinite(height) || height < 0 || height > MAX_HEIGHT) return;

    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = Math.ceil(height) + "px";
      }
    }
  });

  window.GoUpliftEmbed = { scan: scan };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
})();
