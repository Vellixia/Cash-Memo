"use client";

import Link from "next/link";
import { Suspense } from "react";
import { VerifyEmailForm } from "../../../features/auth/forms";

export default function VerifyEmailPage() { return <div className="public-page"><Suspense fallback={<p>Loading verification…</p>}><VerifyEmailForm /></Suspense><p className="auth-links"><Link href="/login">Back to sign in</Link></p></div>; }

