import { writeFile } from "node:fs/promises";

import { createApiApp } from "../src/app";

const document = createApiApp().getOpenAPIDocument({
  openapi: "3.1.0",
  info: { title: "Clockwork Commerce API", version: "1.0.0" },
});
await writeFile(
  new URL("../src/generated/openapi.json", import.meta.url),
  `${JSON.stringify(document, null, 2)}\n`,
  "utf8",
);
