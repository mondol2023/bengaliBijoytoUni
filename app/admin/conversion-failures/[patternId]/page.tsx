import { AdminConversionFailureDetail } from "@/components/admin/AdminConversionFailureDetail";

export default async function AdminConversionFailureDetailPage({
  params,
}: {
  params: Promise<{ patternId: string }>;
}) {
  const { patternId } = await params;
  return <AdminConversionFailureDetail patternId={patternId} />;
}
