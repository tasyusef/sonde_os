import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTier } from "@/lib/subscription";
import { deleteHistoryEntry } from "@/lib/asktheledger-history";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/asktheledger/history/[id]
 *
 * Deletes a single history entry owned by the requesting user.
 * Pro-only — Free + unauth get 401/403 from requireTier.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();

  let session: Awaited<ReturnType<typeof requireTier>>;
  try {
    session = await requireTier(cookieStore, "pro");
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const removed = await deleteHistoryEntry(session.address, id);
  if (removed === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
