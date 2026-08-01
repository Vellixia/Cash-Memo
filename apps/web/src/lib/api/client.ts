import type { components } from "./generated";

export type ApiProblem = components["schemas"]["ErrorResponse"];

export class ApiProblemError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.message);
    this.name = "ApiProblemError";
    this.problem = problem;
  }
}

export async function apiRequest<T>(
  path: `/api/v1/${string}`,
  init: RequestInit = {},
): Promise<T> {
  if (path.includes("?") || path.includes("#")) {
    throw new TypeError("API values must be sent in a request body");
  }
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json, application/problem+json",
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("application/problem+json")) {
      throw new Error("Cashmemo service unavailable");
    }
    throw new ApiProblemError((await response.json()) as ApiProblem);
  }
  return (await response.json()) as T;
}
