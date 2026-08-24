import Link from "next/link";
import { PreferencesForm } from "../../../../features/settings/preferences-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SettingsPage() { return <section className="management-page"><header><p className="muted">Account controls</p><h1>Settings</h1></header><PreferencesForm /><div className="settings-links"><Link className="settings-link" href="/app/settings/sessions"><h2>Sessions</h2><p>Sign out this device or all devices.</p></Link><Link className="settings-link" href="/app/settings/delete-account"><h2>Delete account</h2><p>Review grace period and deletion controls.</p></Link></div></section>; }
