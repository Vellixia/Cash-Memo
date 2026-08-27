"use client";

import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "../../../features/auth/forms";

export default function LoginPage() {
  return (
    <>
      <Suspense fallback={<p role="status">Loading sign in…</p>}>
        <LoginForm />
      </Suspense>
      <p className="m-0 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
        <Link className="underline underline-offset-4 hover:text-primary" href="/register">
          Create account
        </Link>
        <Link className="underline underline-offset-4 hover:text-primary" href="/forgot-password">
          Forgot password?
        </Link>
      </p>
    </>
  );
}
