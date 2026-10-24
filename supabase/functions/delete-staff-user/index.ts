import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!jwt || (anonKey && jwt === anonKey)) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminDb = createClient(supabaseUrl, serviceKey);
    const {
      data: { user: callerUser },
      error: userErr,
    } = await adminDb.auth.getUser(jwt);
    if (userErr || !callerUser) {
      const msg = userErr?.message || "Not authenticated";
      return new Response(JSON.stringify({ error: msg }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await adminDb
      .from("profiles")
      .select("role")
      .eq("id", callerUser.id)
      .maybeSingle();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const userId = String(body.user_id ?? "").trim();
    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userId === callerUser.id) {
      return new Response(JSON.stringify({ error: "You cannot delete your own account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetProfile } = await adminDb
      .from("profiles")
      .select("role, is_active")
      .eq("id", userId)
      .maybeSingle();

    const targetRole = targetProfile?.role ?? "sales";
    if (targetRole === "admin") {
      return new Response(
        JSON.stringify({
          error:
            "Cannot delete an administrator. Change their role to Sales first, then delete.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Soft-delete: ban login + mark profile inactive (do not remove auth user / history).
    const { error: banErr } = await adminDb.auth.admin.updateUserById(userId, {
      ban_duration: "876600h",
    });
    if (banErr) {
      return new Response(JSON.stringify({ error: banErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: profileErr } = await adminDb.from("profiles").upsert({
      id: userId,
      role: targetRole,
      is_active: false,
      updated_at: new Date().toISOString(),
    });
    if (profileErr) {
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, soft: true, user_id: userId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
