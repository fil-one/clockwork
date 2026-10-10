export interface LegacyCallerLists {
  readonly literalLocales: readonly string[];
}

export declare const legacyCallers: Readonly<
  Record<
    | "partner"
    | "customer"
    | "experience"
    | "adminPricing"
    | "adminGovernance"
    | "operations"
    | "platform"
    | "demo",
    LegacyCallerLists
  >
>;

export declare function legacyFiles(kind: keyof LegacyCallerLists): string[];
