"use client";

import Link from "next/link";
import { ResetPasswordForm } from "../../../features/auth/forms";

export default function ResetPasswordPage() {
  return (
    <>
      <ResetPasswordForm />
      <p className="m-0 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
        <Link className="underline underline-offset-4 hover:text-primary" href="/forgot-password">
          Request a new reset link
        </Link>
        <Link className="underline underline-offset-4 hover:text-primary" href="/login">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
