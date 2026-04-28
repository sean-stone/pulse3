import { useEffect, useRef, useState } from "react";

import { STORAGE_CONSENT_KEY } from "../app/constants";

const WELCOME_VIDEO_SEEN_KEY = "pulse-welcome-video-seen";
const WELCOME_VIDEO_URL = "https://www.youtube.com/watch?v=c0SyRpQI0EI";
const WELCOME_VIDEO_EMBED_URL =
  "https://www.youtube-nocookie.com/embed/c0SyRpQI0EI?rel=0&modestbranding=1";

let welcomeVideoDismissedForPage = false;

function canPersistWelcomePreference() {
  try {
    return window.localStorage?.getItem(STORAGE_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

function hasSeenWelcomeVideo() {
  if (welcomeVideoDismissedForPage) return true;
  if (!canPersistWelcomePreference()) return false;
  try {
    return window.localStorage?.getItem(WELCOME_VIDEO_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function markWelcomeVideoSeen() {
  welcomeVideoDismissedForPage = true;
  if (!canPersistWelcomePreference()) return;
  try {
    window.localStorage?.setItem(WELCOME_VIDEO_SEEN_KEY, "true");
  } catch {
    // Ignore storage failures; the dialog still closes for the current session.
  }
}

function WelcomeSplash() {
  const dialogRef = useRef<any>(null);
  const [shouldRenderVideo, setShouldRenderVideo] = useState(false);

  useEffect(() => {
    if (hasSeenWelcomeVideo()) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    setShouldRenderVideo(true);
    requestAnimationFrame(() => {
      dialog.open = true;
    });

    const handleClose = () => {
      markWelcomeVideoSeen();
      setShouldRenderVideo(false);
    };

    dialog.addEventListener("calciteDialogClose", handleClose);
    return () => {
      dialog.removeEventListener("calciteDialogClose", handleClose);
    };
  }, []);

  const handleStart = () => {
    markWelcomeVideoSeen();
    if (dialogRef.current) {
      dialogRef.current.open = false;
    }
    setShouldRenderVideo(false);
  };

  return (
    <calcite-dialog
      ref={dialogRef}
      id="welcome-splash-modal"
      className="welcome-splash-modal"
      heading="Welcome to Pulse"
      scale="m"
      overlay-positioning="fixed"
      placement="center"
    >
      <div className="welcome-splash">
        <div className="welcome-splash-video" aria-label="Pulse showcase video">
          {shouldRenderVideo ? (
            <iframe
              title="Pulse showcase video"
              src={WELCOME_VIDEO_EMBED_URL}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            ></iframe>
          ) : null}
        </div>
        <p>
          See how Pulse turns map features into animated stories, then start building your own scene.
        </p>
      </div>
      <div slot="footer" className="dialog-footer welcome-splash-footer">
        <calcite-button
          href={WELCOME_VIDEO_URL}
          target="_blank"
          rel="noreferrer"
          appearance="outline"
          icon-start="launch"
        >
          Open on YouTube
        </calcite-button>
        <calcite-button
          id="welcome-splash-start-btn"
          icon-start="check"
          onClick={handleStart}
          style={{
            "--calcite-button-text-color": "#ffffff",
            "--calcite-button-icon-color": "#ffffff",
          }}
        >
          Start using Pulse
        </calcite-button>
      </div>
    </calcite-dialog>
  );
}

export default WelcomeSplash;
