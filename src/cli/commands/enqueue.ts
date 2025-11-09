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
Example:
$ queuectl enqueue '{"id":"job1","command":"sleep 2"}'
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
