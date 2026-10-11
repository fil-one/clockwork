import type { Route } from "next";

export const templateAdminHref =
  "/internal/contracts/manage-templates" as Route;

export const versionHref = (id: string) =>
  `/internal/contracts/manage-templates/${id}` as Route;
