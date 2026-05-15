// utils/pushNotifications.js
// Sends push notifications via Expo's push API (no SDK needed — plain HTTP)

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Send a push notification to one or more Expo push tokens.
 *
 * @param {string | string[]} tokens   - Expo push token(s)
 * @param {string}            title    - Notification title
 * @param {string}            body     - Notification body text
 * @param {object}            data     - Extra payload (e.g. { contactId, chatId })
 */
async function sendPushNotification(tokens, title, body, data = {}) {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];

  // Filter valid tokens only
  const validTokens = tokenList.filter(
    (t) => t && t.startsWith("ExponentPushToken[")
  );

  if (validTokens.length === 0) return;

  const messages = validTokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data,
    priority: "high",
    channelId: "messages", // matches Android channel created in the app
    badge: 1,
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    // Log any errors from Expo
    if (result?.data) {
      result.data.forEach((item, i) => {
        if (item.status === "error") {
          console.error(
            `Push error for token ${validTokens[i]}:`,
            item.message
          );
        }
      });
    }
  } catch (err) {
    console.error("Expo push send error:", err);
  }
}

module.exports = { sendPushNotification };