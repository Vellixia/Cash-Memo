"use client";

import Link from "next/link";
import { RegisterForm } from "../../../features/auth/forms";

export default function RegisterPage() {
  return (
    <>
      <RegisterForm />
      <p className="m-0 text-center text-sm">
        <Link className="underline underline-offset-4 hover:text-primary" href="/login">
          Already have an account?
        </Link>
      </p>
    </>
  );
}
