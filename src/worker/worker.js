import { createClient } from "redis";
import mongoose from "mongoose";

import { connectMongoDB } from "../shared/mongodb.js";
import { Job } from "../shared/model.js";
import { emitEvent } from "../shared/events.js";
import { calculateRetryDelay } from "../shared/retry.js";
import { processJob } from "./jobProcessor.js";

const STREAM_NAME = "jobs";
const GROUP_NAME = "workers";
const CONSUMER_NAME = process.env.CONSUMER_NAME || "worker-1";

let shuttingDown = false;
let activeJobs = 0;
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

console.log(`[${CONSUMER_NAME}] Worker connected to Redis`);

// Create consumer group if it doesn't exist
try {
  await redis.xGroupCreate(STREAM_NAME, GROUP_NAME, "$", {
    MKSTREAM: true,
  });

  console.log(`[${CONSUMER_NAME}] Consumer group created`);
} catch (error) {
  if (!error.message.includes("BUSYGROUP")) {
    throw error;
  }
}

async function shutdown(signal) {
  console.log(`[${CONSUMER_NAME}] Received ${signal}`);

  shuttingDown = true;

  while (activeJobs > 0) {
    console.log(
      `[${CONSUMER_NAME}] Waiting for ${activeJobs} active job(s)...`,
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await redis.quit();
  await mongoose.connection.close();

  console.log(`[${CONSUMER_NAME}] Worker shut down`);

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function consumeJobs() {
  while (!shuttingDown) {
    const result = await redis.xReadGroup(
      GROUP_NAME,
      CONSUMER_NAME,
      {
        key: STREAM_NAME,
        id: ">",
      },
      {
        COUNT: 1,
        BLOCK: 5000,
      },
    );

    if (!result) {
      continue;
    }

    const messages = result[0].messages;

    for (const job of messages) {
      console.log(`[${CONSUMER_NAME}] Received job: ${job.message.jobId}`);

      await handleJob(job, false);
    }
  }
}

async function recoverJobs() {
  while (!shuttingDown) {
    try {
      const result = await redis.xAutoClaim(
        STREAM_NAME,
        GROUP_NAME,
        CONSUMER_NAME,
        60000,
        "0-0",
        {
          COUNT: 10,
        },
      );

      for (const job of result.messages) {
        console.log(`[${CONSUMER_NAME}] Reclaimed job: ${job.message.jobId}`);

        await handleJob(job, true);
      }
    } catch (error) {
      console.error(`[${CONSUMER_NAME}] Recovery error:`, error);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function handleJob(job, isRecovered) {
  activeJobs++;

  const jobId = job.message.jobId;

  await emitEvent({
    source: CONSUMER_NAME.toUpperCase(),
    event: "JOB_RECEIVED",
    message: "Job received from Redis",
    jobId,
  });

  try {
    const dbJob = await Job.findOne({ jobId });

    if (!dbJob) {
      throw new Error(`Job not found in MongoDB: ${jobId}`);
    }

    if (dbJob.state === "COMPLETED") {
      console.log(`[${CONSUMER_NAME}] Job already completed: ${jobId}`);

      await redis.xAck(STREAM_NAME, GROUP_NAME, job.id);

      return;
    }

    const filter = isRecovered
      ? {
          jobId,
          state: "PROCESSING",
        }
      : {
          jobId,
          state: { $in: ["QUEUED", "DISPATCHED"] },
        };

    const claimedJob = await Job.findOneAndUpdate(
      filter,
      {
        $set: {
          state: "PROCESSING",
          startedAt: new Date(),
        },
        $inc: {
          attempts: 1,
        },
      },
      {
        returnDocument: "after",
      },
    );

    if (!claimedJob) {
      console.log(`[${CONSUMER_NAME}] Could not claim job: ${jobId}`);

      await redis.xAck(STREAM_NAME, GROUP_NAME, job.id);

      return;
    }

    console.log(
      `[${CONSUMER_NAME}] Processing job ${jobId}, attempt ${claimedJob.attempts}`,
    );

    await emitEvent({
      source: CONSUMER_NAME.toUpperCase(),
      event: "JOB_PROCESSING",
      message: `Processing job, attempt ${claimedJob.attempts}`,
      jobId,
    });

    await processJob({
      type: claimedJob.type,
      payload: claimedJob.payload,
    });

    await Job.findOneAndUpdate(
      { jobId },
      {
        $set: {
          state: "COMPLETED",
          completedAt: new Date(),
        },
      },
    );

    console.log(`[${CONSUMER_NAME}] Job completed: ${jobId}`);

    await emitEvent({
      source: CONSUMER_NAME.toUpperCase(),
      event: "JOB_COMPLETED",
      message: "Job completed",
      jobId,
    });

    await redis.xAck(STREAM_NAME, GROUP_NAME, job.id);

    console.log(`[${CONSUMER_NAME}] ACK: ${job.id}`);
  } catch (error) {
    console.error(`[${CONSUMER_NAME}] Job failed:`, jobId, error);

    const dbJob = await Job.findOne({ jobId });

    if (!dbJob) {
      console.log(`[${CONSUMER_NAME}] Job not found: ${jobId}`);
      return;
    }

    if (dbJob.attempts < dbJob.maxAttempts) {
      const delay = calculateRetryDelay(dbJob.attempts);
      const retryAt = Date.now() + delay;

      await Job.findOneAndUpdate(
        { jobId },
        {
          $set: {
            state: "RETRYING",
            runAt: new Date(retryAt),
            failedAt: new Date(),
            error: error.message,
          },
        },
      );

      await redis.xAck(STREAM_NAME, GROUP_NAME, job.id);

      console.log(
        `[${CONSUMER_NAME}] Retry scheduled for ${new Date(
          retryAt,
        ).toISOString()}`,
      );
    } else {
      await Job.findOneAndUpdate(
        { jobId },
        {
          $set: {
            state: "FAILED",
            failedAt: new Date(),
            error: error.message,
          },
        },
      );

      await redis.xAck(STREAM_NAME, GROUP_NAME, job.id);

      console.log(
        `[${CONSUMER_NAME}] Job permanently failed after ${dbJob.attempts} attempts`,
      );
    }
  } finally {
    activeJobs--;
  }
}

await Promise.all([consumeJobs(), recoverJobs()]);
