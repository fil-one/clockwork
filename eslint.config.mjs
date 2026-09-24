import eslint from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

import { legacyFiles } from "./apps/web/src/i18n/legacy-callers/index.mjs";

/*
 * Translation fences for the web app. Feature code gets its translator from
 * `@/src/i18n/server` or `@/src/i18n/client`, renders message IDs, and formats
 * with the reader's formatting locale. The legacy English-text lookup and
 * literal locales are allowed only in the files each lane lists under
 * apps/web/src/i18n/legacy-callers/, and those lists only shrink.
 */
const i18nSources = [
  "apps/web/src/**/*.{ts,tsx}",
  "apps/web/app/**/*.{ts,tsx}",
];
const i18nExempt = [
  "apps/web/src/i18n/**",
  "**/*.test.{ts,tsx}",
  "**/*.test-fixture.ts",
  "**/*.stories.{ts,tsx}",
];
const catalogImport = {
  name: "@/src/i18n/catalogs",
  message:
    "Catalogs are server-side and hold every language. Use getTranslations() from @/src/i18n/server or useTranslations() from @/src/i18n/client.",
};
const legacyCopyImport = {
  name: "@/src/i18n/copy",
  message:
    'localizeCopy/translateInterfaceText map English back to IDs and silently leave anything unmatched in English. Call t("message.id") instead.',
};
const englishTranslator = {
  selector:
    "CallExpression[callee.name='translatorFor'][arguments.0.value='en']",
  message:
    "No English fallback translator in feature code: take the reader's translator as a required parameter.",
};
const literalLocales = [
  {
    selector:
      "NewExpression[callee.object.name='Intl'][arguments.0.type='Literal']",
    message:
      "Format with the reader's formatting locale (useFormattingLocale, getFormattingLocale or the route session's locale), not a literal.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/][arguments.0.type='Literal']",
    message:
      "Format with the reader's formatting locale, not a literal locale.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/][arguments.length=0]",
    message:
      "toLocaleString() without a locale uses the runtime's language, not the reader's. Pass the formatting locale.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/.next-*/**",
      // Deploy adapter output. Generated into the app directory during a build
      // and not part of the compiled project.
      "**/.netlify/**",
      "**/.trigger/**",
      // OpenTofu provider and module caches under deploy/, present after a
      // local `make init`; the Lambda module ships JavaScript fixtures.
      "**/.terraform/**",
      // Release reports and downloaded test browsers are generated artifacts.
      "**/.artifacts/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/storybook-static/**",
      "packages/api/src/generated/**",
      // Type declarations for the plain-JS lists eslint itself imports.
      "apps/web/src/i18n/legacy-callers/*.d.mts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "import/no-cycle": "error",
      "import/no-duplicates": "error",
    },
  },
  {
    files: i18nSources,
    ignores: i18nExempt,
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [catalogImport, legacyCopyImport] },
      ],
      "no-restricted-syntax": ["error", englishTranslator, ...literalLocales],
    },
  },
  {
    // The root layout hands the selected catalog to the client provider.
    files: ["apps/web/app/layout.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: [legacyCopyImport] }],
    },
  },
  // Spread so an emptied list drops its block instead of an empty `files`.
  ...[legacyFiles("localizeCopy")]
    .filter((files) => files.length > 0)
    .map((files) => ({
      files,
      rules: {
        "no-restricted-imports": ["error", { paths: [catalogImport] }],
      },
    })),
  ...[legacyFiles("literalLocales")]
    .filter((files) => files.length > 0)
    .map((files) => ({
      files,
      rules: { "no-restricted-syntax": ["error", englishTranslator] },
    })),
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
);
