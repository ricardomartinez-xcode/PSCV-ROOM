import { AppShellV5 } from "@/components/app-shell-v5";
import { AuthGate } from "@/components/auth-gate";
import { seedTasks } from "@/lib/seed";

// The shell contains a client-side institutional session check. Keep the document
// dynamic so a cached HTML response can never reference assets from an old build.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
  return (
    <AuthGate>
      <AppShellV5 initialTasks={seedTasks} initialMembers={[]} />
    </AuthGate>
  );
}
