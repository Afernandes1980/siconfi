import OrganizationSelector from "@/components/OrganizationSelector";
import { requireUser } from "@/lib/auth";

export default async function OrganizationsPage() {
  const user = await requireUser();
  return <OrganizationSelector currentUser={{ displayName: user.displayName, role: user.role }} />;
}
