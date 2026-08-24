import type { Page } from "@playwright/test";

const API_ORIGIN = process.env.CASHMEMO_V1_E2E_API_ORIGIN ?? "http://localhost:3001";
const connectedPages = new WeakSet<Page>();

export function apiUrl(path: string): string {
  return new URL(path, API_ORIGIN).toString();
}

export async function connectPageToRealApi(page: Page): Promise<void> {
  if (connectedPages.has(page)) return;
  connectedPages.add(page);
  await page.route("**/api/v1/**", async (route) => {
    const browserUrl = new URL(route.request().url());
    const response = await route.fetch({
      url: apiUrl(`${browserUrl.pathname}${browserUrl.search}`),
    });
    await route.fulfill({ response });
  });
}
