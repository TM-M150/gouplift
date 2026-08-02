import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import Profile from "./profile";

export default async function ProfilePage() {
  // Check auth using your helper
  const authenticated = await isAuthenticated();

  // Redirect if not logged in
  if (!authenticated) {
    redirect("/?redirectTo=/profile");
  }

  return <Profile />;
}