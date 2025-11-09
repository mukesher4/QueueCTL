import { Command } from "commander";
import { CommObj } from "../../type.js";
import { IPCConnectionWDaemon } from "../../lib/cli.js";

export default function registerDlq(program: Command) {
	const dlq = program
	.command("dlq")
	.description("View or retry DLQ jobs")
	.usage("<command>")
	.addHelpText(
		"after",
		`\nSubcommands:\n  list            View DLQ jobs\n  retry <jobId>   Retry a DLQ job by id\n\nExamples:\n  $ queuectl dlq list\n  $ queuectl dlq retry job1\n`
	);

	dlq
		.command("list")
		.description("List jobs in the dead-letter queue")
		.action(async () => {
			const commObj: CommObj = {
				command: "dlq",
				option: "list",
				flag: null,
				value: null
			};
			IPCConnectionWDaemon(commObj);
		});

	dlq
		.command("retry <jobId>")
		.description("Retry a job from the dead-letter queue")
		.addHelpText(
			"after",
			`\nExample:\n  $ queuectl dlq retry job1\n`
		)
		.action(async (jobId: string) => {
			const commObj: CommObj = {
				command: "dlq",
				option: "retry",
				flag: null,
				value: jobId
			};
	  		IPCConnectionWDaemon(commObj);
		});
}


