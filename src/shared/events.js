import { createClient } from "redis";

const EVENTS_STREAM = "system_events";

const redis = createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_URL,
    port: process.env.REDIS_PORT,
  },
});

redis.on("error", (error) => {
  console.error("Events Redis Error:", error);
});

await redis.connect();

export async function emitEvent({ source, event, message, jobId = null }) {
  try {
    await redis.xAdd(EVENTS_STREAM, "*", {
      source,
      event,
      message,
      jobId: jobId || "",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit system event:", error);
  }
}
