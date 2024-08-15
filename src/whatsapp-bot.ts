import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import OpenAI from "openai";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["system", "user", "assistant"],
      required: true,
    },
    content: {
      type: String,
    },
    name: String,
  },
  { timestamps: true }
);

const Message = mongoose.model("messages", messageSchema);

async function connectToWhatsApp() {
  try {
    // Set up authentication
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
      auth: state, // Provide the auth parameter
      printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode !==
          DisconnectReason.loggedOut;
        console.log(
          "connection closed due to ",
          lastDisconnect?.error,
          ", reconnecting ",
          shouldReconnect
        );
        // reconnect if not logged out
        if (shouldReconnect) {
          connectToWhatsApp();
        }
      } else if (connection === "open") {
        console.log("opened connection");
      }
    });
    sock.ev.on("messages.upsert", async (m) => {
      const message = m.messages[0];
      if (message && message.key.fromMe === true) return;

      await Message.create({
        chatId: message.key.remoteJid,
        role: "user",
        content: message.message?.conversation,
        name: message.pushName,
      });

      const messageHistory = await Message.find({
        chatId: message.key.remoteJid,
      })
        .sort({ createdAt: -1 })
        .limit(50);

      const prompt = `
    You are a versatile and knowledgeable travel expert capable of crafting comprehensive travel guides for any destination. Provide detailed recommendations on attractions, accommodations, dining, transportation, and activities while incorporating local insights, cultural nuances, and practical tips. Tailor responses to the specific needs of the traveler, such as budget, interests, and travel style.
    
    - Assume the role of a seasoned travel blogger with a friendly and engaging tone, offering advice as if conversing with a trusted companion.
    - Be prepared to answer a wide range of questions about travel planning and experiences.
    - Consider the traveler's preferences, such as budget backpacker, luxury traveler, or family vacationer when providing recommendations.
    - If a user asks a question that is not related to travel, politely inform them that you can only assist with travel-related queries and encourage them to ask about destinations, travel planning, or any travel-related topic they need help with.
    `;

      const previousMessagesForOpenAI = messageHistory
        .filter((item) => item.content && item.role)
        .map((item) => ({
          role: item.role,
          content: item.content,
        }))
        .reverse();

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        temperature: 0,
        messages: [
          { role: "system", content: prompt },
          // @ts-ignore
          ...previousMessagesForOpenAI,
        ],
      });

      if (!response.choices[0].message.content) {
        await sock.sendMessage(message.key.remoteJid!, {
          text: "Oops, something went wrong on our end. Please try asking your question again.",
        });
        return;
      }

      const messageReply = response.choices[0].message.content;
      const formattedMessage = messageReply
        .replace(/###/g, "")
        .replace(/\*\*/g, "");

      await Message.create({
        chatId: message.key.remoteJid,
        role: "assistant",
        content: formattedMessage,
        name: "travel-assistant",
      });

      await sock.sendMessage(message.key.remoteJid!, {
        text: formattedMessage,
      });
    });
  } catch (error) {
    console.log("Error:~", error);
  }
}

export default connectToWhatsApp;
