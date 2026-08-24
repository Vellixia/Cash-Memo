import { expect, type APIRequestContext, type Page } from "@playwright/test";

const MAILPIT_HTTP_URL =
  process.env.CASHMEMO_V1_E2E_MAILPIT_URL ??
  `http://127.0.0.1:${process.env.CASHMEMO_V1_E2E_MAILPIT_PORT ?? "8025"}`;
const PUBLIC_ORIGIN = process.env.CASHMEMO_V1_E2E_PUBLIC_ORIGIN ?? "http://localhost:3000";

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

function verificationUrlFrom(message: MailpitMessage): string | undefined {
  const content = `${message.Text ?? ""}\n${message.HTML ?? ""}`.replaceAll("&amp;", "&");
  for (const match of content.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const candidate = match[0].replace(/[),.;]+$/, "");
    try {
      const url = new URL(candidate);
      if (
        url.origin === PUBLIC_ORIGIN &&
        url.pathname === "/verify-email" &&
        url.searchParams.get("token")
      ) {
        return url.toString();
      }
    } catch {
      // Ignore unrelated malformed URLs in email wrappers.
    }
  }
  return undefined;
}

async function deliveredVerificationUrl(
  request: APIRequestContext,
  recipient: string,
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
  return verificationUrlFrom((await detail.json()) as MailpitMessage);
}

export async function openDeliveredVerification(page: Page, recipient: string): Promise<void> {
  let url: string | undefined;
  await expect
    .poll(
      async () => {
        url = await deliveredVerificationUrl(page.request, recipient);
        return url;
      },
      {
        message: `verification email with public link for ${recipient}`,
        intervals: [100, 250, 500, 1_000],
        timeout: 15_000,
      },
    )
    .toBeTruthy();
  if (!url) throw new Error(`verification email did not contain a public link for ${recipient}`);
  await page.goto(url);
}
