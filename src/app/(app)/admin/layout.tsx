import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";

const TREASURY_ADDRESS = process.env.SONDE_TREASURY_ADDRESS;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession(await cookies());
  if (!session || session.address !== TREASURY_ADDRESS) return notFound();
  return <>{children}</>;
}
