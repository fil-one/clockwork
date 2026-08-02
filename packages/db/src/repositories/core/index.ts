export * from "./database-finance";
export * from "./commissions";
export * from "./commercial-artifacts";
export * from "./finance";
export * from "./invoice-derivation";
export * from "./price-book-administration";
export * from "./stripe-adjustments";

import { DatabaseCoreFinanceRepository } from "./database-finance";
import { DatabaseCommissionStatementRepository } from "./commissions";
import { CoreFinanceRepository } from "./finance";
import { DatabasePriceBookAdministrationReader } from "./price-book-administration";

export const coreRepositoryRegistry = [
  CoreFinanceRepository,
  DatabaseCoreFinanceRepository,
  DatabaseCommissionStatementRepository,
  DatabasePriceBookAdministrationReader,
] as const;
