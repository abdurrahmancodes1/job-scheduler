import { createClient } from "redis";

const STREAM_NAME = "jobs";
const GROUP_NAME = "workers";
const CONSUMER_NAME = "worker-2";

const redis = createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_URL,
    port: process.env.PORT,
  },
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

await redis.connect();

const result = await redis.xAutoClaim(
  STREAM_NAME,
  GROUP_NAME,
  CONSUMER_NAME,
  10000,
  "0-0",
  {
    COUNT: 10,
  },
);

console.log(JSON.stringify(result, null, 2));

await redis.quit();
