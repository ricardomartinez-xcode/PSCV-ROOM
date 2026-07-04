import { AuthGate } from "@/components/auth-gate";
import { AppShellV5 } from "@/components/app-shell-v5";
import { seedTasks } from "@/lib/seed";

export default function HomePage() {
  return (
    <AuthGate>
      <AppShellV5 initialTasks={seedTasks} initialMembers={[]} />
    </AuthGate>
  );
}
