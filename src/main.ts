import { renderTilesetRoute } from "./routes/tileset";
import { renderHomeRoute } from "./routes/home";
import { renderWfcRoute } from "./routes/wfc";

function mount() {
  const app = document.getElementById("app");
  if (!app) throw new Error("Missing #app");
  app.innerHTML = "";
  return app;
}

function navigate(path: string) {
  history.pushState({}, "", path);
  route();
}

function linkify(root: HTMLElement) {
  // Make <a data-link href="/x"> use SPA navigation
  root.querySelectorAll<HTMLAnchorElement>("a[data-link]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href") || "/";
      if (!href.startsWith("/")) return; // external links behave normally
      e.preventDefault();
      navigate(href);
    });
  });
}

function setActiveNav(path: string) {
  // update pills in header nav (outside #app)
  document.querySelectorAll<HTMLAnchorElement>("a[data-nav]").forEach((a) => {
    const nav = a.getAttribute("data-nav") || "";
    a.setAttribute("data-active", nav === path ? "true" : "false");
  });

  const hint = document.getElementById("routeHint");
  if (hint) hint.textContent = path;
}

function route() {
  const app = mount();
  const path = window.location.pathname;

  setActiveNav(path);

  if (path === "/tileset") {
    renderTilesetRoute(app);
    linkify(app);
    return;
  }

  if (path === "/wfc") {
    renderWfcRoute(app);
    linkify(app);
    return;
  }

  // default route
  renderHomeRoute(app);
  linkify(app);
}

window.addEventListener("popstate", route);
route();
