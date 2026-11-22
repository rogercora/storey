import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSupervisorOrAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(50),
  sort_order: z.coerce.number().int().min(0).max(9999).default(100),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(50).optional(),
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
  if (!parsed.success) return fail(400, "Category name must be at least 2 characters.");

  const slug = toSlug(parsed.data.name);
  if (!/^[a-z0-9_]{2,32}$/.test(slug)) return fail(400, "Category name must contain letters or numbers.");

  const { data, error } = await supabase
    .from("categories")
    .insert({ slug, name: parsed.data.name, sort_order: parsed.data.sort_order })
    .select("*")
    .single();

  if (error || !data) return fail(400, error?.message ?? "Could not create category.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "category_created",
    entityType: "category",
    entityId: data.id as string,
    summary: `Created category "${data.name}"`,
  });

  return NextResponse.json({ category: data });
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
  if (!parsed.success) return fail(400, "Invalid category update.");

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.sort_order !== undefined) update.sort_order = parsed.data.sort_order;
  if (Object.keys(update).length === 0) return fail(400, "Nothing to update.");

  const { data, error } = await supabase.from("categories").update(update).eq("id", parsed.data.id).select("*").single();
  if (error || !data) return fail(400, error?.message ?? "Could not update category.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "category_updated",
    entityType: "category",
    entityId: data.id as string,
    summary: `Updated category "${data.name}"`,
  });

  return NextResponse.json({ category: data });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return fail(400, "Invalid category ID.");

  const supabase = await createClient();
  const auth = await requireSupervisorOrAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { data: cat } = await supabase.from("categories").select("id, name, slug").eq("id", id!).maybeSingle();
  if (!cat) return fail(404, "Category not found.");

  const { error } = await supabase.from("categories").delete().eq("id", id!);
  if (error) return fail(409, "Cannot delete a category that is still assigned to products.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "category_deleted",
    entityType: "category",
    entityId: id!,
    summary: `Deleted category "${cat.name}"`,
  });

  return NextResponse.json({ ok: true });
}

