// backend/routes/chatRoutes.js
import { Router } from "express";
import authenticate from "../libs/auth.js";
import {
  getMessages,
  sendMessage,
  getPeer,
  markDelivered,
  markRead,
} from "../controllers/chat.controller.js";

const router = Router();

router.get("/:contactId/peer", authenticate, getPeer);
router.get("/:contactId/messages", authenticate, getMessages);
router.post("/:contactId/messages", authenticate, sendMessage);
router.patch("/:contactId/delivered", authenticate, markDelivered);
router.patch("/:contactId/read", authenticate, markRead);

export default router;