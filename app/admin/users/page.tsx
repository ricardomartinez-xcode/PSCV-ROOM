import { redirect } from "next/navigation";

export default function UsersPage() {
  redirect("/?tab=admin&adminTab=users");
}
