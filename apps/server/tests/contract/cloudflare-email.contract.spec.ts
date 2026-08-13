import { describe, expect, it, vi } from "vitest";

import {
  CloudflareEmailDeliveryError,
  createCloudflareEmailAdapter,
} from "../../src/adapters/cloudflare/cloudflare-email.adapter.js";

const options = (fetchImplementation: typeof fetch) => ({
  accountId: "synthetic-account",
  apiToken: "synthetic-cloudflare-token-material-00000001",
  fetchImplementation,
  fromAddress: "noreply@cashmemo.test",
  retryLimit: 1,
  timeoutMilliseconds: 100,
});

const input = {
  destination: "recipient@cashmemo.test",
  oneTimeUrl: "https://cashmemo.test/verify?token=synthetic",
  operation: "verification" as const,
};

describe("Cloudflare Email Service adapter", () => {
  it("sends the official account-scoped request and returns content-free status", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ result: { delivered: true }, success: true }), {
        headers: { "cf-ray": "synthetic-ray" },
        status: 200,
      }),
    );
    const result = await createCloudflareEmailAdapter(options(request)).send(input);
    expect(result).toMatchObject({
      operation: "verification",
      providerMessageId: "synthetic-ray",
      state: "accepted",
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/synthetic-account/email/sending/send",
    );
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer synthetic-cloudflare-token-material-00000001",
      "Content-Type": "application/json",
    });
  });

  it("retries a transient provider response once", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(createCloudflareEmailAdapter(options(request)).send(input)).resolves.toMatchObject(
      {
        state: "accepted",
      },
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("maps permanent failures without echoing provider response or message content", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("synthetic provider detail", { status: 400 }));
    const error = await createCloudflareEmailAdapter(options(request))
      .send(input)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CloudflareEmailDeliveryError);
    expect((error as Error).message).toBe("EMAIL_PERMANENT_FAILURE");
    expect(JSON.stringify(error)).not.toMatch(/recipient|token|provider detail/iu);
  });

  it("fails closed on invalid configuration", () => {
    expect(() => createCloudflareEmailAdapter({ ...options(fetch), apiToken: "short" })).toThrow(
      "EMAIL_CONFIGURATION_INVALID",
    );
  });
});
