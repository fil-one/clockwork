import type { Preview } from "@storybook/nextjs-vite";

import "@clockwork/ui/styles.css";

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
    layout: "padded",
  },
};

export default preview;
