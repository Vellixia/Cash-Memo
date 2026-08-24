"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ResetPasswordForm } from "../../../features/auth/forms";

export default function ResetPasswordPage() { return <div className="public-page"><Suspense fallback={<p>Loading reset form…</p>}><ResetPasswordForm /></Suspense><p className="auth-links"><Link href="/login">Back to sign in</Link></p></div>; }

