import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { exec } from "child_process";
import { promisify } from "util";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { initDB, initMetrics } from "../src/db/better-sqlite.js";

const execAsync = promisify(exec);
// Create unique test DB for each test run
const TEST_DB = path.join(process.cwd(), `test-queuectl-${Date.now()}-${Math.random().toString(36).substring(7)}.db`);
const SOCKET_PATH = `/tmp/queuectl-test-${Date.now()}-${Math.random().toString(36).substring(7)}.sock`;

let daemonProcess: any;
let db: Database.Database;

// Helper to run queuectl commands
async function runQueuectl(cmd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(`SOCKET_PATH=${SOCKET_PATH} queuectl ${cmd}`);
  } catch (error: any) {
    // Return stdout/stderr even on error
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

// Helper to query database directly
function getJob(jobId: string): any {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
}

function getJobsByState(state: string): any[] {
  return db.prepare("SELECT * FROM jobs WHERE state = ?").all(state) as any[];
}

function getAllJobs(): any[] {
  return db.prepare("SELECT * FROM jobs").all() as any[];
}

function getStatus() {
  const jobs = db.prepare("SELECT state FROM jobs").all() as { state: string }[];
  const status = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    dead: 0,
  };
  jobs.forEach((j) => {
    if (status[j.state as keyof typeof status] !== undefined) {
      status[j.state as keyof typeof status]++;
    }
  });
  return status;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Setup: Start daemon before tests
beforeAll(async () => {
  // Set test DB path via environment variable
  process.env.DB_PATH = TEST_DB;
  process.env.SOCKET_PATH = SOCKET_PATH;

  // Clean up old test files
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

  // Open test database and initialize schema
  db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  
  // Initialize database schema
  db.prepare(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT DEFAULT 'pending',
      attempts INT DEFAULT 0,
      max_retries INT DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      locked_at DATETIME,
      timeout INT DEFAULT 5000,
      run_after DATETIME DEFAULT CURRENT_TIMESTAMP,
      priority INT DEFAULT 0,
      started_at DATETIME
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run();
  
  db.prepare(`
    INSERT OR IGNORE INTO config (key, value)
    VALUES
      ('max-retries', NULL),
      ('backoff', NULL),
      ('delay-base', NULL),
      ('timeout', NULL)
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      daemon_startup DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_commands INT DEFAULT 0
    )
  `).run();

  // Initialize metrics
  const isoNow = new Date().toISOString();
  db.prepare(`
    INSERT INTO metrics (daemon_startup, total_commands)
    VALUES (?, 0)
  `).run(isoNow);

  // Start daemon
  daemonProcess = spawn("node", ["dist/src/daemon/daemon.js"], {
    env: { ...process.env, DB_PATH: TEST_DB, SOCKET_PATH },
    stdio: "pipe",
  });

  // Wait for daemon to start and initialize
  await wait(2000);
  
  // Verify daemon is running by checking socket exists
  let retries = 0;
  while (!fs.existsSync(SOCKET_PATH) && retries < 10) {
    await wait(200);
    retries++;
  }
  
  if (!fs.existsSync(SOCKET_PATH)) {
    throw new Error("Daemon failed to start - socket not found");
  }
});

afterAll(async () => {
  // Stop daemon
  if (daemonProcess) {
    daemonProcess.kill();
    await wait(500);
  }

  // Close DB
  if (db) db.close();

  // Cleanup
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
  const walPath = `${TEST_DB}-wal`;
  const shmPath = `${TEST_DB}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
});

beforeEach(() => {
  // Clean jobs before each test
  db.prepare("DELETE FROM jobs").run();
});

describe("QueueCTL Test Scenarios", () => {
  test("1. Basic job completes successfully", async () => {
    // Enqueue a simple job
    await runQueuectl(`enqueue '{"id":"test1","command":"echo hello"}'`);

    // Wait a bit for the job to be written to database
    await wait(500);

    // Verify job was created
    let job = getJob("test1");
    expect(job).toBeDefined();
    expect(job.state).toBe("pending");

    // Start worker
    await runQueuectl("worker start --count 1");

    // Wait for job to complete
    await wait(2000);

    // VERIFY: Check database directly - job should be completed
    job = getJob("test1");
    expect(job).toBeDefined();
    expect(job.state).toBe("completed");
    expect(job.attempts).toBe(1);

    // Stop worker
    await runQueuectl("worker stop");
  });

  test("2. Failed job retries with backoff and moves to DLQ", async () => {
    // Set max retries to 2
    await runQueuectl("config set max-retries 2");
    await runQueuectl("config set delay-base 1000");

    // Enqueue a job that will fail (command doesn't exist)
    await runQueuectl(
      `enqueue '{"id":"fail1","command":"nonexistent-command-xyz123"}'`
    );

    // Wait a bit for the job to be written to database
    await wait(500);

    // Verify job was created
    let job = getJob("fail1");
    expect(job).toBeDefined();
    expect(job.state).toBe("pending");
    expect(job.max_retries).toBe(2);

    // Start worker
    await runQueuectl("worker start --count 1");

    // Wait for retries (2 attempts + backoff delays)
    // With delay-base=1000ms (1 second), backoff will be:
    // Attempt 1: 1^1 = 1 second
    // Attempt 2: 1^2 = 1 second
    // Total: ~2-3 seconds for both attempts
    await wait(5000);

    // VERIFY: Check database - job should be in DLQ (dead state)
    job = getJob("fail1");
    expect(job).toBeDefined();
    expect(job.state).toBe("dead");
    expect(job.attempts).toBe(2); // Should have tried 2 times

    // VERIFY: DLQ list should contain it
    const deadJobs = getJobsByState("dead");
    expect(deadJobs.some((j) => j.id === "fail1")).toBe(true);
    expect(deadJobs.length).toBeGreaterThan(0);

    await runQueuectl("worker stop");
  });

  test("3. Multiple workers process jobs without overlap", async () => {
    // Enqueue 5 jobs
    for (let i = 0; i < 5; i++) {
      await runQueuectl(
        `enqueue '{"id":"multi${i}","command":"echo job${i}"}'`
      );
    }

    // Wait a bit for all jobs to be written to database
    await wait(500);

    // Verify all jobs were created
    const allJobs = getAllJobs();
    expect(allJobs.length).toBe(5);

    // Start 3 workers
    await runQueuectl("worker start --count 3");

    // Wait for all jobs to complete
    await wait(3000);

    // VERIFY: All jobs completed, no duplicates
    const completed = getJobsByState("completed");
    const jobIds = completed.map((j) => j.id).filter((id) =>
      id.startsWith("multi")
    );
    expect(jobIds.length).toBe(5);
    expect(new Set(jobIds).size).toBe(5); // No duplicates

    // VERIFY: Each job has attempts = 1 (only processed once)
    jobIds.forEach((id) => {
      const job = getJob(id);
      expect(job.attempts).toBe(1);
      expect(job.state).toBe("completed");
    });

    // VERIFY: No job is in processing state (all done)
    const processing = getJobsByState("processing");
    const multiProcessing = processing.filter((j) => j.id.startsWith("multi"));
    expect(multiProcessing.length).toBe(0);

    await runQueuectl("worker stop");
  });

  test("4. Invalid commands fail gracefully", async () => {
    // Test invalid JSON
    const result1 = await runQueuectl(`enqueue 'invalid-json'`);
    const output1 = (result1.stderr || result1.stdout).toLowerCase();
    expect(output1).toMatch(/error/);

    // VERIFY: No job was created
    const allJobs = getAllJobs();
    expect(allJobs.length).toBe(0);

    // Test invalid command (missing required field)
    const result2 = await runQueuectl(`enqueue '{"id":"test"}'`);
    const output2 = (result2.stderr || result2.stdout).toLowerCase();
    expect(output2).toMatch(/error/);

    // VERIFY: No job was created
    const allJobs2 = getAllJobs();
    expect(allJobs2.length).toBe(0);

    // Test invalid CLI command
    const result3 = await runQueuectl("invalid-command");
    const output3 = (result3.stderr || result3.stdout).toLowerCase();
    expect(output3).toMatch(/error/);

    // Test duplicate job ID
    await runQueuectl(`enqueue '{"id":"duplicate","command":"echo test"}'`);
    
    // Wait a bit for the job to be written
    await wait(500);
    
    const result4 = await runQueuectl(
      `enqueue '{"id":"duplicate","command":"echo test2"}'`
    );
    const output4 = (result4.stderr || result4.stdout).toLowerCase();
    expect(output4).toMatch(/error/);

    // VERIFY: Only one job exists
    const allJobs3 = getAllJobs();
    expect(allJobs3.length).toBe(1);
    expect(allJobs3[0].command).toBe("echo test"); // First one
  });

  test("5. Job data survives restart", async () => {
    // Enqueue a job
    await runQueuectl(`enqueue '{"id":"persist1","command":"echo persist"}'`);

    // Wait a bit for the job to be written to database
    await wait(500);

    // VERIFY: Job exists in DB
    let job = getJob("persist1");
    expect(job).toBeDefined();
    expect(job.state).toBe("pending");
    expect(job.command).toBe("echo persist");
    expect(job.id).toBe("persist1");

    // Get initial job data
    const initialCreatedAt = job.created_at;
    const initialUpdatedAt = job.updated_at;

    // Simulate restart: Stop daemon, restart it
    daemonProcess.kill();
    await wait(1000);

    // Restart daemon
    daemonProcess = spawn("node", ["dist/src/daemon/daemon.js"], {
      env: { ...process.env, DB_PATH: TEST_DB, SOCKET_PATH },
      stdio: "pipe",
    });
    await wait(1500);

    // VERIFY: Job still exists after restart
    job = getJob("persist1");
    expect(job).toBeDefined();
    expect(job.state).toBe("pending");
    expect(job.command).toBe("echo persist");
    expect(job.id).toBe("persist1");
    expect(job.created_at).toBe(initialCreatedAt); // Same creation time

    // Verify we can still interact with it via CLI
    const status = await runQueuectl("status");
    expect(status.stdout || status.stderr).toBeDefined();

    // Verify job is still accessible
    const allJobs = getAllJobs();
    expect(allJobs.some((j) => j.id === "persist1")).toBe(true);
  });
});

