import { exec } from "child_process";
import util from "util";
import { pollAndLock, updateJobPersistent, getConfig } from "../db/better-sqlite.js";
import { JobObj } from "../type.js";

const execPromise = util.promisify(exec);

async function workerLoop() {
	try {
		const jobObj: JobObj | null = pollAndLock();

		if (!jobObj) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			return;
		}

		await processJob(jobObj);
	} catch (err) {
		console.error('Worker error:', err);
	} finally {
		setImmediate(workerLoop);
	}
}
workerLoop();

async function processJob(jobObj: JobObj) {
	console.log();
	console.log(JSON.stringify(jobObj));

	try {
		jobObj.attempts += 1;
		updateJobPersistent(jobObj);

		const { stdout } = await execPromise(jobObj.command, {
			timeout: jobObj.timeout || 5000,
			killSignal: "SIGKILL"
		});

		console.log(`Output:\n${stdout}`);
		jobObj.state = "completed";
		jobObj.locked_at = undefined;
		updateJobPersistent(jobObj);

	} catch (err) {
		console.error(`Execution failed: ${(err as Error).message}`);

		const maxAttempts = jobObj.max_retries || 0;
		if (jobObj.attempts >= maxAttempts) {
			jobObj.state = "dead";
			jobObj.locked_at = undefined;
			updateJobPersistent(jobObj);
			return;
		}

		jobObj.state = "failed";

		// what about below 1s values?
		const baseDelay: number = Number(getConfig("delay-base")) / 1000 || 5;
		const delaySec: number = baseDelay ** jobObj.attempts;
		const delayMs: number = delaySec * 1000;
		jobObj.locked_at = undefined;
		jobObj.run_after = new Date(Date.now() + delayMs).toISOString();
		
		updateJobPersistent(jobObj);
	}
}