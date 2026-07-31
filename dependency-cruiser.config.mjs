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

export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    ...forbidden,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
