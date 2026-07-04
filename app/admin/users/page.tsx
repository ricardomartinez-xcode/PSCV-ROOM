import { AuthGate } from "@/components/auth-gate";
import { StudentDirectory } from "@/components/student-directory";

export default function UsersPage() {
  return (
    <AuthGate>
      <StudentDirectory />
    </AuthGate>
  );
}
