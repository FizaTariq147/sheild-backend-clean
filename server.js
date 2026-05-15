import dotenv from "dotenv";
dotenv.config();

console.log("server.js: JWT_SECRET present?", !!process.env.JWT_SECRET);

import express from "express";
import cors from "cors";
import path from "path";
import http from "http";                          // ADD
import { fileURLToPath } from "url";
import contactRouter from "./routes/contactRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { connectPrimaryDB } from "./db/connections.js";
import userRouter from "./routes/userRoutes.js";
import errorHandler from "./middleware/errorHandler.js";
import safeplaceRoutes from "./routes/safeplaceRoutes.js";
import socketConnection from "./libs/socket.js";       // ADD — your socket file

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/users", userRouter);
app.use("/api/contacts", contactRouter);
app.use("/api/safeplaces", safeplaceRoutes);
app.use("/api/chat", chatRoutes);

// Health check
app.get("/", (req, res) => res.json({ ok: true }));

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
// const LAN_IP = "192.168.10.7";
const LAN_IP = process.env.LAN_IP || "localhost";

const start = async () => {
  try {
    await connectPrimaryDB(process.env.MONGO_URI);

    // CREATE http server from express app         // ADD
    const server = http.createServer(app);

    // Attach Socket.IO to the http server         // ADD
    const io = socketConnection(server);
app.set("io", io); // ← required so controllers can access io via req.app.get("io")

    // Listen on the http server, not app          // CHANGED
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on:`);
      console.log(`  • Local:   http://localhost:${PORT}`);
      console.log(`  • LAN:     http://${LAN_IP}:${PORT}  <-- use this from your phone`);
      console.log(`  • Socket:  ws://${LAN_IP}:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
};

start();