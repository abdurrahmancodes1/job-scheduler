import express from "express";
import cors from "cors";
import { createClient } from "redis";
import { randomUUID } from "node:crypto";

import { connectMongoDB } from "../shared/mongodb.js";
import { Job } from "../shared/model.js";
import { emitEvent } from "../shared/events.js";

const app = express();

const PORT = 4000;
const STREAM_NAME = "jobs";
const SYSTEM_EVENTS_STREAM = "system_events";

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

app.use(express.json());
app.use(cors());

await redis.connect();
await connectMongoDB();

console.log("API connected to Redis and MongoDB");

// GET /jobs
app.get("/jobs", async (req, res) => {
  const { state } = req.query;

  const filter = {};

  if (state) {
    filter.state = state;
  }

  const jobs = await Job.find(filter).select("-__v").sort({ createdAt: -1 });

  return res.status(200).json({
    jobs,
  });
});

// POST /jobs
// Execute immediately
app.post("/jobs", async (req, res) => {
  try {
    const { type, payload } = req.body;

    if (!type || !payload) {
      return res.status(400).json({
        message: "type and payload are required",
      });
    }

    const jobId = randomUUID();

    const job = await Job.create({
      jobId,
      type,
      payload,
      state: "QUEUED",
      attempts: 0,
      maxAttempts: 3,
    });

    await redis.xAdd(STREAM_NAME, "*", {
      jobId: job.jobId,
    });

    await emitEvent({
      source: "API",
      event: "JOB_CREATED",
      message: "Job created",
      jobId: job.jobId,
    });

    return res.status(202).json({
      jobId,
      state: job.state,
    });
  } catch (error) {
    console.error("Failed to create job:", error);

    return res.status(500).json({
      message: "Failed to create job",
    });
  }
});

// GET /metrics
app.get("/metrics", async (req, res) => {
  try {
    const metrics = await Job.aggregate([
      {
        $group: {
          _id: "$state",
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {
      queued: 0,
      dispatched: 0,
      processing: 0,
      retrying: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const metric of metrics) {
      result[metric._id.toLowerCase()] = metric.count;
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Failed to fetch metrics:", error);

    return res.status(500).json({
      message: "Failed to fetch metrics",
    });
  }
});

// POST /jobs/schedule
app.post("/jobs/schedule", async (req, res) => {
  try {
    const { type, payload, runAt } = req.body;

    if (!type || !payload || !runAt) {
      return res.status(400).json({
        message: "type, payload and runAt are required",
      });
    }

    const scheduledTime = new Date(runAt);

    if (Number.isNaN(scheduledTime.getTime())) {
      return res.status(400).json({
        message: "Invalid runAt",
      });
    }

    if (scheduledTime <= new Date()) {
      return res.status(400).json({
        message: "runAt must be in the future",
      });
    }

    const jobId = randomUUID();

    await Job.create({
      jobId,
      type,
      payload,
      state: "QUEUED",
      attempts: 0,
      maxAttempts: 3,
      runAt: scheduledTime,
    });

    return res.status(202).json({
      jobId,
      state: "QUEUED",
      runAt: scheduledTime,
    });
  } catch (error) {
    console.error("Failed to schedule job:", error);

    return res.status(500).json({
      message: "Failed to schedule job",
    });
  }
});

// GET /jobs/failed
app.get("/jobs/failed", async (req, res) => {
  try {
    const failedJobs = await Job.find({
      state: "FAILED",
    }).select("-__v");

    return res.status(200).json({
      failedJobs,
    });
  } catch (error) {
    console.error("Failed to fetch failed jobs:", error);

    return res.status(500).json({
      message: "Failed to fetch failed jobs",
    });
  }
});

// GET /jobs/:jobId
app.get("/jobs/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findOne({ jobId }).select("-__v");

    if (!job) {
      return res.status(404).json({
        message: "Job not found",
      });
    }

    return res.status(200).json(job);
  } catch (error) {
    console.error("Failed to fetch job:", error);

    return res.status(500).json({
      message: "Failed to fetch job",
    });
  }
});

// POST /jobs/:jobId/cancel
app.post("/jobs/:jobId/cancel", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findOneAndUpdate(
      {
        jobId,
        state: {
          $in: ["QUEUED", "RETRYING"],
        },
      },
      {
        $set: {
          state: "CANCELLED",
        },
      },
      {
        returnDocument: "after",
      },
    );

    if (!job) {
      return res.status(409).json({
        message: "Job not found or cannot be cancelled",
      });
    }

    return res.status(200).json({
      message: "Job cancelled",
      job,
    });
  } catch (error) {
    console.error("Failed to cancel job:", error);

    return res.status(500).json({
      message: "Failed to cancel job",
    });
  }
});

// GET /events
app.get("/events", async (req, res) => {
  try {
    const events = await redis.xRevRange(SYSTEM_EVENTS_STREAM, "+", "-", {
      COUNT: 100,
    });

    const formattedEvents = events.map((entry) => ({
      id: entry.id,
      ...entry.message,
    }));

    return res.status(200).json({
      events: formattedEvents,
    });
  } catch (error) {
    console.error("Failed to fetch events:", error);

    return res.status(500).json({
      message: "Failed to fetch events",
    });
  }
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
