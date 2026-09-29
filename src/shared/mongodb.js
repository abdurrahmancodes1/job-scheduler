import mongoose from "mongoose";
const MONGO_URL = process.env.MONGO_URL;
export async function connectMongoDB() {
  await mongoose.connect(MONGO_URL);
  console.log("MongDB connected");
}
