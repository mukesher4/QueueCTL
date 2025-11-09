# QueueCTL

A production-grade CLI-based background job queue system with worker processes, automatic retries with exponential backoff, and Dead Letter Queue (DLQ) support.

## 📋 Setup Instructions

### Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)

### Installation Steps

1. **Clone or download the repository:**
   ```bash
   git clone <repository-url>
   cd QueueCTL
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Link the CLI globally (optional but recommended):**
   ```bash
   npm link
   ```
   
   This makes the `queuectl` command available system-wide. Verify with:
   ```bash
   queuectl --version
   ```

5. **Start the daemon:**

   You can run the daemon in two ways. The **preferred option** is to run it as a background service so it stays alive automatically.

   **If your init system is \`systemd\`:**

   1. Create a service file at:

      ```
      /etc/systemd/system/queuectl.service
      ```

   2. Add the following configuration:

      ```
      [Unit]
      Description=QueueCTL Daemon
      After=network.target

      [Service]
      ExecStart=/usr/bin/node /path/to/project/dist/src/daemon/daemon.js
      WorkingDirectory=/path/to/project
      Restart=always
      User=YOUR_USERNAME
      Group=YOUR_USERNAME
      Environment=NODE_ENV=production

      [Install]
      WantedBy=multi-user.target
      ```

   3. Enable and start the service:

      ```
      sudo systemctl daemon-reload
      sudo systemctl enable queuectl
      sudo systemctl start queuectl
      ```

   4. Check whether the daemon is running:

      ```
      systemctl status queuectl
      ```

   **If you are *not* using \`systemd\`**, or you prefer running it manually:

   Run the daemon directly from a terminal:



6. **Verify installation:**
   
   In another terminal, test the CLI:
   ```bash
   # Check version
   queuectl --version
   
   # Enqueue a test job
   queuectl enqueue '{"id":"test1","command":"echo Hello"}'
   
   # Check status
   queuectl status
   ```

### Database Location

By default, the database is created at:
- **Path**: `./queuectl.db` (in project root)
- **WAL files**: `queuectl.db-wal`, `queuectl.db-shm` (auto-created)

To use a custom database path, set the `DB_PATH` environment variable.

## 💡 Usage Examples

### Example 1: Basic Job Processing

**Enqueue a job:**
```bash
queuectl enqueue '{"id":"hello","command":"echo Hello World"}'
```

**Output:**
```
id: hello
command: echo Hello World
{"success":true,"message":"Job enqueued"}
```

**Check status:**
```bash
queuectl status
```

**Output:**
```json
{
  "jobs": {
    "pending": 1,
    "processing": 0,
    "completed": 0,
    "failed": 0,
    "dead": 0
  },
  "workers": 0
}
```

**Start worker:**
```bash
queuectl worker start --count 1
```

**Output:**
```
{"success":true,"message":"Started 1 worker"}
```

**After processing - check status again:**
```bash
queuectl status
```

**Output:**
```json
{
  "jobs": {
    "pending": 0,
    "processing": 0,
    "completed": 1,
    "failed": 0,
    "dead": 0
  },
  "workers": 1
}
```

**List completed jobs:**
```bash
queuectl list --state completed
```

**Output:**
```json
[
  {
    "id": "hello",
    "command": "echo Hello World",
    "state": "completed",
    "attempts": 1,
    "max_retries": 3,
    "created_at": "2025-01-15T10:30:00.000Z",
    "updated_at": "2025-01-15T10:30:02.000Z",
    "priority": 0
  }
]
```

---

### Example 2: Job with Retries and DLQ

**Configure retries:**
```bash
queuectl config set max-retries 2
queuectl config set delay-base 1000
```

**Output:**
```
{"success":true,"message":"Updated max-retries to 2"}
{"success":true,"message":"Updated delay-base to 1000"}
```

**Enqueue a failing job:**
```bash
queuectl enqueue '{"id":"fail-test","command":"nonexistent-command-xyz"}'
```

**Start worker:**
```bash
queuectl worker start --count 1
```

**Wait for retries (5-10 seconds), then check DLQ:**
```bash
queuectl dlq list
```

**Output:**
```json
[
  {
    "id": "fail-test",
    "command": "nonexistent-command-xyz",
    "state": "dead",
    "attempts": 2,
    "max_retries": 2,
    "created_at": "2025-01-15T10:35:00.000Z",
    "updated_at": "2025-01-15T10:35:10.000Z"
  }
]
```

**Retry from DLQ:**
```bash
queuectl dlq retry fail-test
```

**Output:**
```
{"success":true,"message":"Job fail-test added to queue"}
```

---

### Example 3: Multiple Workers Processing Jobs

**Enqueue multiple jobs:**
```bash
for i in {1..5}; do
  queuectl enqueue "{\"id\":\"job$i\",\"command\":\"echo job$i\"}"
done
```

**Start 3 workers:**
```bash
queuectl worker start --count 3
```

**Output:**
```
{"success":true,"message":"Started 3 worker"}
```

**Monitor status:**
```bash
queuectl status
```

**Output:**
```json
{
  "jobs": {
    "pending": 0,
    "processing": 0,
    "completed": 5,
    "failed": 0,
    "dead": 0
  },
  "workers": 3
}
```

---

### Example 4: Priority Queue

**Enqueue normal priority job:**
```bash
queuectl enqueue '{"id":"normal","command":"sleep 5","priority":0}'
```

**Enqueue high priority job:**
```bash
queuectl enqueue '{"id":"high","command":"echo urgent","priority":1}'
```

**Start worker:**
```bash
queuectl worker start --count 1
```

**High priority job processes first** (check worker logs or status)

---

### Example 5: Scheduled Jobs

**Schedule job for future:**
```bash
queuectl enqueue '{"id":"scheduled","command":"echo scheduled","run_after":"2025-12-31T23:59:59Z"}'
```

**Check pending jobs:**
```bash
queuectl list --state pending
```

**Output:** (Job listed but won't be processed until `run_after` time)

---

### Example 6: Metrics

**View system metrics:**
```bash
queuectl metrics
```

**Output:**
```json
{
  "total_jobs": 50,
  "completed_jobs": 45,
  "uptime": "120 min",
  "total_commands": 150,
  "average_runtime": 2,
  "max_runtime": 10
}
```

## 🏗️ Architecture Overview

### System Components

```
┌─────────────┐
│   CLI Tool  │ (queuectl)
└──────┬──────┘
       │ IPC (Unix Socket)
       ↓
┌─────────────┐
│   Daemon    │ (Background process)
└──────┬──────┘
       │
       ├─── Worker Process 1
       ├─── Worker Process 2
       └─── Worker Process N
       │
       ↓
┌─────────────┐
│  SQLite DB  │ (Job persistence)
└─────────────┘
```

### Job Lifecycle

#### 1. Job Enqueuing

```
User → CLI → IPC → Daemon → Database
```

**Process:**
1. User runs `queuectl enqueue <jobJson>`
2. CLI parses command and sends JSON via Unix socket
3. Daemon receives message, validates job data
4. Daemon creates job record in database with state `pending`
5. Response sent back to CLI

#### 2. Job Processing

```
Worker → Database (poll) → Lock Job → Execute → Update State
```

**Process:**
1. Worker polls database for available jobs (`pending` or `failed`)
2. Worker uses transaction (`BEGIN IMMEDIATE`) to lock job atomically
3. Job state changes to `processing`, `locked_at` timestamp set
4. Worker executes command via `child_process.exec()`
5. On success: state → `completed`
6. On failure: state → `failed`, attempts incremented
7. If `attempts >= max_retries`: state → `dead` (DLQ)

#### 3. Retry Logic

```
Failed Job → Calculate Backoff → Update run_after → State: failed
```

**Process:**
1. Job fails execution
2. Calculate exponential backoff: `delay = (base / 1000) ^ attempts` seconds
3. Set `run_after = now + delay`
4. State remains `failed` until `run_after` time passes
5. Worker polls again after `run_after` time

### Data Persistence

#### Database Schema

**Jobs Table:**
```sql
CREATE TABLE jobs (
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
```

**Config Table:**
```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
)
```

**Metrics Table:**
```sql
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daemon_startup DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_commands INT DEFAULT 0
)
```

#### Persistence Strategy

- **WAL Mode**: SQLite uses Write-Ahead Logging for better concurrency
- **Transaction Safety**: All job updates use transactions
- **Atomic Operations**: Job locking uses `BEGIN IMMEDIATE` for atomicity
- **Persistence Across Restarts**: All job data survives daemon restarts

### Worker Logic

#### Worker Process Flow

```typescript
while (!shutdownGracefully) {
  1. Poll database for available job
  2. Lock job atomically (transaction)
  3. Execute command
  4. Update job state
  5. If failed: calculate backoff, schedule retry
  6. If max retries exceeded: move to DLQ
  7. Continue polling
}
```

#### Key Worker Features

1. **Polling Loop**: Workers continuously poll database (1 second interval when no jobs)
2. **Atomic Locking**: Uses SQLite transactions to prevent race conditions
3. **Graceful Shutdown**: Handles SIGTERM, finishes current job before exit
4. **Timeout Handling**: Commands timeout after configured duration
5. **Error Handling**: Catches execution errors, updates job state accordingly

#### Concurrency Model

- **Database Locking**: Uses SQLite transactions with `BEGIN IMMEDIATE` to prevent race conditions
- **Job Locking**: Jobs are locked when picked up by a worker (`locked_at` timestamp)
- **Lock Timeout**: Locks expire after job timeout, allowing stuck jobs to be retried
- **Worker Isolation**: Each worker runs in a separate process
- **No Duplicate Processing**: Transaction-based locking ensures only one worker processes a job

### Data Flow

1. **User runs CLI command** → CLI parses command
2. **CLI sends JSON message** → Via Unix socket to daemon
3. **Daemon processes command** → Enqueue, start worker, etc.
4. **Workers poll database** → For available jobs
5. **Worker locks job** → Atomic transaction
6. **Worker processes job** → Executes command
7. **Job state updated** → In database
8. **CLI receives response** → Displays result

### IPC Communication

- **Protocol**: Unix Domain Socket (IPC)
- **Format**: JSON messages
- **Socket Path**: `/tmp/queuectl.sock` (configurable via `SOCKET_PATH`)
- **Message Format**: `{ command, option, flag, value }`
- **Response Format**: `{ success: boolean, message: any }`

## 🤔 Assumptions & Trade-offs

### Design Decisions

#### 1. **SQLite over Redis/PostgreSQL**

**Decision:** Use SQLite for job persistence

**Rationale:**
- ✅ No external dependencies required
- ✅ Embedded database, easy to set up
- ✅ Sufficient for single-machine deployments
- ✅ ACID transactions for data consistency
- ✅ WAL mode provides good concurrency

**Trade-off:**
- ❌ Not suitable for distributed systems
- ❌ Limited scalability compared to Redis/PostgreSQL
- ❌ Single-file database (backup/restore simpler but less flexible)

#### 2. **Unix Socket IPC over HTTP/TCP**

**Decision:** Use Unix Domain Socket for CLI-Daemon communication

**Rationale:**
- ✅ Faster than TCP (no network overhead)
- ✅ More secure (local only)
- ✅ Simpler implementation
- ✅ Standard IPC mechanism for local processes

**Trade-off:**
- ❌ Only works on Unix-like systems (Linux, macOS)
- ❌ Not suitable for remote access
- ❌ Socket file management required

#### 3. **Process-based Workers over Threads**

**Decision:** Use separate Node.js processes for workers

**Rationale:**
- ✅ True parallelism (not limited by event loop)
- ✅ Process isolation (worker crash doesn't affect daemon)
- ✅ Easier to manage and monitor
- ✅ Standard Node.js pattern

**Trade-off:**
- ❌ Higher memory overhead per worker
- ❌ Slower startup time compared to threads
- ❌ More complex inter-process communication

#### 4. **Synchronous Database Operations**

**Decision:** Use `better-sqlite3` (synchronous) over async SQLite

**Rationale:**
- ✅ Simpler code (no async/await for DB operations)
- ✅ Better performance for single-threaded operations
- ✅ Atomic transactions easier to manage
- ✅ Sufficient for this use case

**Trade-off:**
- ❌ Blocks event loop during DB operations
- ❌ Not ideal for high-concurrency scenarios
- ❌ Less idiomatic Node.js (async-first)

#### 5. **Polling over Event-Driven Job Processing**

**Decision:** Workers poll database instead of event-driven notifications

**Rationale:**
- ✅ Simpler implementation
- ✅ No need for pub/sub mechanism
- ✅ Works reliably with SQLite
- ✅ Easy to understand and debug

**Trade-off:**
- ❌ Slight delay in job pickup (polling interval)
- ❌ Higher database load (constant polling)
- ❌ Less efficient than event-driven approach

#### 6. **Exponential Backoff Only**

**Decision:** Implement exponential backoff, not configurable strategies

**Rationale:**
- ✅ Standard retry pattern
- ✅ Prevents overwhelming system with retries
- ✅ Simple to implement and understand
- ✅ Covers most use cases

**Trade-off:**
- ❌ No support for fixed delay or other strategies
- ❌ Less flexible for specific retry needs
- ❌ May be too aggressive for some scenarios

#### 7. **In-Memory Worker Management**

**Decision:** Track workers in daemon's memory (Map)

**Rationale:**
- ✅ Simple and fast
- ✅ No need for persistent worker state
- ✅ Workers are ephemeral (can restart)

**Trade-off:**
- ❌ Worker state lost on daemon restart
- ❌ No worker persistence across restarts
- ❌ Cannot track worker history

### Simplifications Made

1. **No Job Output Storage**: Job output is only logged, not stored in database
2. **No Web UI**: CLI-only interface (no dashboard)
3. **No Job Priorities Beyond 0/1**: Only normal (0) and high (1) priorities

## 🧪 Testing Instructions

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Video Demo

[Watch the video demo](https://drive.google.com/file/d/1yjwKwIbD8O83d5m2XUY-BSwEJMYtf22r/view?usp=sharing)

### Test Scenarios

The test suite covers all 5 required scenarios:

1. ✅ **Basic job completes successfully**
2. ✅ **Failed job retries with backoff and moves to DLQ**
3. ✅ **Multiple workers process jobs without overlap**
4. ✅ **Invalid commands fail gracefully**
5. ✅ **Job data survives restart**

### Test Structure

- **Location**: `tests/scenarios.test.ts`
- **Type**: Integration tests
- **Verification**: Direct database queries (not just CLI output)
- **Isolation**: Each test run uses a fresh database

### How to Verify Functionality

#### Automated Testing

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Link the CLI:**
   ```bash
   npm link
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

**Expected Output:**
```
✓ tests/scenarios.test.ts (5)
  ✓ QueueCTL Test Scenarios (5)
    ✓ 1. Basic job completes successfully
    ✓ 2. Failed job retries with backoff and moves to DLQ
    ✓ 3. Multiple workers process jobs without overlap
    ✓ 4. Invalid commands fail gracefully
    ✓ 5. Job data survives restart

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

#### Manual Verification

1. **Start the daemon:**
   ```bash
   node dist/src/daemon/daemon.js
   ```

2. **Test basic workflow:**
   ```bash
   # Enqueue a job
   queuectl enqueue '{"id":"test1","command":"echo Hello"}'
   
   # Start worker
   queuectl worker start --count 1
   
   # Check status
   queuectl status
   
   # Verify job completed
   queuectl list --state completed
   ```

3. **Test retry mechanism:**
   ```bash
   # Configure retries
   queuectl config set max-retries 2
   
   # Enqueue failing job
   queuectl enqueue '{"id":"fail1","command":"nonexistent-cmd"}'
   
   # Start worker and wait
   queuectl worker start --count 1
   # Wait 5-10 seconds
   
   # Check DLQ
   queuectl dlq list
   ```

4. **Test persistence:**
   ```bash
   # Enqueue job
   queuectl enqueue '{"id":"persist1","command":"echo test"}'
   
   # Stop daemon (Ctrl+C)
   # Restart daemon
   node dist/src/daemon/daemon.js
   
   # Verify job still exists
   queuectl list --state pending
   ```

### Test Coverage

Run with coverage to see which parts of the codebase are tested:

```bash
npm run test:coverage
```

## 📖 Commands Reference

### `enqueue`

Enqueue a new job to the queue.

**Usage:**
```bash
queuectl enqueue '<jobJson>'
```

**Job JSON Format:**
```json
{
  "id": "unique-job-id",
  "command": "command to execute",
  "run_after": "2025-11-10T15:00:00Z",  // Optional: schedule for later
  "priority": 1                           // Optional: 0=normal, 1=high
}
```

**Examples:**
```bash
# Basic job
queuectl enqueue '{"id":"job1","command":"sleep 2"}'

# Job with scheduled execution
queuectl enqueue '{"id":"job2","command":"echo hi","run_after":"2025-11-10T15:00:00Z"}'

# High priority job
queuectl enqueue '{"id":"job3","command":"ls","priority":1}'
```

---

### `worker`

Manage worker processes.

#### Start Workers
```bash
queuectl worker start [--count <number>]
```

#### Stop Workers
```bash
queuectl worker stop
```

---

### `status`

Show summary of all job states and active workers.

```bash
queuectl status
```

---

### `list`

List jobs filtered by state.

```bash
queuectl list --state <state>
```

**States:** `pending`, `processing`, `completed`, `failed`, `dead`

---

### `dlq`

Manage Dead Letter Queue.

#### List DLQ Jobs
```bash
queuectl dlq list
```

#### Retry DLQ Job
```bash
queuectl dlq retry <jobId>
```

---

### `config`

Manage system configuration.

```bash
queuectl config set <key> <value>
```

**Keys:** `max-retries`, `delay-base`, `backoff`, `timeout`

---

### `metrics`

Show daemon metrics and aggregated statistics.

```bash
queuectl metrics
```

## 🔄 Job Lifecycle

### Job States

| State | Description |
|-------|-------------|
| `pending` | Job is waiting to be picked up by a worker |
| `processing` | Job is currently being executed by a worker |
| `completed` | Job executed successfully |
| `failed` | Job failed but will retry (has retries remaining) |
| `dead` | Job permanently failed (moved to DLQ after exhausting retries) |

### State Transitions

```
pending → processing → completed ✅
         ↓
      failed → pending (retry with backoff)
         ↓
       dead (after max retries) → pending (if retried from DLQ)
```

### Exponential Backoff

When a job fails, it's scheduled for retry with exponential backoff:

```
delay = (delay_base / 1000) ^ attempts seconds
```

**Example:**
- `delay_base = 5000` (5 seconds)
- Attempt 1: `(5/1)^1 = 5` seconds
- Attempt 2: `(5/1)^2 = 25` seconds
- Attempt 3: `(5/1)^3 = 125` seconds

## ⚙️ Configuration

### Default Configuration

- **max-retries**: `3`
- **delay-base**: `5000` ms (5 seconds)
- **backoff**: `exponential`
- **timeout**: `5000` ms (5 seconds)

### Environment Variables

- `DB_PATH`: Path to SQLite database file (default: `./queuectl.db`)
- `SOCKET_PATH`: Path to Unix socket for IPC (default: `/tmp/queuectl.sock`)

---

## 📝 License

ISC

---

**QueueCTL** - A production-grade CLI-based background job queue system

