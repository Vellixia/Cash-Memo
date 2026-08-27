"use client";

import Link from "next/link";
import { ForgotPasswordForm } from "../../../features/auth/forms";

export default function ForgotPasswordPage() {
  return (
    <>
      <ForgotPasswordForm />
      <p className="m-0 text-center text-sm">
        <Link className="underline underline-offset-4 hover:text-primary" href="/login">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
