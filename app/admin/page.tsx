import { redirect } from "next/navigation";

// Organization verification is the only admin tool so far.
export default function AdminPage() {
  redirect("/admin/organizations");
}
