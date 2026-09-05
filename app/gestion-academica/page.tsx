import { redirect } from "next/navigation";

export default function AcademicManagementPage() {
  redirect("/?tab=admin&adminTab=courses");
}
