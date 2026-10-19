import { requireSupabase } from "../lib/supabase.js";
import { toTitleCase } from "../utils/titleCase.js";

export async function listCategories() {
  const sb = requireSupabase();
  const { data, error } = await sb.from("categories").select("id, name").order("name");
  if (error) throw error;
  return data;
}

export async function createCategory(name) {
  const trimmed = toTitleCase(name);
  if (!trimmed) throw new Error("Category name is required");
  const sb = requireSupabase();
  const { data, error } = await sb.from("categories").insert({ name: trimmed }).select().single();
  if (error) throw error;
  return data;
}
