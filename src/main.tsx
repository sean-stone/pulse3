import esriConfig from "@arcgis/core/config";
import { defineCustomElements as defineArcgisMapElements } from "@arcgis/map-components/dist/loader";
import { defineCustomElements as defineCalciteElements } from "@esri/calcite-components/dist/loader";
import * as ReactDOMClient from "react-dom/client";

import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/dist/calcite/calcite.css";
import App from "./App";
import "./styles.css";

defineCalciteElements(window);
defineArcgisMapElements(window);
esriConfig.assetsPath = `${import.meta.env.BASE_URL}assets`;

const rootEl = document.getElementById("root");
const createRoot =
  (ReactDOMClient as any).createRoot ??
  ((ReactDOMClient as any).default ? (ReactDOMClient as any).default.createRoot : null);
if (!createRoot) {
  throw new Error("React createRoot is unavailable.");
}
createRoot(rootEl!).render(<App />);
