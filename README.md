# Pulse 3.2.1
Pulse 3.2.1 is a Vite + React application for building and previewing animated
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

## Icon attribution

- Phosphor Icons (https://phosphoricons.com), MIT License. This project uses `@phosphor-icons/web`.

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
