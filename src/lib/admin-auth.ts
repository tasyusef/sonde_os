import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const TREASURY_ADDRESS = process.env.SONDE_TREASURY_ADDRESS;

/** Returns the session if the caller is the treasury wallet, or a 404 response. */
export async function requireAdmin(): Promise<
  | { ok: true; address: string }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession(await cookies());
  if (!session || session.address !== TREASURY_ADDRESS) {
    return { ok: false, response: NextResponse.json(null, { status: 404 }) };
  }
  return { ok: true, address: session.address };
}
