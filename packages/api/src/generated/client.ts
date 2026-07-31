import createClient from "openapi-fetch";

import type { paths } from "./schema";

export const createClockworkClient = (
  baseUrl: string,
  fetchImplementation: typeof fetch = fetch,
) => createClient<paths>({ baseUrl, fetch: fetchImplementation });
