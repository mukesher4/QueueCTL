# Testing Guide for Evaluators

This document explains how to verify the test scenarios for QueueCTL.

## Prerequisites

- Node.js (v18 or higher)
- npm

## Setup

1. **Clone/Download the repository**

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Make `queuectl` command available:**
   ```bash
   # Option 1: Link globally (recommended)
   npm link
   
   # Option 2: Use full path in tests (if linking doesn't work)
   # The tests will need to be updated to use: node dist/bin/queuectl.js
   ```

## Running Tests

### Run all tests:
```bash
npm test
```

### Run tests in watch mode:
```bash
npm run test:watch
```

### Run tests with coverage:
```bash
npm run test:coverage
```

## Expected Test Output

When tests pass, you should see:

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

## What Each Test Verifies

### Test 1: Basic job completes successfully
- **What it does:** Enqueues a simple job (`echo hello`), starts a worker, waits for completion
- **How to verify:** 
  - Check that job state changes from `pending` → `completed` in database
  - Verify `attempts = 1` (only tried once)
  - Check that job is in `completed` state

### Test 2: Failed job retries with backoff and moves to DLQ
- **What it does:** 
  - Sets max retries to 2
  - Enqueues a job with invalid command (`nonexistent-command-xyz123`)
  - Waits for retries and DLQ transition
- **How to verify:**
  - Check database: job state should be `dead` (in DLQ)
  - Verify `attempts = 2` (tried twice before giving up)
  - Verify job exists in `dead` state in database
  - Verify exponential backoff was applied (check `run_after` timestamps)

### Test 3: Multiple workers process jobs without overlap
- **What it does:**
  - Enqueues 5 jobs
  - Starts 3 workers
  - Waits for all jobs to complete
- **How to verify:**
  - All 5 jobs should be in `completed` state
  - Each job should have `attempts = 1` (processed only once)
  - No duplicate job IDs in completed jobs
  - No jobs stuck in `processing` state

### Test 4: Invalid commands fail gracefully
- **What it does:** Tests various invalid inputs
- **How to verify:**
  - Invalid JSON: Should show error, no job created
  - Missing required field: Should show error, no job created
  - Invalid CLI command: Should show error message
  - Duplicate job ID: Should show error, only first job exists

### Test 5: Job data survives restart
- **What it does:**
  - Enqueues a job
  - Stops daemon
  - Restarts daemon
  - Verifies job still exists
- **How to verify:**
  - Job should exist in database before restart
  - Job should still exist after restart
  - Job data (id, command, state) should be unchanged
  - Job should still be accessible via CLI

## Manual Verification (Optional)

You can also manually verify by:

1. **Start the daemon:**
   ```bash
   node dist/src/daemon/daemon.js
   ```

2. **In another terminal, run CLI commands:**
   ```bash
   # Enqueue a job
   queuectl enqueue '{"id":"manual1","command":"echo hello"}'
   
   # Check status
   queuectl status
   
   # Start worker
   queuectl worker start --count 1
   
   # Wait a bit, then check status again
   queuectl status
   
   # List completed jobs
   queuectl list --state completed
   ```

3. **Check database directly:**
   ```bash
   sqlite3 queuectl.db "SELECT * FROM jobs;"
   ```

## Troubleshooting

### Issue: `queuectl: command not found`
**Solution:** Run `npm link` from project root, or update test file to use full path.

### Issue: Tests fail with "IPC connection error"
**Solution:** Make sure daemon is starting correctly. Check that:
- `dist/src/daemon/daemon.js` exists (run `npm run build`)
- No other daemon is running on the same socket path
- Test database path is writable

### Issue: Tests timeout
**Solution:** 
- Increase timeout in `vitest.config.ts` if needed
- Check that workers are actually processing jobs
- Verify database is accessible

### Issue: Database locked errors
**Solution:**
- Make sure previous test runs cleaned up properly
- Delete any leftover test database files
- Check that WAL files are cleaned up

## Test Database

Tests create a unique database file for each run:
- Format: `test-queuectl-{timestamp}-{random}.db`
- Location: Project root directory
- Cleanup: Automatically deleted after tests complete

## Coverage

To see code coverage:
```bash
npm run test:coverage
```

This will show which parts of the codebase are covered by tests.

## Notes for Evaluators

1. **Tests are integration tests** - They test the full system (CLI → Daemon → Database)
2. **Database verification** - Tests use direct database queries to verify state, not just CLI output
3. **Isolated test runs** - Each test run uses a fresh database
4. **Real worker processes** - Tests actually spawn worker processes to verify concurrency
5. **Daemon restart simulation** - Test 5 actually stops and restarts the daemon

The tests demonstrate that all 5 required scenarios work correctly.

