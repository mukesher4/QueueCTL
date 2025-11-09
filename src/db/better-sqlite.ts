import Database from "better-sqlite3";
import path from "path";
import { State, JobObj } from "../type.js";

const DB_PATH = path.join(process.cwd(), "queuectl.db");
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
// db.pragma('busy_timeout = 5000'); // why?

export function initDB() {
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
			run_after DATETIME DEFAULT CURRENT_TIMESTAMP
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
}

export function addJobPersistent(jobObj: JobObj) {
	const insert = db.prepare(`
		INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, locked_at, timeout, run_after)
		VALUES (@id, @command, @state, @attempts, @max_retries, @created_at, @updated_at, @locked_at, @timeout, @run_after)
	`).run({
		id: jobObj.id,
		command: jobObj.command,
		state: jobObj.state,
		attempts: jobObj.attempts,
		max_retries: jobObj.max_retries,
		created_at: jobObj.created_at,
		updated_at: jobObj.updated_at,
		locked_at: jobObj.locked_at,
		timeout: jobObj.timeout,
		run_after: jobObj.run_after
	});
}

export function pollAndLock(): JobObj | null {
	const begin = db.prepare('BEGIN IMMEDIATE;');
	const commit = db.prepare('COMMIT;');
	const rollback = db.prepare('ROLLBACK;');

	// First, find a candidate job
	// Include 'processing' jobs that have timed out (stuck jobs)
	const findCandidate = db.prepare(`
		SELECT id
		FROM jobs
		WHERE
			state IN ('pending', 'failed', 'processing')
			AND (
				locked_at IS NULL
				OR DATETIME(locked_at, '+' || (timeout / 1000.0) || ' seconds') < CURRENT_TIMESTAMP
			)
			AND (
				run_after IS NULL 
				OR DATETIME(run_after) <= CURRENT_TIMESTAMP
			)
		ORDER BY created_at
		LIMIT 1
	`);

	// Update the job to processing state
	const updateJob = db.prepare(`
		UPDATE jobs
		SET
			state = 'processing',
			locked_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`);

	try {
		begin.run();
		
		const candidate = findCandidate.get() as { id: string } | undefined;
		
		if (!candidate) {
			commit.run();
			return null;
		}

		updateJob.run(candidate.id);
		const jobObj = getJob(candidate.id) as JobObj | undefined;
		
		commit.run();

		return jobObj || null;
	} catch (err) {
		rollback.run();
		
		console.error('pollAndLock failed:', err);
		return null;
	}
}

export function jobIdPresent(jobId: string): boolean {
	const row = db.prepare(`
		SELECT * FROM jobs WHERE id = ?
	`).get(jobId);

	return !!row;
}

export function updateJobPersistent(jobObj: JobObj) {
	if (!jobIdPresent(jobObj.id)) throw new Error("Job not found");

	const updateStmt = db.prepare(`
		UPDATE jobs
		SET attempts = COALESCE(?, attempts),
			max_retries = COALESCE(?, max_retries),
			state = COALESCE(?, state),
			updated_at = CURRENT_TIMESTAMP,
			locked_at = ?,
			timeout = COALESCE(?, timeout),
			run_after = COALESCE(?, run_after)
		WHERE id = ?
	`);
	
	updateStmt.run(
		jobObj.attempts,
		jobObj.max_retries,
		jobObj.state, 
		jobObj.locked_at ?? null,
		jobObj.timeout, 
		jobObj.run_after, 
		jobObj.id
	);
}

export function setConfig(key: string, value: number | string) {
	const row = db.prepare(`
		SELECT * FROM config
		WHERE key = ?
	`).get(key);
	if (!row) throw new Error(`Invalid flag ${key}`);

	db.prepare(`
		UPDATE config
		SET value = ?
		WHERE key = ?
	`).run(value, key);
}

export function getConfig(key: string): string | number | undefined {
	const row = db.prepare(`
		SELECT value FROM config
		WHERE key = ?
	`).get(key) as { value: string } | undefined;
	if (!row) return undefined;
	
	return row.value;
}

export function getAllJobs(): JobObj[] {
	const stmt = db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC");
	return (stmt as any).all() as JobObj[];
}

export function getJob(jobId: string): JobObj | undefined {
	return db.prepare(`
		SELECT * FROM jobs WHERE id = ?
	`).get(jobId) as JobObj;
}

export function getJobsFromState(state: State): JobObj[] {
	const stmt = db.prepare(`
		SELECT * FROM jobs WHERE state = ?
	`);

	return stmt.all(state) as JobObj[];
}
