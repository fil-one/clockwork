import { notificationUnreadCount } from "@/src/features/internal-ops/notifications/page-data";
import {
  NotificationAccessError,
  notificationStaff,
} from "@/src/features/internal-ops/notifications/server";

export const dynamic = "force-dynamic";

/**
 * The bell's unread count, polled by the staff shell. Answers 204 for a
 * session with no inbox and 503 when the count cannot be read, so the bell
 * shows no number rather than a wrong one.
 */
export async function GET() {
  try {
    // Read afresh on every poll, so a session that lost access stops counting.
    const unread = await notificationUnreadCount(await notificationStaff());
    return Response.json(
      { unread },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotificationAccessError)
      return new Response(null, { status: 204 });
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
