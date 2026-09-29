import { createClient } from "redis";

import { Job } from "../shared/model.js";
import { connectMongoDB } from "../shared/mongodb.js";
import { emitEvent } from "../shared/events.js";

const STREAM_NAME = "jobs";

const redis = createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_URL,
    port: process.env.REDIS_PORT,
  },
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

await redis.connect();
await connectMongoDB();

async function scheduledJobs() {
  while (true) {
    try {
      const job = await Job.findOneAndUpdate(
        {
          state: { $in: ["QUEUED", "RETRYING"] },
          runAt: { $lte: new Date() },
        },
        {
          $set: {
            state: "DISPATCHED",
          },
        },
        {
          returnDocument: "after",
        },
      );

      if (job) {
        console.log("Job claimed:", job.jobId);

        await redis.xAdd(STREAM_NAME, "*", {
          jobId: job.jobId,
        });

        await emitEvent({
          source: "SCHEDULER",
          event: "JOB_DISPATCHED",
          message: "Job dispatched to worker queue",
          jobId: job.jobId,
        });

        console.log("Job moved to stream:", job.jobId);
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

await scheduledJobs();
