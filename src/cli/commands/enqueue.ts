import { Command } from "commander";
import { CommObj } from "../../type.js";
import { IPCConnectionWDaemon } from "../../lib/cli.js";

export default function (program: Command) {
	program
		.command("enqueue")
		.argument("<jobJson>", "Job JSON, e.g. {\"id\":\"job1\",\"command\":\"sleep 2\"}")
		.description("Enqueue a job to execute it")
		.usage(`'{"id":"job1","command":"sleep 2"}'`)
		.addHelpText(
		"after",
            `
Examples:

# Basic
$ queuectl enqueue '{"id":"job1","command":"sleep 2"}'

# With run_after
$ queuectl enqueue '{"id":"job2","command":"echo hi","run_after":"2025-11-10T15:00:00Z"}'

# With priority (0=normal, 1=high)
$ queuectl enqueue '{"id":"job3","command":"ls","priority":1}'

# With both
$ queuectl enqueue '{"id":"job4","command":"node script.js","run_after":"2025-11-10T10:30:00Z","priority":1}'
`
		)
		.action(async (jobJson) => {
			const commObj: CommObj = {
				command: "enqueue",
				option: null,
				flag: null,
				value: jobJson
			};
			IPCConnectionWDaemon(commObj);
		});
};
