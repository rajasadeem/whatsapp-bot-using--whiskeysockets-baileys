import express from "express";
import mongoose from "mongoose";
import connectToWhatsApp from "./whatsapp-bot";

const app = express();

const PORT = process.env.PORT;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error(
    "Error: MongoDB connection string is missing. Please check your environment variables."
  );
  process.exit(1);
}

const startServer = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Database connected successfully");
    await connectToWhatsApp();
    app.listen(PORT, () => console.log(`Server is running on port: ${PORT}`));
  } catch (error) {
    console.log("Error:", error);
    process.exit(1);
  }
};

startServer();
