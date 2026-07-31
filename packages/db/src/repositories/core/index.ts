export * from "./database-finance";
export * from "./commissions";
export * from "./commercial-artifacts";
export * from "./finance";

import { DatabaseCoreFinanceRepository } from "./database-finance";
import { DatabaseCommissionStatementRepository } from "./commissions";
import { CoreFinanceRepository } from "./finance";

export const coreRepositoryRegistry = [
  CoreFinanceRepository,
  DatabaseCoreFinanceRepository,
  DatabaseCommissionStatementRepository,
] as const;
