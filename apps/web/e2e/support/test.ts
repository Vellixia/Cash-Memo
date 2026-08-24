import { expect, test as base } from "@playwright/test";

export type { APIResponse, Route } from "@playwright/test";
export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    try {
      await use(page);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  },
});
