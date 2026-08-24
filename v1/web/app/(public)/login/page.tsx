"use client";

import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "../../../features/auth/forms";

export default function LoginPage() { return <div className="public-page"><Suspense fallback={<p>Loading sign in…</p>}><LoginForm /></Suspense><p className="auth-links"><Link href="/register">Create account</Link><Link href="/forgot-password">Forgot password?</Link></p></div>; }

