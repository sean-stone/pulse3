import { useEffect } from "react";

import { bootApp } from "./appController";
import MapArea from "./components/MapArea";
import SidePanel from "./components/SidePanel";
import Timeline from "./components/Timeline";

export default function App() {
  useEffect(() => {
    bootApp();
  }, []);

  return (
    <>
      <div id="map-loading-overlay" aria-live="polite" aria-busy="true">
        <div className="map-loading-swarm" aria-hidden="true">
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
        </div>
        <div className="map-loading-pin" role="img" aria-label="Loading">
          <span className="map-loading-pin-dot" aria-hidden="true"></span>
        </div>
      </div>
      <div id="app-container">
        <div id="mobile-header" aria-label="Mobile tools"></div>
        <div id="main-area">
          <div id="mobile-animation-suggestions" aria-live="polite"></div>
          <MapArea />
          <div id="timeline-resizer" data-testid="timeline-resizer"></div>
          <Timeline />
        </div>
        <SidePanel />
      </div>
    </>
  );
}
