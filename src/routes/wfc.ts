import { loadTilesetAsTileDefs } from "../components/tileset_loader";
import { createWfcView } from "../components/wfc_view";

export async function renderWfcRoute(root: HTMLElement) {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "baseline";
  header.style.justifyContent = "space-between";

  root.appendChild(header);

  const mount = document.createElement("div");
  root.appendChild(mount);

  try {
    const { tileSize, tileDefs } = await loadTilesetAsTileDefs();

    // Start conservative while you validate constraints.
    // You can crank this later.
    const WORLD_PX = 1000;
    const gridW = Math.floor(WORLD_PX / tileSize);
    const gridH = Math.floor(WORLD_PX / tileSize);

    await createWfcView({
      mountEl: mount,
      tileSize,
      tiles: tileDefs,
      gridW,
      gridH,
      seed: 12345,
    });
  } catch (err: any) {
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.padding = "12px";
    pre.style.border = "1px solid #232323";
    pre.style.borderRadius = "12px";
    pre.style.background = "#0f0f0f";
    pre.textContent = String(err?.stack ?? err);
    root.appendChild(pre);
  }
}
