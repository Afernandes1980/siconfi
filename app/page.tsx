import CsvComparator from "@/components/CsvComparator";
import { requireOrganization } from "@/lib/auth";

export default async function HomePage() {
  const user = await requireOrganization();
  return <CsvComparator currentUser={user} />;
}
