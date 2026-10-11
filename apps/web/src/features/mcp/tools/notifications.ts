// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import {
  loadOlderNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@/src/features/internal-ops/notifications/actions";
import { loadNotificationInbox } from "@/src/features/internal-ops/notifications/page-data";

import { appLink, compact, defineTool, McpToolError, unwrap } from "../tool";

export const listNotifications = defineTool({
  name: "list_notifications",
  title: "List notifications",
  description:
    "Your staff notifications, newest first, 50 at a time: what changed, on which record, by whom, and whether you have read it. Pass nextCursor as before to page back, even when unreadOnly leaves a page empty. A null nextCursor means the end.",
  input: {
    unreadOnly: z.boolean().optional(),
    before: z
      .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
      .strict()
      .optional(),
  },
  access: "read",
  run: async ({ unreadOnly, before }, context) => {
    let page;
    if (before) page = unwrap(await loadOlderNotifications(before));
    else {
      const inbox = await loadNotificationInbox();
      if (inbox.kind !== "ready")
        throw new McpToolError(
          inbox.kind === "forbidden"
            ? "NOTIFICATIONS_FORBIDDEN"
            : "UNAVAILABLE",
        );
      page = inbox.value.page;
    }
    const last = page.notifications.at(-1);
    return {
      unread: page.unread,
      more: page.more,
      nextCursor:
        page.more && last ? { createdAt: last.createdAt, id: last.id } : null,
      notifications: page.notifications
        .filter((notification) => !unreadOnly || !notification.readAt)
        .map((notification) =>
          compact({
            id: notification.id,
            kind: notification.kind,
            subject: notification.subject,
            actor: notification.actorName,
            detail: notification.detail,
            recordType: notification.recordType,
            recordId: notification.recordId,
            createdAt: notification.createdAt,
            readAt: notification.readAt,
            link: appLink(context, notification.href),
          }),
        ),
    };
  },
});

export const markNotificationsReadTool = defineTool({
  name: "mark_notifications_read",
  title: "Mark notifications read",
  description:
    "Marks some of your notifications read by id, or all of them with all: true.",
  input: {
    ids: z.array(z.uuid()).min(1).max(50).optional(),
    all: z.boolean().optional(),
  },
  access: "write",
  run: async ({ ids, all }) => {
    if (all) return unwrap(await markAllNotificationsRead());
    if (!ids?.length)
      throw new McpToolError("INVALID_INPUT", "Give ids, or all: true.");
    return unwrap(await markNotificationsRead({ ids }));
  },
});

export const notificationTools = [listNotifications, markNotificationsReadTool];
