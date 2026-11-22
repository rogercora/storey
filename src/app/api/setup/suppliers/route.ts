import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSupervisorOrAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  contact_email: z.string().trim().email().or(z.literal("")).optional().nullable(),
  contact_phone: z.string().trim().max(40).optional().nullable(),
  lead_time_days: z.coerce.number().int().min(0).max(90).default(1),
  notes: z.string().trim().max(400).optional().nullable(),
});

const patchSchema = createSchema.partial().extend({ id: z.string().uuid() });
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
  if (!parsed.success) return fail(400, "Please check supplier name and email format.");

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: parsed.data.name,
      contact_email: parsed.data.contact_email || null,
      contact_phone: parsed.data.contact_phone || null,
      lead_time_days: parsed.data.lead_time_days,
      notes: parsed.data.notes || null,
      is_test_data: false,
    })
    .select("*")
    .single();

  if (error || !data) return fail(400, error?.message ?? "Could not create supplier.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "supplier_created",
    entityType: "supplier",
    entityId: data.id as string,
    summary: `Created supplier "${data.name}"`,
  });

  return NextResponse.json({ supplier: data });
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
  if (!parsed.success) return fail(400, "Please check supplier fields and email format.");

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.contact_email !== undefined) update.contact_email = parsed.data.contact_email || null;
  if (parsed.data.contact_phone !== undefined) update.contact_phone = parsed.data.contact_phone || null;
  if (parsed.data.lead_time_days !== undefined) update.lead_time_days = parsed.data.lead_time_days;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes || null;
  if (Object.keys(update).length === 0) return fail(400, "Nothing to update.");

  const { data, error } = await supabase.from("suppliers").update(update).eq("id", parsed.data.id).select("*").single();
  if (error || !data) return fail(400, error?.message ?? "Could not update supplier.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "supplier_updated",
    entityType: "supplier",
    entityId: data.id as string,
    summary: `Updated supplier "${data.name}"`,
  });

  return NextResponse.json({ supplier: data });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return fail(400, "Invalid supplier ID.");

  const supabase = await createClient();
  const auth = await requireSupervisorOrAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { data: sup } = await supabase.from("suppliers").select("id, name").eq("id", id!).maybeSingle();
  if (!sup) return fail(404, "Supplier not found.");

  const { error } = await supabase.from("suppliers").delete().eq("id", id!);
  if (error) return fail(409, "Cannot delete a supplier with existing purchase orders.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "supplier_deleted",
    entityType: "supplier",
    entityId: id!,
    summary: `Deleted supplier "${sup.name}"`,
  });

  return NextResponse.json({ ok: true });
}

