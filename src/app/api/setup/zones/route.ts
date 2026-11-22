import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSupervisorOrAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional().nullable(),
  sort_order: z.coerce.number().int().min(0).max(9999).default(100),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).optional().nullable(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireSupervisorOrAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(400, "Zone name is required.");

  const { data, error } = await supabase
    .from("zones")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description || null,
      sort_order: parsed.data.sort_order,
    })
    .select("*")
    .single();

  if (error || !data) return fail(400, error?.message ?? "Could not create zone.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "zone_created",
    entityType: "zone",
    entityId: data.id as string,
    summary: `Created zone "${data.name}"`,
  });

  return NextResponse.json({ zone: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireSupervisorOrAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid zone update.");

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.description !== undefined) update.description = parsed.data.description || null;
  if (parsed.data.sort_order !== undefined) update.sort_order = parsed.data.sort_order;
  if (Object.keys(update).length === 0) return fail(400, "Nothing to update.");

  const { data, error } = await supabase.from("zones").update(update).eq("id", parsed.data.id).select("*").single();
  if (error || !data) return fail(400, error?.message ?? "Could not update zone.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "zone_updated",
    entityType: "zone",
    entityId: data.id as string,
    summary: `Updated zone "${data.name}"`,
  });

  return NextResponse.json({ zone: data });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return fail(400, "Invalid zone ID.");

  const supabase = await createClient();
  const auth = await requireSupervisorOrAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { data: zone } = await supabase.from("zones").select("id, name").eq("id", id!).maybeSingle();
  if (!zone) return fail(404, "Zone not found.");

  const { error } = await supabase.from("zones").delete().eq("id", id!);
  if (error) {
    return fail(409, "Cannot delete a zone that still has products or stocktake history.");
  }

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "zone_deleted",
    entityType: "zone",
    entityId: id!,
    summary: `Deleted zone "${zone.name}"`,
  });

  return NextResponse.json({ ok: true });
}

