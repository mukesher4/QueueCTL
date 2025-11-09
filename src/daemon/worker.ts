import { exec } from "child_process";
import util from "util";
import { pollAndLock, updateJobPersistent, getConfig } from "../db/better-sqlite.js";
import { JobObj } from "../type.js";

const execPromise = util.promisify(exec);

let shutdownGracefully = false;

async function workerLoop() {
	try {
		if (shutdownGracefully) return;
		const jobObj: JobObj | null = pollAndLock();

		if (!jobObj) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			return;
		}

		await processJob(jobObj);
	} catch (err) {
		console.error('Worker error:', err);
	} finally {
		if (!shutdownGracefully) setImmediate(workerLoop);
	}
}
workerLoop();
	
async function processJob(jobObj: JobObj) {
	console.log();
	console.log(JSON.stringify(jobObj));

	try {
		const { stdout } = await execPromise(jobObj.command, {
			timeout: jobObj.timeout || 5000,
			killSignal: "SIGKILL"
		});

		jobObj.attempts += 1;
		console.log(`Output:\n${stdout}`);
		jobObj.state = "completed";
		jobObj.locked_at = undefined;		

		updateJobPersistent(jobObj);

	} catch (err) {
		console.error(`Execution failed: ${(err as Error).message}`);

		jobObj.attempts += 1;

		const maxAttempts = jobObj.max_retries || 0;
		if (jobObj.attempts >= maxAttempts) {
			jobObj.state = "dead";
			jobObj.locked_at = undefined;
			updateJobPersistent(jobObj);
			return;
		}

		jobObj.state = "failed";

		let baseSec = Number(getConfig("delay-base")) / 1000;
		if (baseSec < 1) baseSec = 1;

		const delaySec = Math.pow(baseSec, jobObj.attempts);
		const delayMs  = delaySec * 1000;
		
		updateJobPersistent(jobObj);
	}
}

process.on("SIGTERM", () => {
	console.log("Preparing to stop worker gracefully");
	shutdownGracefully = true;
})
