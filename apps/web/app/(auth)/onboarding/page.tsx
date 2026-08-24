import { AuthGate } from "../../../components/auth-gate";
import { OnboardingFlow } from "../../../features/onboarding/onboarding-flow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function OnboardingPage() {
  return <AuthGate><OnboardingFlow /></AuthGate>;
}
