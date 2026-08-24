import { AccountDeletion } from "../../../../../features/settings/account-deletion";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DeleteAccountPage() { return <section className="management-page"><header><p className="muted">Settings</p><h1>Account deletion</h1></header><AccountDeletion /></section>; }
