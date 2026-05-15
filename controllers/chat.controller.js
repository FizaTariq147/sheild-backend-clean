import Chat from "../models/chat.model.js";
import Message from "../models/message.model.js";
import { getContactById } from "../models/Contacts.js";
import { findByPhone, getUserById } from "../models/User.js";

const resolveReceiverUserId = async (currentUserId, contactIdOrUserId) => {
  // 1) If the param is already a valid user id, use it.
  const user = await getUserById(contactIdOrUserId);
  if (user?.id) {
    return { receiverUserId: user.id, legacyReceiverIds: [] };
  }

  // 2) Otherwise treat it as a saved contact id belonging to the current user.
  const contact = await getContactById(contactIdOrUserId);
  if (!contact || contact.user_id !== currentUserId) {
    return { receiverUserId: null, legacyReceiverIds: [] };
  }

  const receiver = await findByPhone(contact.phone);
  if (!receiver?.id) {
    return { receiverUserId: null, legacyReceiverIds: [] };
  }

  return { receiverUserId: receiver.id, legacyReceiverIds: [contactIdOrUserId] };
};

// ─── Get peer userId ──────────────────────────────────────────────────────────
export const getPeer = async (req, res) => {
  const userId = req.user.id;
  const { contactId } = req.params;

  try {
    const { receiverUserId } = await resolveReceiverUserId(userId, contactId);
    if (!receiverUserId) {
      return res.status(404).json({ error: "Receiver not found" });
    }
    return res.json({ peerUserId: receiverUserId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to resolve peer" });
  }
};

// ─── Get all messages between logged-in user and a contact ───────────────────
export const getMessages = async (req, res) => {
  const userId = req.user.id;
  const { contactId } = req.params;

  try {
    const { receiverUserId, legacyReceiverIds } = await resolveReceiverUserId(
      userId,
      contactId
    );
    if (!receiverUserId) {
      return res.status(404).json({ error: "Receiver not found" });
    }

    const receiverIds = [receiverUserId, ...legacyReceiverIds];

    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: { $in: receiverIds } },
        { senderId: receiverUserId, receiverId: userId },
      ],
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load messages" });
  }
};

// ─── Send a new message ───────────────────────────────────────────────────────
export const sendMessage = async (req, res) => {
  try {
    const { text } = req.body;
    const senderId = req.user.id;
    const contactId = req.params.contactId;

    const { receiverUserId } = await resolveReceiverUserId(senderId, contactId);
    if (!receiverUserId) {
      return res.status(404).json({ error: "Receiver not found" });
    }

    if (!text) return res.status(400).json({ error: "Message text required" });

    const msg = await Message.create({
      senderId,
      receiverId: receiverUserId,
      text,
      status: "sent", // always start as 'sent' when saved to DB
    });

    const io = req.app.get("io");
    if (io) {
      io.to(receiverUserId).emit("new_message", msg);
      io.to(senderId).emit("new_message", msg);

      // If receiver is currently online, immediately emit delivered to sender
      const receiverSockets = io.sockets.adapter.rooms.get(receiverUserId);
      if (receiverSockets && receiverSockets.size > 0) {
        io.to(senderId).emit("message_delivered", {
          messageId: String(msg._id),
        });

        // Also update status in DB right away
        await Message.findByIdAndUpdate(msg._id, { status: "delivered" });
      }
    }

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Mark all messages from a contact as delivered ───────────────────────────
// PATCH /api/chat/:contactId/delivered
// Called when the receiver comes online / app comes to foreground.
// Updates DB status: sent → delivered
// Emits: messages_delivered_bulk → to the original sender (double grey tick)
export const markDelivered = async (req, res) => {
  try {
    const receiverId = req.user.id;        // the person who is now online
    const { contactId } = req.params;      // the sender whose messages we deliver

    const { receiverUserId: senderId } = await resolveReceiverUserId(
      receiverId,
      contactId
    );
    if (!senderId) {
      return res.status(404).json({ error: "Sender not found" });
    }

    // Update all 'sent' messages from that sender to 'delivered'
    await Message.updateMany(
      { senderId, receiverId, status: "sent" },
      { $set: { status: "delivered" } }
    );

    // Notify sender in real time → double grey tick on their screen
    const io = req.app.get("io");
    if (io) {
      io.to(senderId).emit("messages_delivered_bulk", { by: receiverId });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("markDelivered error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Mark all messages from a contact as read ────────────────────────────────
// PATCH /api/chat/:contactId/read
// Called when the receiver opens the chat screen (useFocusEffect).
// Updates DB status: sent | delivered → read
// Emits: messages_read_bulk → to the original sender (double blue tick)
export const markRead = async (req, res) => {
  try {
    const receiverId = req.user.id;        // the person who read the messages
    const { contactId } = req.params;      // the sender whose messages were read

    const { receiverUserId: senderId } = await resolveReceiverUserId(
      receiverId,
      contactId
    );
    if (!senderId) {
      return res.status(404).json({ error: "Sender not found" });
    }

    // Update all unread messages from that sender to 'read'
    await Message.updateMany(
      { senderId, receiverId, status: { $in: ["sent", "delivered"] } },
      { $set: { status: "read" } }
    );

    // Notify sender in real time → double blue tick on their screen
    const io = req.app.get("io");
    if (io) {
      io.to(senderId).emit("messages_read_bulk", { by: receiverId });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("markRead error:", err);
    res.status(500).json({ error: err.message });
  }
};