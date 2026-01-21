export const animationTypes = {
  point: [
    { value: "fadeIn", label: "Fade In" },
    { value: "fadeOut", label: "Fade Out" },
    { value: "pulse", label: "Pulse" },
    { value: "bounce", label: "Bounce" },
    { value: "spin", label: "Spin" },
    { value: "grow", label: "Grow" }
  ],
  polyline: [
    { value: "draw", label: "Draw Line" },
    { value: "drawReverse", label: "Draw Line (Reverse)" },
    { value: "fadeIn", label: "Fade In" },
    { value: "fadeOut", label: "Fade Out" }
  ],
  polygon: [
    { value: "fadeIn", label: "Fade In" },
    { value: "fadeOut", label: "Fade Out" },
    { value: "fill", label: "Fill Animation" },
    { value: "pulse", label: "Pulse" }
  ],
  text: [
    { value: "fadeIn", label: "Fade In" },
    { value: "fadeOut", label: "Fade Out" },
    { value: "typewriter", label: "Typewriter" },
    { value: "bounce", label: "Bounce" }
  ],
  feature: [
    { value: "field", label: "Field Animation" }
  ]
} as const;

export const clipColors = [
  "clip-color-1",
  "clip-color-2",
  "clip-color-3",
  "clip-color-4",
  "clip-color-5",
  "clip-color-6"
];
