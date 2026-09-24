import { createApiApp, withExperienceOpenApiContract } from "@clockwork/api";

/**
 * The published API reference, derived from the contract the application
 * actually serves.
 *
 * WHY NOT A SECOND COPY. This repository has been bitten repeatedly by two
 * lists that agree on the day they are written and disagree a month later, and
 * a hand-written API reference is the worst version of that: the drift is
 * invisible from inside and expensive from outside. So there is no reference
 * document here. `apiReferenceDocument()` runs exactly the two calls
 * `packages/api/scripts/generate-openapi.ts` runs, which means the page renders
 * the same bytes that `packages/api/src/generated/openapi.json` holds and that
 * `pnpm check:generated` already fails the suite over. Adding a route to the
 * API adds it to this page; nobody has to remember.
 *
 * `api-reference.test.ts` asserts that equality against the committed artifact
 * rather than assuming it.
 *
 * WHAT THE PAGE THEN SAYS IS ALSO DERIVED. `credentialReadiness()` counts what
 * the contract declares about authentication instead of describing it. Today
 * that count is the honest and unflattering answer -- one cookie scheme, no
 * machine credential -- and when a credential scheme is implemented the page
 * changes on its own instead of waiting for someone to update prose.
 */

export interface ReferenceParameter {
  readonly name: string;
  readonly location: string;
  readonly required: boolean;
}

export interface ReferenceResponse {
  readonly status: string;
  readonly description: string;
}

export interface ReferenceOperation {
  readonly method: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly summary: string | undefined;
  readonly parameters: readonly ReferenceParameter[];
  readonly requestBodyRequired: boolean;
  readonly requestContentTypes: readonly string[];
  readonly responses: readonly ReferenceResponse[];
  /** Security scheme names the contract attaches to this operation. */
  readonly security: readonly string[];
}

export interface ReferenceGroup {
  readonly tag: string;
  readonly operations: readonly ReferenceOperation[];
}

export interface ReferenceSecurityScheme {
  readonly name: string;
  readonly type: string;
  readonly location: string | undefined;
  readonly parameterName: string | undefined;
  /**
   * A scheme a caller that is not a browser can present. A cookie is not one:
   * it is issued by an interactive sign-in and scoped to a browser session.
   */
  readonly usableWithoutABrowser: boolean;
}

export interface CredentialReadiness {
  readonly schemes: readonly ReferenceSecurityScheme[];
  readonly machineUsableSchemes: readonly ReferenceSecurityScheme[];
  readonly operationCount: number;
  readonly operationsWithDeclaredSecurity: number;
  readonly operationsWithNoDeclaredSecurity: number;
}

const documentInfo = {
  openapi: "3.1.0",
  info: { title: "Clockwork Commerce API", version: "1.0.0" },
} as const;

type OpenApiDocument = Record<string, unknown>;

export function apiReferenceDocument(): OpenApiDocument {
  return withExperienceOpenApiContract(
    createApiApp().getOpenAPIDocument(documentInfo),
  ) as unknown as OpenApiDocument;
}

const httpMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function apiReferenceOperations(
  document: OpenApiDocument = apiReferenceDocument(),
): readonly ReferenceOperation[] {
  const paths = record(document.paths);
  const operations: ReferenceOperation[] = [];
  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = record(pathItemValue);
    for (const method of httpMethods) {
      const operationValue = pathItem[method];
      if (!operationValue) continue;
      const operation = record(operationValue);
      const parameters = Array.isArray(operation.parameters)
        ? operation.parameters.map((parameterValue) => {
            const parameter = record(parameterValue);
            return {
              name: stringOrUndefined(parameter.name) ?? "",
              location: stringOrUndefined(parameter.in) ?? "",
              required: parameter.required === true,
            };
          })
        : [];
      const requestBody = record(operation.requestBody);
      const responses = record(operation.responses);
      operations.push({
        method: method.toUpperCase(),
        path,
        tags: Array.isArray(operation.tags)
          ? operation.tags.filter(
              (tag): tag is string => typeof tag === "string",
            )
          : [],
        summary:
          stringOrUndefined(operation.summary) ??
          stringOrUndefined(operation.description),
        parameters,
        requestBodyRequired: requestBody.required === true,
        requestContentTypes: Object.keys(record(requestBody.content)),
        responses: Object.entries(responses).map(([status, responseValue]) => ({
          status,
          description:
            stringOrUndefined(record(responseValue).description) ?? "",
        })),
        security: Array.isArray(operation.security)
          ? operation.security.flatMap((requirement) =>
              Object.keys(record(requirement)),
            )
          : [],
      });
    }
  }
  return operations;
}

/**
 * The group an operation with no tag is filed under. It is a key, not a label:
 * the page renders it as the translated "Untagged".
 */
export const untaggedGroup = "untagged";

export function apiReferenceGroups(
  document: OpenApiDocument = apiReferenceDocument(),
): readonly ReferenceGroup[] {
  const groups = new Map<string, ReferenceOperation[]>();
  for (const operation of apiReferenceOperations(document)) {
    // An untagged operation is still published. Hiding it would make the page
    // a smaller and prettier lie than the contract it claims to publish.
    const tag = operation.tags[0] ?? untaggedGroup;
    const bucket = groups.get(tag);
    if (bucket) bucket.push(operation);
    else groups.set(tag, [operation]);
  }
  return [...groups.entries()]
    .map(([tag, operations]) => ({
      tag,
      operations: [...operations].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.method.localeCompare(right.method),
      ),
    }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

export function credentialReadiness(
  document: OpenApiDocument = apiReferenceDocument(),
): CredentialReadiness {
  const declared = record(record(document.components).securitySchemes);
  const schemes: ReferenceSecurityScheme[] = Object.entries(declared).map(
    ([name, schemeValue]) => {
      const scheme = record(schemeValue);
      const location = stringOrUndefined(scheme.in);
      const type = stringOrUndefined(scheme.type) ?? "";
      return {
        name,
        type,
        location,
        parameterName: stringOrUndefined(scheme.name),
        usableWithoutABrowser:
          type === "http" ||
          type === "oauth2" ||
          type === "mutualTLS" ||
          (type === "apiKey" && location !== "cookie"),
      };
    },
  );
  const operations = apiReferenceOperations(document);
  const withSecurity = operations.filter(
    (operation) => operation.security.length > 0,
  ).length;
  return {
    schemes,
    machineUsableSchemes: schemes.filter(
      (scheme) => scheme.usableWithoutABrowser,
    ),
    operationCount: operations.length,
    operationsWithDeclaredSecurity: withSecurity,
    operationsWithNoDeclaredSecurity: operations.length - withSecurity,
  };
}
