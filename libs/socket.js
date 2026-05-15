import { Server } from "socket.io";

export default function socketConnection(server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("New socket connected:", socket.id);

    // ── Join user room ────────────────────────────────────────
    socket.on("join", (userId) => {
      socket.data.userId = userId;
      socket.join(userId);
      console.log(`User ${userId} joined their room`);
      socket.broadcast.emit("user_online", { userId, online: true });
    });

    // ── Typing indicator ──────────────────────────────────────
    socket.on("typing", ({ userId, receiverId, isTyping }) => {
      if (!receiverId) return;
      socket
        .to(receiverId)
        .emit("user_typing", { userId, isTyping: !!isTyping });
    });

    // ── Message forwarding ────────────────────────────────────
    socket.on(
      "send_message",
      ({ id, senderId, receiverId, text, timestamp }) => {
        if (!receiverId) return;

        const msg = {
          _id: id,
          id,
          senderId,
          receiverId,
          text,
          timestamp: timestamp || new Date().toISOString(),
        };

        // Forward to receiver
        socket.to(receiverId).emit("new_message", msg);

        // Confirm to sender
        socket.emit("message_sent", msg);

        // ── Delivery receipt ──────────────────────────────────
        // If receiver has an active socket room, emit delivered back to sender
        const receiverSockets = io.sockets.adapter.rooms.get(receiverId);
        if (receiverSockets && receiverSockets.size > 0) {
          // Notify sender → double grey tick
          socket.emit("message_delivered", { messageId: id });
        }
      }
    );

    // ── Read receipts ─────────────────────────────────────────
    //
    // Emitted by the receiver's frontend when they open a chat screen.
    // Tells the sender that all messages from them have been read.
    //
    // Payload: { readerId: string, senderId: string }
    //   readerId  — the user who just read the messages
    //   senderId  — the original sender whose messages were read
    //
    socket.on("mark_read", ({ readerId, senderId }) => {
      if (!readerId || !senderId) return;

      console.log(`User ${readerId} read all messages from ${senderId}`);

      // Notify the original sender → double blue tick on all their messages
      socket.to(senderId).emit("messages_read_bulk", { by: readerId });
    });

    // ── Single message read receipt (optional granular version) ──
    //
    // Use this if your backend tracks per-message read status and you
    // want to update a specific message rather than all at once.
    //
    // Payload: { messageId: string, senderId: string }
    //
    socket.on("mark_message_read", ({ messageId, senderId }) => {
      if (!messageId || !senderId) return;

      console.log(`Message ${messageId} marked as read, notifying ${senderId}`);

      // Notify sender of the specific message → double blue tick
      socket.to(senderId).emit("message_read", { messageId });
    });

    // ── Call Signaling ────────────────────────────────────────

    // Caller initiates — notify receiver
    socket.on(
      "call:initiate",
      ({ callerId, callerName, receiverId, callType }) => {
        if (!receiverId) return;

        console.log(`Call from ${callerId} to ${receiverId} [${callType}]`);

        const receiverSockets = io.sockets.adapter.rooms.get(receiverId);
        if (!receiverSockets || receiverSockets.size === 0) {
          socket.emit("call:failed", {
            reason: "User is unavailable or offline",
          });
          return;
        }

        socket.to(receiverId).emit("call:incoming", {
          callerId,
          callerName,
          callType: callType ?? "audio",
        });
      }
    );

    // Receiver accepts — notify caller
    socket.on("call:accept", ({ callerId, receiverId }) => {
      console.log(`Call accepted by ${receiverId}`);
      socket.to(callerId).emit("call:accepted", { receiverId });
    });

    // Receiver rejects — notify caller
    socket.on("call:reject", ({ callerId }) => {
      console.log(`Call rejected, notifying ${callerId}`);
      socket.to(callerId).emit("call:rejected");
    });

    // Either side ends — notify the other
    socket.on("call:end", ({ peerId }) => {
      if (!peerId) return;
      console.log(`Call ended, notifying ${peerId}`);
      socket.to(peerId).emit("call:ended");
    });

    // Receiver is already on another call — notify caller
    socket.on("call:busy", ({ callerId }) => {
      console.log(`User busy, notifying ${callerId}`);
      socket.to(callerId).emit("call:busy");
    });

    // ── Disconnect ────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
      const userId = socket.data.userId;
      if (userId) {
        socket.broadcast.emit("user_online", { userId, online: false });
        socket.broadcast.emit("call:ended");
      }
    });
  });

  return io;
}