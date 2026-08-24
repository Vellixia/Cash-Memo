import { SessionControls } from "../../../../../features/settings/session-controls";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SessionsPage() { return <section className="management-page"><header><p className="muted">Settings</p><h1>Session security</h1></header><SessionControls /></section>; }
