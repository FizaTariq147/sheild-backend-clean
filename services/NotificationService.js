// services/NotificationService.js
//
// ─── PHASE GUIDE ─────────────────────────────────────────────────────────────
//
//  NOW  (Expo Go / development)
//    • Sends push via Expo Push API  →  https://exp.host/--/api/v2/push/send
//    • No Firebase Admin SDK needed
//    • No credentials to configure — just works
//    • Stores expoPushTokens[] on the User model
//
//  LATER  (Production / EAS build)
//    • Swap sendPushNotification() to use Firebase Admin SDK
//    • Store fcmTokens[] instead of (or alongside) expoPushTokens[]
//    • See swap guide at the bottom of this file
//
// ─────────────────────────────────────────────────────────────────────────────

import fetch   from "node-fetch";          // or use native fetch if Node 18+
import User    from "../models/User.js";
import Message from "../models/message.model.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ── Validate Expo push token format ──────────────────────────────────────────
const isExpoPushToken = (token) =>
  typeof token === "string" &&
  (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["));

// ── Build one Expo push message object ───────────────────────────────────────
const buildExpoMessage = ({ token, title, body, data = {}, badge = 1, sound = "default" }) => ({
  to:        token,
  title,
  body,
  data,
  badge,
  sound,
  priority:  "high",
  channelId: data.type === "call" ? "shield_calls" : "shield_chat",
  ttl:       60 * 60 * 24,
  expiration: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
});

// ── Send push notifications to all devices of a user ─────────────────────────
export const sendPushNotification = async ({
  recipientUserId,
  title,
  body,
  data  = {},
  badge,
}) => {
  try {
    const user = await User.findById(recipientUserId)
      .select("expoPushTokens")
      .lean();

    if (!user?.expoPushTokens?.length) {
      console.info(`[push] no tokens for user ${recipientUserId} — skipping`);
      return;
    }

    // Resolve badge count if not provided
    if (badge === undefined) {
      badge = await Message.countDocuments({
        receiverId: recipientUserId,
        status:     { $in: ["sent", "delivered"] },
      });
    }

    // Filter valid tokens and build messages
    const messages = user.expoPushTokens
      .filter(isExpoPushToken)
      .map((token) => buildExpoMessage({ token, title, body, data, badge }));

    if (!messages.length) return;

    // Chunk into batches of 100 (Expo API limit)
    const chunks = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    const staleTokens = [];

    for (const chunk of chunks) {
      const res  = await fetch(EXPO_PUSH_URL, {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          Accept:            "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });

      const json    = await res.json();
      const tickets = Array.isArray(json.data) ? json.data : [];

      tickets.forEach((ticket, i) => {
        if (ticket.status === "error") {
          console.error(`[push] error for token ${chunk[i].to}:`, ticket.message);
          if (ticket.details?.error === "DeviceNotRegistered") {
            staleTokens.push(chunk[i].to);
          }
        }
      });
    }

    // Prune stale tokens from DB
    if (staleTokens.length) {
      await User.findByIdAndUpdate(recipientUserId, {
        $pull: { expoPushTokens: { $in: staleTokens } },
      });
      console.info(`[push] pruned ${staleTokens.length} stale token(s) for user ${recipientUserId}`);
    }

  } catch (err) {
    console.error("[push] sendPushNotification error:", err);
  }
};

// ── Notify a user about a new chat message ────────────────────────────────────
export const sendMessageNotification = async ({
  recipientUserId,
  senderName,
  messageText,
  senderId,
  contactId,
  messageId,
}) => {
  const body = messageText.length > 100
    ? messageText.slice(0, 97) + "…"
    : messageText;

  await sendPushNotification({
    recipientUserId,
    title: senderName ?? "New Message",
    body,
    data: {
      type:       "message",
      senderId,
      senderName: senderName ?? "",
      contactId,
      messageId,
      route:      `/chat/${senderId}`,
    },
  });
};

// ── Notify a user about a missed call ────────────────────────────────────────
export const sendMissedCallNotification = async ({
  recipientUserId,
  callerName,
  callType = "audio",
}) => {
  await sendPushNotification({
    recipientUserId,
    title: `Missed ${callType === "video" ? "Video" : "Voice"} Call`,
    body:  `You missed a ${callType} call from ${callerName}`,
    data: {
      type:       "missed_call",
      callerName: callerName ?? "",
      callType,
      route:      "/chats",
    },
    badge: 1,
  });
};

// ── Send a grouped summary push (multiple unread conversations) ───────────────
export const sendGroupSummaryNotification = async (recipientUserId) => {
  const groups = await Message.aggregate([
    {
      $match: {
        receiverId: recipientUserId,
        status:     { $in: ["sent", "delivered"] },
      },
    },
    {
      $group: {
        _id:      "$senderId",
        count:    { $sum: 1 },
        lastText: { $last: "$text" },
      },
    },
  ]);

  if (!groups.length) return;

  const chatCount   = groups.length;
  const totalUnread = groups.reduce((s, g) => s + g.count, 0);

  await sendPushNotification({
    recipientUserId,
    title: "SHIELD Messages",
    body:
      chatCount === 1
        ? groups[0].lastText?.slice(0, 100) ?? "You have a new message"
        : `${chatCount} unread conversation${chatCount > 1 ? "s" : ""}`,
    data: {
      type:  "summary",
      route: "/chats",
    },
    badge: totalUnread,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// HOW TO SWAP TO FIREBASE LATER (production / EAS build)
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Install:
//      npm install firebase-admin
//
// 2. Add to .env:
//      FCM_PROJECT_ID=your-project-id
//      FCM_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
//      FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
//
// 3. Replace sendPushNotification() with:
//
//   import admin from "firebase-admin";
//
//   if (!admin.apps.length) {
//     admin.initializeApp({
//       credential: admin.credential.cert({
//         projectId:   process.env.FCM_PROJECT_ID,
//         clientEmail: process.env.FCM_CLIENT_EMAIL,
//         privateKey:  process.env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n"),
//       }),
//     });
//   }
//
//   export const sendPushNotification = async ({ recipientUserId, title, body, data, badge }) => {
//     const user = await User.findById(recipientUserId).select("fcmTokens").lean();
//     if (!user?.fcmTokens?.length) return;
//     await Promise.allSettled(
//       user.fcmTokens.map((token) =>
//         admin.messaging().send({
//           token,
//           notification: { title, body },
//           data: Object.fromEntries(Object.entries(data).map(([k,v]) => [k, String(v)])),
//           android: { priority: "high", notification: { channelId: "shield_chat" } },
//           apns:    { payload: { aps: { sound: "default", badge } } },
//         })
//       )
//     );
//   };
//
// 4. Change User model field:  expoPushTokens  →  fcmTokens
// 5. Update token route:  /api/users/expo-push-token  →  /api/users/fcm-token
// 6. Update useNotifications.ts with the Firebase version (see that file).
// 7. Everything else — controllers, socket, screens — stays exactly the same.
//
// ─────────────────────────────────────────────────────────────────────────────