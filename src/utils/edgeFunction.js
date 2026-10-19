async function getAccessTokenForFunctions(supabase) {
  const { data: sessionWrap } = await supabase.auth.getSession();
  if (sessionWrap.session?.access_token) {
    return sessionWrap.session.access_token;
  }

  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) {
    return refreshed.session.access_token;
  }

  try {
    const { data: userWrap, error: userErr } = await supabase.auth.getUser();
    if (!userErr && userWrap.user) {
      const { data: again } = await supabase.auth.getSession();
      if (again.session?.access_token) return again.session.access_token;
    }
  } catch {
    /* ignore — fall through */
  }

  return null;
}

/**
 * Invoke a Supabase Edge Function and surface JSON { error } from non-2xx responses.
 */
export async function invokeEdgeFunction(supabase, name, body) {
  const token = await getAccessTokenForFunctions(supabase);
  if (!token) {
    throw new Error("Your session expired. Please sign out and sign in again.");
  }

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (data?.error) {
    throw new Error(String(data.error));
  }

  if (!error) {
    return data;
  }

  let detail = error.message || `Edge function "${name}" failed`;

  const ctx = error.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const payload = await ctx.json();
      if (payload?.error) detail = String(payload.error);
      else if (payload?.message) detail = String(payload.message);
    } catch {
      /* ignore parse errors */
    }
  } else if (ctx && typeof ctx.text === "function") {
    try {
      const text = await ctx.text();
      if (text) {
        try {
          const payload = JSON.parse(text);
          if (payload?.error) detail = String(payload.error);
        } catch {
          if (text.length < 200) detail = text;
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (/non-2xx/i.test(detail)) {
    detail =
      `Function "${name}" is missing or returned an error. Deploy it: supabase functions deploy ${name}`;
  }

  throw new Error(detail);
}
