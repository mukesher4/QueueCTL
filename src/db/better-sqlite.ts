import Database from "better-sqlite3";
import path from "path";
import { State, JobObj } from "../type.js";

const DB_PATH = path.join(process.cwd(), "queuectl.db");
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

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
}

export function initMetrics() {
	const isoNow = new Date().toISOString();
	db.prepare(`
		INSERT INTO metrics (daemon_startup, total_commands)
		VALUES (?, 0)
	`).run(isoNow);
}

export function incrementCommandMetrics() {
	db.prepare(`
		UPDATE metrics
		SET total_commands = total_commands + 1
		WHERE id = (SELECT id FROM metrics ORDER BY id DESC LIMIT 1)
	`).run();
}

export function addJobPersistent(jobObj: JobObj) {
	const insert = db.prepare(`
		INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, locked_at, timeout, run_after, priority)
		VALUES (@id, @command, @state, @attempts, @max_retries, @created_at, @updated_at, @locked_at, @timeout, @run_after, @priority)
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
		run_after: jobObj.run_after,
		priority: jobObj.priority
	});
}

export function pollAndLock(): JobObj | null {
	const begin = db.prepare('BEGIN IMMEDIATE;');
	const commit = db.prepare('COMMIT;');
	const rollback = db.prepare('ROLLBACK;');

	const findCandidate = db.prepare(`
		SELECT id
		FROM jobs
		WHERE
			state IN ('pending', 'failed', 'processing')
			AND (
				locked_at IS NULL
				OR datetime(locked_at, '+' || (timeout / 1000.0) || ' seconds') < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'utc')
			)
			AND (
				run_after IS NULL
				OR datetime(run_after) <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'utc')
			)
		ORDER BY priority DESC, created_at ASC
		LIMIT 1
	`);

	const updateJob = db.prepare(`
		UPDATE jobs
		SET
			state = 'processing',
			locked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'utc'),
			updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'utc'),
			started_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'utc')
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
			updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'utc'),
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

// metrics

export function totalJobsCount(): number {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM jobs`).get() as { c: number };
    return r.c;
}

export function completedJobsCount(): number {
    const r = db.prepare(
        `SELECT COUNT(*) AS c FROM jobs WHERE state = 'completed'`
    ).get() as { c: number };
    return r.c;
}

export function upTime(): number {
    const row = db.prepare(
        `SELECT strftime('%s', daemon_startup) AS start_time FROM metrics ORDER BY id DESC LIMIT 1`
    ).get() as { start_time: number } | undefined;
    
    if (!row) return 0;
    
    const currentTime = db.prepare(`SELECT strftime('%s', 'now', 'utc') AS now`).get() as { now: number };
    const diff = currentTime.now - row.start_time;

    return Math.ceil(diff / 60);
}

export function totalCommands(): number {
    const r = db.prepare(
        `SELECT SUM(total_commands) AS total FROM metrics`
    ).get() as { total: number | null };
    return r.total ?? 0;
}

export function avgRunTime(): number {
    const r = db.prepare(`
        SELECT AVG(
            strftime('%s', updated_at) - strftime('%s', started_at)
        ) AS avg_rt
        FROM jobs
        WHERE state = 'completed' 
            AND started_at IS NOT NULL 
            AND updated_at IS NOT NULL
    `).get() as { avg_rt: number | null };
    return Math.round(r.avg_rt ?? 0);
}

export function maxRunTime(): number {
    const r = db.prepare(`
        SELECT MAX(
            strftime('%s', updated_at) - strftime('%s', started_at)
        ) AS max_rt
        FROM jobs
        WHERE state = 'completed' 
            AND started_at IS NOT NULL 
            AND updated_at IS NOT NULL
    `).get() as { max_rt: number | null };
    return r.max_rt ?? 0;
}
