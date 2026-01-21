import esriConfig from "@arcgis/core/config";
import { defineCustomElements as defineArcgisMapElements } from "@arcgis/map-components/dist/loader";
import { defineCustomElements as defineCalciteElements } from "@esri/calcite-components/dist/loader";
import { createRoot } from "react-dom/client";

import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/dist/calcite/calcite.css";
import App from "./App";
import "./styles.css";

defineCalciteElements(window);
defineArcgisMapElements(window);
esriConfig.assetsPath = `${import.meta.env.BASE_URL}assets`;

createRoot(document.getElementById("root")!).render(<App />);
