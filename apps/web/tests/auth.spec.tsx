import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  getPostLoginPath,
  getSafeReturnPath,
  isSafeReturnPath,
  clearSessionState,
  deletionActionsForStatus,
  getDeletionErrorDestination,
} from "../lib/auth/session";
import { credentialsSchema as sharedCredentialsSchema } from "../lib/validation/auth";

const api = vi.hoisted(() => ({
  routes: [] as string[],
  searchParams: new URLSearchParams(),
  pathname: "/app",
  verify: vi.fn(),
  resend: vi.fn(),
  consumeReset: vi.fn(),
  requestReset: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  session: {
    data: undefined as
      { data: { access: string; session_id: string; user_id: string } } | undefined,
    isPending: false,
    isError: false,
    error: undefined as { response?: { status?: number } } | undefined,
  },
  financialMounts: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (path: string) => api.routes.push(path),
    push: (path: string) => api.routes.push(path),
  }),
  useSearchParams: () => api.searchParams,
  usePathname: () => api.pathname,
}));

vi.mock("../generated/api", () => ({
  useVerifyEmail: () => ({ mutateAsync: api.verify, isPending: false }),
  useResendVerification: () => ({ mutateAsync: api.resend, isPending: false }),
  useConsumePasswordReset: () => ({ mutateAsync: api.consumeReset, isPending: false }),
  useRequestPasswordReset: () => ({ mutateAsync: api.requestReset, isPending: false }),
  useRegister: () => ({ mutateAsync: api.register, isPending: false }),
  useLogin: () => ({ mutateAsync: api.login, isPending: false }),
  useLogout: () => ({ mutateAsync: api.logout, isPending: false }),
  useCurrentSession: () => api.session,
  currentSession: vi.fn(),
  getCurrentSessionQueryKey: () => ["/api/v1/auth/session"],
}));

const {
  ACCOUNT_EMAIL_ACCEPTED_MESSAGE,
  ForgotPasswordForm,
  LoginForm,
  RegisterForm,
  ResetPasswordForm,
  VerifyEmailForm,
  credentialsSchema: formCredentialsSchema,
  extractFragmentToken,
} = await import("../features/auth/forms");
const { AuthGate, resolveGateAccess, resolveGateDecision } =
  await import("../components/auth-gate");

function setHash(hash: string) {
  window.history.replaceState(null, "", `/verify-email${hash}`);
}

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const clearSpy = vi.spyOn(client, "clear");
  return {
    client,
    clearSpy,
    ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  };
}

beforeEach(() => {
  api.routes.length = 0;
  api.searchParams = new URLSearchParams();
  api.pathname = "/app";
  api.financialMounts = 0;
  api.session = { data: undefined, isPending: false, isError: false, error: undefined };
  api.verify.mockReset().mockResolvedValue({ data: undefined });
  api.resend.mockReset().mockResolvedValue({ data: { accepted: true } });
  api.consumeReset.mockReset().mockResolvedValue({ data: undefined });
  api.requestReset.mockReset().mockResolvedValue({ data: { accepted: true } });
  api.register.mockReset().mockResolvedValue({ data: { accepted: true } });
  api.login.mockReset().mockResolvedValue({ data: { access: "FULL" } });
  api.logout.mockReset().mockResolvedValue({ data: undefined });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("auth navigation safety", () => {
  it("allows internal app return paths", () => {
    expect(isSafeReturnPath("/app/transactions")).toBe(true);
    expect(getSafeReturnPath("/app/transactions")).toBe("/app/transactions");
  });

  it("rejects external, malformed, and destructive return paths", () => {
    expect(isSafeReturnPath("//evil.example")).toBe(false);
    expect(isSafeReturnPath("https://evil.example")).toBe(false);
    expect(isSafeReturnPath("/app/settings/delete-account")).toBe(false);
    expect(getSafeReturnPath("//evil.example")).toBe("/app");
  });

  it("clears in-memory server state on session end", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["private-memo"], { amount: "85000" });
    clearSessionState(queryClient);
    expect(queryClient.getQueryData(["private-memo"])).toBeUndefined();
  });

  it("routes deletion-only login access to the deletion screen", () => {
    expect(getPostLoginPath("DELETION_ONLY", "/app/transactions")).toBe("/deletion");
  });

  it("routes full login access through safe return path", () => {
    expect(getPostLoginPath("FULL", "/app/transactions")).toBe("/app/transactions");
    expect(getPostLoginPath("FULL", "//evil.example")).toBe("/app");
  });

  it("fails closed for unknown or missing login access", () => {
    expect(getPostLoginPath("UNKNOWN", "/app/transactions")).toBe("/login");
    expect(getPostLoginPath(undefined, "/app/transactions")).toBe("/login");
  });

  it("renders cancel action only for API pending_deletion status", () => {
    expect(deletionActionsForStatus("pending_deletion").canCancel).toBe(true);
    expect(deletionActionsForStatus("pending").canCancel).toBe(false);
    expect(deletionActionsForStatus("requested").canCancel).toBe(false);
    expect(deletionActionsForStatus("purging")).toEqual({ canCancel: false, signOutOnly: true });
  });

  it("fails closed to login when deletion status is unauthorized", () => {
    expect(getDeletionErrorDestination({ response: { status: 401 } })).toBe("/login");
  });

  it("uses one canonical credentials schema for auth forms", () => {
    expect(formCredentialsSchema).toBe(sharedCredentialsSchema);
  });
});

describe("fragment token extraction", () => {
  it("reads a token only from the URL fragment", () => {
    expect(extractFragmentToken("#token=abc123")).toBe("abc123");
    expect(extractFragmentToken("token=abc123")).toBe("abc123");
  });

  it("decodes form-encoded fragment tokens exactly", () => {
    expect(extractFragmentToken("#token=raw+%2B%2F%3D%3F%26+token")).toBe("raw +/=?& token");
  });

  it("never accepts a query-string token", () => {
    expect(extractFragmentToken("?token=abc123")).toBe("");
    expect(extractFragmentToken("")).toBe("");
    expect(extractFragmentToken("#")).toBe("");
    expect(extractFragmentToken("#token=")).toBe("");
    expect(extractFragmentToken("#other=abc123")).toBe("");
  });
});

describe("email verification page", () => {
  it("verifies the fragment token, clears the fragment, and persists nothing", async () => {
    setHash("#token=fragment-token");
    renderWithClient(<VerifyEmailForm />);

    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => {
      expect(api.verify).toHaveBeenCalledWith({ data: { token: "fragment-token" } });
    });
    await waitFor(() => {
      expect(window.location.hash).toBe("");
    });
    expect((await screen.findByRole("status")).textContent).toMatch(/Email verified/i);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toContain("fragment-token");
  });

  it("ignores a query-string token and offers resend instead", async () => {
    api.searchParams = new URLSearchParams("token=query-token&email=someone@example.test");
    window.history.replaceState(null, "", "/verify-email?token=query-token");
    renderWithClient(<VerifyEmailForm />);

    expect(screen.queryByRole("button", { name: "Verify email" })).toBeNull();
    expect(api.verify).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/link is incomplete or expired/i);
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("keeps the fragment when verification fails so the link can be retried", async () => {
    setHash("#token=fragment-token");
    api.verify.mockRejectedValue({ response: { data: { error: { message: "Link expired." } } } });
    renderWithClient(<VerifyEmailForm />);

    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    expect((await screen.findByRole("alert")).textContent).toMatch("Link expired.");
    expect(window.location.hash).toBe("#token=fragment-token");
  });

  it("uses the shared enumeration-safe accepted message for resend", async () => {
    window.history.replaceState(null, "", "/verify-email");
    renderWithClient(<VerifyEmailForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    await waitFor(() => {
      expect(api.resend).toHaveBeenCalledWith({ data: { email: "someone@example.test" } });
    });
    expect((await screen.findByRole("status")).textContent).toMatch(ACCOUNT_EMAIL_ACCEPTED_MESSAGE);
    expect(ACCOUNT_EMAIL_ACCEPTED_MESSAGE).not.toMatch(
      /exist|registered|already|unknown|no account/i,
    );
  });
});

describe("registration page", () => {
  it("shows the same enumeration-safe accepted message as resend and never leaks the email into a URL", async () => {
    renderWithClient(<RegisterForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect((await screen.findByRole("status")).textContent).toMatch(ACCOUNT_EMAIL_ACCEPTED_MESSAGE);
    expect(api.routes).toEqual([]);
    expect(screen.getByRole("button", { name: "Resend email" })).toBeTruthy();
  });

  it("resends verification for the accepted address without re-entry", async () => {
    renderWithClient(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("button", { name: "Resend email" });

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    await waitFor(() => {
      expect(api.resend).toHaveBeenCalledWith({ data: { email: "someone@example.test" } });
    });
  });
});

describe("forgot password page", () => {
  it("always shows the accepted state, on success and on failure", async () => {
    const first = renderWithClient(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/check your email/i);
    first.unmount();

    api.requestReset.mockRejectedValue(new Error("network down"));
    renderWithClient(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/check your email/i);
  });
});

describe("password reset page", () => {
  it("submits the fragment token and clears the fragment only after success", async () => {
    window.history.replaceState(null, "", "/reset-password#token=reset-token");
    api.consumeReset.mockRejectedValueOnce({
      response: { data: { error: { message: "Reset link expired." } } },
    });
    renderWithClient(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect((await screen.findByRole("alert")).textContent).toMatch("Reset link expired.");
    expect(window.location.hash).toBe("#token=reset-token");
    expect(api.consumeReset).toHaveBeenCalledWith({
      data: { password: "correct horse battery staple", token: "reset-token" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("");
    });
    expect(api.routes).toContain("/login");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("refuses a query-string reset token", () => {
    api.searchParams = new URLSearchParams("token=query-token");
    window.history.replaceState(null, "", "/reset-password?token=query-token");
    renderWithClient(<ResetPasswordForm />);

    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/reset link is invalid or expired/i);
  });
});

describe("login page", () => {
  it("routes deletion-only access to the restricted deletion screen and clears private cache", async () => {
    api.login.mockResolvedValue({ data: { access: "DELETION_ONLY" } });
    const { clearSpy } = renderWithClient(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(api.routes).toEqual(["/deletion"]);
    });
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("restricted-mode routing", () => {
  it("resolves full-access gate decisions without leaking private routes", () => {
    expect(resolveGateDecision({ status: "pending", allow: "full" })).toEqual({ kind: "loading" });
    expect(resolveGateDecision({ status: "ready", access: "FULL", allow: "full" })).toEqual({
      kind: "render",
    });
    expect(
      resolveGateDecision({ status: "ready", access: "DELETION_ONLY", allow: "full" }),
    ).toEqual({ kind: "redirect", destination: "/deletion", clearPrivateCache: true });
    expect(resolveGateDecision({ status: "ready", access: "UNKNOWN", allow: "full" })).toEqual({
      kind: "redirect",
      destination: "/login",
      clearPrivateCache: true,
    });
    expect(resolveGateDecision({ status: "error", errorStatus: 401, allow: "full" })).toEqual({
      kind: "redirect",
      destination: "/login",
      clearPrivateCache: true,
    });
  });

  it("treats the frozen restricted 403 as deletion-only access, never as a full session", () => {
    expect(resolveGateDecision({ status: "error", errorStatus: 403, allow: "full" })).toEqual({
      kind: "redirect",
      destination: "/deletion",
      clearPrivateCache: true,
    });
    expect(
      resolveGateDecision({ status: "error", errorStatus: 403, allow: "deletion-only" }),
    ).toEqual({ kind: "render" });
    expect(resolveGateAccess({ status: "error", errorStatus: 403 })).toBe("DELETION_ONLY");
    expect(resolveGateAccess({ status: "error", errorStatus: 401 })).toBeUndefined();
    expect(resolveGateAccess({ status: "error", errorStatus: 500 })).toBeUndefined();
    expect(resolveGateAccess({ status: "pending", access: "FULL" })).toBeUndefined();
  });

  it("resolves deletion-only gate decisions", () => {
    expect(
      resolveGateDecision({ status: "ready", access: "DELETION_ONLY", allow: "deletion-only" }),
    ).toEqual({ kind: "render" });
    expect(
      resolveGateDecision({ status: "ready", access: "FULL", allow: "deletion-only" }),
    ).toEqual({ kind: "redirect", destination: "/app", clearPrivateCache: false });
    expect(
      resolveGateDecision({ status: "error", errorStatus: 401, allow: "deletion-only" }),
    ).toEqual({ kind: "redirect", destination: "/login", clearPrivateCache: true });
  });

  it("never mounts financial children while the session is deletion-only", async () => {
    api.pathname = "/app/transactions";
    api.session = {
      data: { data: { access: "DELETION_ONLY", session_id: "s1", user_id: "u1" } },
      isPending: false,
      isError: false,
      error: undefined,
    };

    function FinancialChild() {
      api.financialMounts += 1;
      return <p>private balances</p>;
    }

    const { clearSpy } = renderWithClient(
      <AuthGate>
        <FinancialChild />
      </AuthGate>,
    );

    await waitFor(() => {
      expect(api.routes).toEqual(["/deletion"]);
    });
    expect(api.financialMounts).toBe(0);
    expect(screen.queryByText("private balances")).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("mounts children only for full access", async () => {
    api.session = {
      data: { data: { access: "FULL", session_id: "s1", user_id: "u1" } },
      isPending: false,
      isError: false,
      error: undefined,
    };

    renderWithClient(
      <AuthGate>
        <p>private balances</p>
      </AuthGate>,
    );

    expect(await screen.findByText("private balances")).toBeTruthy();
    expect(api.routes).toEqual([]);
  });

  it("keeps the deletion screen reachable only for deletion-only sessions", async () => {
    api.pathname = "/deletion";
    api.session = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { status: 403 } },
    };

    renderWithClient(
      <AuthGate allow="deletion-only">
        <p>deletion controls</p>
      </AuthGate>,
    );

    expect(await screen.findByText("deletion controls")).toBeTruthy();
    expect(api.routes).toEqual([]);
  });

  it("sends a restricted session away from the financial shell without mounting it", async () => {
    api.pathname = "/app";
    api.session = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { status: 403 } },
    };

    function FinancialChild() {
      api.financialMounts += 1;
      return <p>private balances</p>;
    }

    const { clearSpy } = renderWithClient(
      <AuthGate>
        <FinancialChild />
      </AuthGate>,
    );

    await waitFor(() => {
      expect(api.routes).toEqual(["/deletion"]);
    });
    expect(api.financialMounts).toBe(0);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("fails closed to login when the session request is unauthenticated", async () => {
    api.pathname = "/app/wallets";
    api.session = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { status: 401 } },
    };

    renderWithClient(
      <AuthGate>
        <p>private balances</p>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(api.routes).toEqual(["/login?returnTo=%2Fapp%2Fwallets"]);
    });
    expect(screen.queryByText("private balances")).toBeNull();
  });
});
