import type { Preview } from "@storybook/nextjs-vite";

import "@clockwork/ui/styles.css";

import { brandFontVariables } from "../app/fonts";

// The preview iframe renders stories without the root layout, so the catalog
// would be reviewed on the platform fallback while production ships the brand
// faces. Putting the same variables on the preview document root keeps the two
// looking alike. The `@storybook/nextjs-vite` framework compiles the
// `next/font/local` calls into real `@font-face` rules, so the faces resolve
// here the way they do in the application.
document.documentElement.classList.add(...brandFontVariables.split(" "));

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
    layout: "padded",
  },
};

export default preview;
