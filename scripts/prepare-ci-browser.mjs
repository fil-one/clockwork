import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function verifyBrowserImage(image, version) {
  assert.match(
    image,
    /^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[a-f\d]{64}$/,
    "The browser environment must use an immutable official Playwright image.",
  );
  assert.equal(image.split(":v")[1].split("-noble")[0], version);
}

export function missingBrowserLibraries(error) {
  return /Host system is missing dependencies|error while loading shared libraries/.test(
    String(error),
  );
}

async function main() {
  const image = process.env.CLOCKWORK_PLAYWRIGHT_IMAGE;
  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  assert.ok(
    browserRoot,
    "PLAYWRIGHT_BROWSERS_PATH must name the isolated store.",
  );
  if (image) {
    const manifest = JSON.parse(
      await readFile(
        new URL("../apps/web/package.json", import.meta.url),
        "utf8",
      ),
    );
    verifyBrowserImage(image, manifest.devDependencies["@playwright/test"]);
    const directories = (await readdir("/ms-playwright")).filter((name) =>
      /^(chromium-|chromium_headless_shell-|ffmpeg-)/.test(name),
    );
    assert.ok(directories.length >= 3, "The image is missing Chromium assets.");
    await mkdir(browserRoot, { recursive: true });
    for (const name of directories)
      await cp(
        path.join("/ms-playwright", name),
        path.join(browserRoot, name),
        {
          recursive: true,
        },
      );
  } else {
    // GitHub's Ubuntu runner already supplies Chromium's runtime libraries.
    // Avoid upgrading the OS and downloading fonts before every proof run.
    execFileSync("pnpm", ["playwright:install"], { stdio: "inherit" });
  }

  const require = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  );
  const { chromium } = require("@playwright/test");
  const launch = async () => {
    const browser = await chromium.launch();
    await browser.close();
  };
  try {
    await launch();
  } catch (error) {
    // A runner-image change may remove a system library. Only that diagnosed
    // setup failure installs OS dependencies; product tests are never retried.
    if (image || !missingBrowserLibraries(error)) throw error;
    execFileSync("pnpm", ["playwright:install:ci"], { stdio: "inherit" });
    await launch();
  }
  console.log("Pinned Chromium launches successfully in the isolated store.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
