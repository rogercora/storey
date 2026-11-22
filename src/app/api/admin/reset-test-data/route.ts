import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/admin/reset-test-data
 * Calls SQL function admin_reset_test_data() (checked against caller's JWT) and
 * empties any stored test photos in the private shelf-photos bucket.
 */
export async function POST() {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { data: deleted, error } = await supabase.rpc("admin_reset_test_data");
  if (error) {
    console.error("[reset-test-data] rpc failed", error.message);
    return fail(500, error.message);
  }

  // Clean up shelf-photos storage objects via service-role client (after admin verified).
  let deletedPhotos = 0;
  try {
    const admin = createAdminClient();
    const { data: folders } = await admin.storage.from("shelf-photos").list("", { limit: 1000 });
    const paths: string[] = [];

    for (const entry of folders ?? []) {
      if (!entry.name) continue;
      if (entry.id) {
        paths.push(entry.name);
        continue;
      }
      // entry is a <user_id> folder -> list <session_id> subfolders
      const { data: sessions } = await admin.storage.from("shelf-photos").list(entry.name, { limit: 1000 });
      for (const sess of sessions ?? []) {
        if (!sess.name) continue;
        const prefix = `${entry.name}/${sess.name}`;
        if (sess.id) {
          paths.push(prefix);
          continue;
        }
        const { data: files } = await admin.storage.from("shelf-photos").list(prefix, { limit: 1000 });
        for (const f of files ?? []) {
          if (f.name) paths.push(`${prefix}/${f.name}`);
        }
      }
    }

    if (paths.length > 0) {
      await admin.storage.from("shelf-photos").remove(paths);
      deletedPhotos = paths.length;
    }
  } catch (e) {
    console.error("[reset-test-data] storage cleanup warning", e);
  }

  return NextResponse.json({ ok: true, deleted, deleted_photos: deletedPhotos });
}

