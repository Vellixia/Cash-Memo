import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { PUBLIC_ORIGIN } from "./environment.mjs";

const MAILPIT_HTTP_URL =
  process.env.CASHMEMO_V1_E2E_MAILPIT_URL ??
  `http://127.0.0.1:${process.env.CASHMEMO_V1_E2E_MAILPIT_PORT ?? "8025"}`;

interface MailpitAddress {
  Address?: string;
}

interface MailpitMessageSummary {
  ID?: string;
  To?: MailpitAddress[];
}

interface MailpitSearchResponse {
  messages?: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text?: string;
  HTML?: string;
}

/** Delivered links must carry the single-use token in the fragment, never in the query string. */
function fragmentTokenUrlFrom(message: MailpitMessage, pathname: string): string | undefined {
  const content = `${message.Text ?? ""}\n${message.HTML ?? ""}`.replaceAll("&amp;", "&");
  for (const match of content.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const candidate = match[0].replace(/[),.;]+$/, "");
    try {
      const url = new URL(candidate);
      if (url.origin !== PUBLIC_ORIGIN || url.pathname !== pathname) continue;
      if (url.search !== "") continue;
      const fragmentToken = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
      if (fragmentToken) return url.toString();
    } catch {
      // Ignore unrelated malformed URLs in email wrappers.
    }
  }
  return undefined;
}

async function deliveredFragmentTokenUrl(
  request: APIRequestContext,
  recipient: string,
  pathname: string,
): Promise<string | undefined> {
  const search = await request.get(`${MAILPIT_HTTP_URL}/api/v1/search`, {
    params: { query: `to:${recipient}` },
  });
  if (!search.ok()) return undefined;
  const payload = (await search.json()) as MailpitSearchResponse;
  const summary = payload.messages?.find((message) =>
    message.To?.some((address) => address.Address?.toLowerCase() === recipient.toLowerCase()),
  );
  if (!summary?.ID) return undefined;

  const detail = await request.get(`${MAILPIT_HTTP_URL}/api/v1/message/${summary.ID}`);
  if (!detail.ok()) return undefined;
  return fragmentTokenUrlFrom((await detail.json()) as MailpitMessage, pathname);
}

async function openDeliveredFragmentLink(
  page: Page,
  recipient: string,
  pathname: string,
): Promise<string> {
  let url: string | undefined;
  await expect
    .poll(
      async () => {
        url = await deliveredFragmentTokenUrl(page.request, recipient, pathname);
        return url;
      },
      {
        message: `email with public ${pathname} fragment link for ${recipient}`,
        intervals: [100, 250, 500, 1_000],
        timeout: 15_000,
      },
    )
    .toBeTruthy();
  if (!url) {
    throw new Error(`email did not contain a public ${pathname} fragment link for ${recipient}`);
  }
  await page.goto(url);
  return url;
}

export async function openDeliveredVerification(page: Page, recipient: string): Promise<string> {
  return openDeliveredFragmentLink(page, recipient, "/verify-email");
}

export async function openDeliveredPasswordReset(page: Page, recipient: string): Promise<string> {
  return openDeliveredFragmentLink(page, recipient, "/reset-password");
}
