import { requireSupabase } from "../lib/supabase.js";

export async function listStaffUsers() {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("list_staff_users");
  if (error) throw error;
  return data ?? [];
}

export async function updateStaffUser(userId, { full_name, role }) {
  const sb = requireSupabase();
  const { error } = await sb.rpc("admin_update_staff_user", {
    p_user_id: userId,
    p_full_name: full_name ?? null,
    p_role: role ?? null,
  });
  if (error) throw error;
}

export async function createStaffUser({ email, password, full_name, role }) {
  const sb = requireSupabase();
  const { data, error } = await sb.functions.invoke("create-staff-user", {
    body: { email, password, full_name, role },
  });
  if (error) throw error;
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}
