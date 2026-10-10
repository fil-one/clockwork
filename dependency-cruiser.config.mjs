const layers = [
  "contracts",
  "domain",
  "db",
  "integrations",
  "workflows",
  "documents",
  "ui",
  "testing",
  "api",
];

const allowed = {
  contracts: [],
  domain: ["contracts"],
  db: ["contracts", "domain"],
  integrations: ["contracts", "domain"],
  workflows: ["contracts", "domain", "db", "integrations"],
  documents: ["contracts", "domain", "ui"],
  ui: ["contracts"],
  testing: layers,
  api: ["contracts", "domain", "db", "integrations", "workflows"],
};

const forbidden = layers.flatMap((from) =>
  layers
    .filter((to) => from !== to && !allowed[from].includes(to))
    .map((to) => ({
      name: `${from}-must-not-import-${to}`,
      severity: "error",
      from: { path: `^packages/${from}/` },
      to: { path: `^packages/${to}/` },
    })),
);

// Staff routes render in English and their message modules are English only
// (docs/operations/localization.md), so customer, partner and demo code must
// not pull staff UI in. `@/` imports are matched unresolved: this config
// resolves with the base tsconfig, which does not know the web app's alias.
const staffCode = "^(apps/web/|@/)src/features/internal-ops/";
const readerSurfaces = [
  "^apps/web/src/features/customer-partner/",
  "^apps/web/app/\\(experience\\)/\\((customer|partner)\\)/",
  "^apps/web/app/demo/",
];

export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    ...forbidden,
    {
      name: "reader-surfaces-must-not-import-staff-code",
      severity: "error",
      from: {
        path: readerSurfaces,
        // Staff UI that lives in the customer tree and renders only at
        // /internal/payg-requests.
        pathNot: "^apps/web/src/features/customer-partner/acquisition/finance",
      },
      to: {
        path: staffCode,
        // Server-only demo fixtures with no interface text: the commercial
        // policies and price books the demo customer and partner flows read.
        pathNot:
          "internal-ops/(commercial-policies/demo-policies|price-books/demo-price-books)(\\.ts)?$",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
