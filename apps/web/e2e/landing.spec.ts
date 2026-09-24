import { apiFor, expect, gotoHome, noHorizontalOverflow, PASSWORD, test } from "./helpers";

const hero = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { level: 1, name: "Your private money journal" });

test.describe("landing (signed out)", () => {
  test("/ shows the landing, URL stays /, no overflow, SEO metadata", async ({ page }) => {
    await page.goto("/");
    await expect(hero(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle("Cash Memo — Your private money journal");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/cashmemo\.andresholivin\.dev\/?$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/welcome\/opengraph-image/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    for (const name of ["Three habits, no setup", "Private by default, not by setting", "Questions, answered plainly", "Start this month’s page"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toHaveCount(1);
    }
    await noHorizontalOverflow(page);

    const og = await page.request.get("/welcome/opengraph-image");
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toBe("image/png");
  });

  test("Get started goes to /signup, Log in goes to /login", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main" });
    await page.goto("/");
    await nav.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "Create your journal" })).toBeVisible();

    await page.goto("/");
    await nav.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Get started free" }).first().click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("anchor links scroll to their sections", async ({ page, isMobile }) => {
    await page.goto("/");
    // The top nav only carries section links from 768 up; the footer carries them everywhere.
    const nav = page.getByRole("navigation", { name: isMobile ? "Footer" : "Main" });
    for (const [link, id] of [["Features", "features"], ["Privacy", "privacy"], ["FAQ", "faq"]] as const) {
      await nav.getByRole("link", { name: link, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`#${id} h2`)).toBeInViewport();
    }
  });

  test("FAQ items expand and collapse", async ({ page }) => {
    await page.goto("/");
    const answer = page.getByText("Cash Memo never asks for bank credentials");
    await expect(answer).toBeHidden();
    const question = page.getByText("Do you connect to my bank?");
    await question.click();
    await expect(answer).toBeVisible();
    await expect(page.locator("details", { has: question })).toHaveAttribute("open", "");
    await question.click();
    await expect(answer).toBeHidden();
  });

  test("landing -> Log in -> signed in lands on the app, not the landing", async ({ page, playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const { email } = await apiFor(anon).signup();
    await anon.dispose();

    await page.goto("/");
    await expect(hero(page)).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Log in" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("hero-net")).toBeVisible();
    await expect(hero(page)).toHaveCount(0);
  });
});

test("signed-in / still shows the app", async ({ page, user }) => {
  void user;
  await gotoHome(page);
  await expect(hero(page)).toHaveCount(0);
});
