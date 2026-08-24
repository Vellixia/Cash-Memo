"use client";

import Link from "next/link";
import { ForgotPasswordForm } from "../../../features/auth/forms";

export default function ForgotPasswordPage() { return <div className="public-page"><ForgotPasswordForm /><p className="auth-links"><Link href="/login">Back to sign in</Link></p></div>; }
