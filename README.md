# Pulse 3.11.0
Pulse 3.11.0 is a Vite + React application for building and previewing animated
map layers. It uses the ArcGIS Maps SDK for JavaScript and Calcite UI components to handle
mapping, layer styling, and timeline-based animation controls.

Pulse 3 demo link -> https://seanst.one/demos/pulse3/

## Previous Repos:
Pulse 2 link -> https://github.com/sean-stone/pulse
Pulse 1 link -> https://github.com/EsriUK/pulse


## Tech stack

- React 18 + TypeScript
- Vite 5
- ArcGIS JS API (`@arcgis/core`, `@arcgis/map-components`)
- Calcite Components (`@esri/calcite-components`)
- ESLint + Vitest

## Getting started

Install dependencies (runs a postinstall step that copies ArcGIS assets):

```bash
npm install
```

### Local development (Vite + PHP AI endpoint)

This app uses a PHP endpoint at `agent/anim.php`. For local dev, run both the Vite dev server and a PHP server.

1) Start the PHP server (from the repo root so `/agent/anim.php` is available):

Windows PowerShell:
```powershell
# From the repo root
$env:OPENAI_API_KEY="your_openai_key_here"
# Optional if you need CORS during dev:
$env:PULSE_ALLOWED_ORIGIN="http://localhost:5173"
npm run php:serve
```

macOS/Linux (bash/zsh):
```bash
# From the repo root
export OPENAI_API_KEY="your_openai_key_here"
# Optional if you need CORS during dev:
export PULSE_ALLOWED_ORIGIN="http://localhost:5173"
npm run php:serve
```

Notes:
- If `php` is not found, install PHP first (e.g. via your OS package manager).
- Leave this terminal running; it hosts `http://localhost:8000`.

#### PHP install (Windows)

If you see: `'php' is not recognized as an internal or external command`, install PHP and add it to PATH.

Option A (recommended): Winget
```powershell
winget search PHP.PHP
# Then install a specific version, for example:
winget install --id PHP.PHP.8.4 -e
```
Close and reopen PowerShell, then verify:
```powershell
php -v
```

Option B: Chocolatey
```powershell
choco install php
```
Close and reopen PowerShell, then verify:
```powershell
php -v
```

2) Start Vite:
```bash
npm run dev
```

3) Ensure the Vite dev server can reach the PHP endpoint:
   - Option A (recommended): add a Vite proxy for `/agent` to `http://localhost:8000`.
   - Option B: serve the built app from the same origin as PHP (see production steps below).

Start the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

### Production-style local preview (same origin as PHP)

If you want the app and PHP endpoint on the same origin:

```bash
npm run build
```

Then serve the repo root with PHP so `/dist` and `/agent` share the same origin:

```powershell
$env:OPENAI_API_KEY="your_openai_key_here"
php -S localhost:8000 -t .
```

Open `http://localhost:8000/dist/` in your browser.

Run linting and tests:

```bash
npm run lint
npm run test
```

## Project structure

- `src/` app code (controllers, components, styles, types)
- `public/` static assets served by Vite
- `scripts/` small build helpers (ArcGIS asset copy)
- `dist/` production build output

## Notes

- `npm install` runs `scripts/copy-arcgis-assets.cjs` to copy ArcGIS assets into `public/assets`.
- If map UI assets look missing, re-run `npm install` or `npm run postinstall`.

## AI + Routing integration

Pulse includes an AI prompt flow that generates a `ProjectSnapshot` via `agent/anim.php` (OpenAI Responses API).

### ChatGPT model usage
- Server-side only (PHP); no API keys in the browser.
- Model is configured in `agent/anim.php` or via `OPENAI_MODEL`.
- Response is strict JSON that matches the snapshot schema, with validation and guardrails.

Environment variables:
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`)
- `PULSE_ALLOWED_ORIGIN` (optional, for CORS during dev)
- `PULSE_SHARED_SECRET` (optional, shared-secret header gate)

### ArcGIS routing (optional)

If `ARCGIS_API_KEY` is set, the server will try to convert prompts like:
“Drive from A to B …” into real driving routes using ArcGIS World Route.

How it works:
1) Parse one or more `from A to B` pairs (max 5 per request).
2) Geocode A and B with ArcGIS World Geocoding.
3) Request a route from ArcGIS World Route (true-shape output).
4) Replace the polyline geometry with the routed path.

Notes:
- Routing only triggers if the prompt includes words like “drive/route/directions”.
- If routing fails, the server returns a 422 error (instead of silently falling back).
- Use one route per line for multi-route prompts.

Environment variable:
- `ARCGIS_API_KEY` (required for routing)

Example routing prompt:
```
1. Drive from Paris to Frankfurt.
2. Drive from Frankfurt to Munich.
3. Drive Munich to Barcelona.
4. Drive Barcelona back to Paris.
```

## Deployment secrets (.env + .htaccess)

This app uses **two** places for secrets:

1) **Server (.htaccess or hosting UI)** for PHP:

```apacheconf
# .htaccess (webspace)
SetEnv OPENAI_API_KEY "your_openai_key_here"
SetEnv OPENAI_MODEL "gpt-4.1-mini"
SetEnv PULSE_ALLOWED_ORIGIN "https://seanst.one"
SetEnv PULSE_SHARED_SECRET "your_long_random_string"
#SetEnv ARCGIS_API_KEY "your_arcgis_key_here"
```

2) **Frontend build (.env)** for the optional shared-secret header:

```
# .env (repo root, do NOT commit)
VITE_PULSE_SHARED_SECRET=your_long_random_string
```

Notes:
- `.env` should be git-ignored.
- The shared secret is a **lightweight gate**. It helps block random POSTs, but it’s visible in built JS.

## Security + limits

- Prompt max length: 4000 characters (server enforced)
- Animation duration capped at 60 seconds
- Routes per request capped at 5
- CORS can be locked to a single origin with `PULSE_ALLOWED_ORIGIN`

## Icon attribution

- Phosphor Icons (https://phosphoricons.com), MIT License. This project uses `@phosphor-icons/web`.

## Contributing

I am open to contributions. Please open a PR or issue and I will review.

## How we worked together

We stayed in short loops:
- You described the UX issue or desired wording.
- I located the specific file(s) and made a narrow change.
- You verified the result and asked for refinements.
- I adjusted until it matched your intent.

## Example prompts and outcomes

1) Prompt: "When changing a style, can it say 'ok' instead of apply?"
   - Change: Updated the label text in the style modal footer button.
   - Human/Codex: You called out the wording; I found the button and swapped
     the label with minimal impact elsewhere.

2) Prompt: "When a user presses 'add animation' can it NOT toggle the
   animation menu closed? ... pressing it again should just highlight the
   animation settings please"
   - Change: Prevented collapse on repeat press and added a brief highlight
     state to the settings panel.
   - Human/Codex: You defined the UX; I wired the click behavior and added a
     subtle visual cue.

3) Prompt: "The default width of the timeline layer icons ... can you default
   it to maybe double the width?"
   - Change: Updated the JS-controlled default width so it actually takes
     effect on load.
   - Human/Codex: You pointed to the visual issue; I traced the runtime width
     source rather than only CSS.

# NOTE
This full repo I did not write a single line of code... it was done using codex and about 2-3 evenings. I think this would have taken months to do manually. Especially considering the amount of iterations and changes I made to the UI during the process. I thought I'd share the code still so you can see the output.
