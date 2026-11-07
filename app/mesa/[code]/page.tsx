"use client";

import { useParams } from "next/navigation";
import { OnlineTable } from "@/components/OnlineTable";

export default function MesaPage() {
  const params = useParams<{ code: string }>();
  return <OnlineTable code={params.code} />;
}
