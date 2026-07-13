import CsvComparator from "@/components/CsvComparator";
import { requireUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await requireUser();
  return <CsvComparator currentUser={user} />;
}
