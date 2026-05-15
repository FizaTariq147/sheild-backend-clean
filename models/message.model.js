import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId:   { type: String, required: true },
  receiverId: { type: String, required: true },
  text:       { type: String, required: true },
  timestamp:  { type: Date, default: Date.now },

  // ── ADDED: WhatsApp-style message status ──────────────────────────────────
  // sending   → optimistic UI only (never saved to DB)
  // sent      → saved to DB, not yet received by recipient device
  // delivered → recipient device is online and received it
  // read      → recipient opened the chat and saw it
  status: {
    type: String,
    enum: ["sent", "delivered", "read"],
    default: "sent",
  },
});

export default mongoose.model("Message", messageSchema);