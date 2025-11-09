import { State, CommObj, JobObj, MetricsResult } from "../type.js";
import { fork } from "child_process";
import {
	addJobPersistent,
	updateJobPersistent,
	jobIdPresent,
	setConfig,
	getConfig,
	getAllJobs,
	getJob,
	getJobsFromState,
	totalJobsCount,
	completedJobsCount,
	upTime,
	totalCommands,
	avgRunTime,
	maxRunTime
} from "../db/better-sqlite.js";

const workers = new Map<number, ReturnType<typeof fork>>();

function validatePriority(priority: any): boolean {
	if (priority === undefined) return false;
	const p = Number(priority);

	if (isNaN(p) || p < 0 || p > 1) return false;
	return true;
}

export async function enqueue(commObj: CommObj) {
	try {
		if (!commObj.value) throw new Error("Job Object missing");

		const max_retries: number = Number(getConfig("max-retries")) || 3;
		const delay: number = Number(getConfig("delay-base")) || 5000;
		const backoffType = getConfig("backoff")
		const type: string = (backoffType && String(backoffType) !== 'null') ? String(backoffType) : 'exponential';
		const timeout: number = Number(getConfig("timeout")) || 5000;

		const commObjJSON: {
			id: string;
			command: string;
			run_after?: string;
			priority?: number;
		} = JSON.parse(commObj.value);

		if (jobIdPresent(commObjJSON.id)) throw new Error("Job Id already present");
		
		if (commObjJSON.priority && !validatePriority(commObjJSON.priority)) throw new Error("Invalid priority value");

		const currDateISO: string = new Date().toISOString();
		
		let run_after = currDateISO;
		if (commObjJSON.run_after) {
			const d = new Date(commObjJSON.run_after);
			if (isNaN(d.getTime())) throw new Error("Invalid run_after value");
			run_after = d.toISOString();
		}

		const jobObj: JobObj = {
			id: commObjJSON.id,
			command: commObjJSON.command,
			state: "pending",
			attempts: 0,
			max_retries,
			created_at: currDateISO,
			updated_at: currDateISO,
			locked_at: undefined,
			timeout,
			run_after,
			priority: commObjJSON.priority ?? 0,
			started_at: null
		};
		
		addJobPersistent(jobObj);

		console.log(`id: ${jobObj.id}`);
		console.log(`command: ${jobObj.command}`);
		return { success: true, message: "Job enqueued" };
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error enqueuing: ${err.message}`);
		} else {
			throw new Error(`Error enqueuing: ${String(err)}`);
		}
	}
}

export function worker(commObj: CommObj) {
	try {
		let message = '';
		if (commObj.option === "start") {
			if (!commObj.value || isNaN(Number(commObj.value))) return;
			
			for (let i = 0; i < Number(commObj.value); i++) {
				const child = fork("./dist/src/daemon/worker.js");
				workers.set(child.pid!, child);

				message = `Started ${commObj.value} worker`;
			}
		} else {
			for (const [pid, proc] of workers) {
				proc.kill("SIGTERM");
				console.log(`Worker ${pid} stopped`);
				workers.delete(pid);
			}

			message = 'Stopped workers';
		}
		return { success: true, message };
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error starting/stopping worker: ${err.message}`);
		} else {
			throw new Error(`Error starting/stopping worker: ${String(err)}`)
		}
	}
}

export async function status() {
	try {
		const jobs: JobObj[] = getAllJobs();
		const result = {
			jobs: {
				pending: 0,
				processing: 0,
				completed: 0,
				failed: 0,
				dead: 0
			},
			workers: 0
		};

		for (const job of jobs) {
			const jobState = job.state;

			switch (jobState) {
				case 'pending':
					result.jobs.pending += 1; break;
				case 'processing':
						result.jobs.processing += 1; break;
				case 'completed':
					result.jobs.completed += 1; break;
				case 'failed':
					result.jobs.failed += 1; break;
				default:
					result.jobs.dead += 1; break;
			}
		};
		
		result.workers = workers.size;

		return { success: true, message: result };
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error getting status: ${err.message}`);
		} else {
			throw new Error(`Error getting status: ${String(err)}`);
		}
	}
}

export async function list(commObj: CommObj) {
	try {
		if (!commObj.value) throw new Error("State not provided");
		const state: State = commObj.value as State;
		const jobs: JobObj[] = getJobsFromState(state);

		return { success: true, message: jobs };
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error getting list: ${err.message}`);
		} else {
			throw new Error(`Error getting list: ${String(err)}`);
		}
	}
}

async function getJobFromJobId(queue: any, jobId: string): Promise<any> {
	try {
		const jobs = await queue.getJobs(['completed', 'failed', 'waiting', 'active']);
		const result: JobObj[] = [];

		for (const job of jobs) {
			if (job.data.id === jobId) return job;
		}

		return;
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error getting job: ${err.message}`);
		} else {
			throw new Error(`Error getting job: ${String(err)}`);
		}
	}
}

export async function dlq(commObj: CommObj) {
	try {
		if (commObj.option == "list") {
			const jobs: JobObj[] = getJobsFromState("dead");

			return { success: true, message: jobs };

		} else if (commObj.option == "retry") {
			if (!commObj.value) throw new Error("jobId not provided");
			const jobId: string = commObj.value;

			const jobObj = getJob(jobId);
			if (!jobObj || jobObj.state !== 'dead') throw new Error("Job not found in DLQ");

			jobObj.state = 'pending';
			jobObj.attempts = 0;
			jobObj.locked_at = undefined;
			jobObj.run_after = new Date().toISOString();

			const max_retries: number = Number(getConfig("max-retries")) || 3;
			const timeout: number = Number(getConfig("timeout")) || 5000;

			jobObj.max_retries = max_retries;
			jobObj.timeout = timeout;

			updateJobPersistent(jobObj);

			return { success: true, message: `Job ${jobId} added to queue` };
		}
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error accessing DLQ list: ${err.message}`);
		} else {
			throw new Error(`Error accessing DLQ list: ${String(err)}`);
		}
	}
}

export function config(commObj: CommObj) {
	try {
		const { flag, value } = commObj;
		if (!flag || !value) throw new Error("Invalid key or value");

		setConfig(flag, Number(value));

		return { success: true, message: `Updated ${flag} to ${value}` };
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error configuring: ${err.message}`);
		} else {
			throw new Error(`Error configuring: ${String(err)}`);
		}
	}
}

export function metrics() {
	try {
		const result: MetricsResult = {
			total_jobs: totalJobsCount(),
			completed_jobs: completedJobsCount(),
			uptime: String(upTime()) + " min",
			total_commands: totalCommands(),
			average_runtime: avgRunTime(),
			max_runtime: maxRunTime()
		};

		return { success: true, message: result };
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Error generating metrics: ${err.message}`);
		} else {
			throw new Error(`Error generating metrics: ${String(err)}`);
		}	
	}
}
