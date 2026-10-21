/**
 * Minimal Web Push (VAPID) sender for Deno Edge (orders → desktop notifications).
 */

export type PushSub = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendWebPushToAll(
  subs: PushSub[],
  payload: Record<string, unknown>
): Promise<{ sent: number; failed: number }> {
  const publicKey = Deno.env.get("SHOPIFY_VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("SHOPIFY_VAPID_PRIVATE_KEY")?.trim();
  const subject = Deno.env.get("SHOPIFY_VAPID_SUBJECT")?.trim() || "mailto:admin@localhost";
  if (!publicKey || !privateKey || !subs.length) return { sent: 0, failed: 0 };

  let webpush: {
    setVapidDetails: (subject: string, pub: string, priv: string) => void;
    sendNotification: (
      sub: { endpoint: string; keys: { p256dh: string; auth: string } },
      body: string,
      options?: { TTL?: number }
    ) => Promise<unknown>;
  };

  try {
    webpush = (await import("npm:web-push@3.6.7")).default;
  } catch (e) {
    console.warn("[webpush] import failed", e);
    return { sent: 0, failed: subs.length };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 }
      );
      sent += 1;
    } catch (e) {
      failed += 1;
      console.warn("[webpush] send failed", String(s.endpoint || "").slice(0, 48), e);
    }
  }
  return { sent, failed };
}
