import { Command } from "commander";
import { CommObj } from "../../type.js";
import { IPCConnectionWDaemon } from "../../lib/cli.js";

export default function registerMetrics(program: Command) {
	program
		.command("metrics")
		.description("Show daemon metrics & aggregated stats")
		.usage("")
		.addHelpText(
			"after",
			`\nExample:\n  $ queuectl metrics\n`
		)
		.action(async () => {
			const commObj: CommObj = {
				command: "metrics",
				option: null,
				flag: null,
				value: null
			};
			IPCConnectionWDaemon(commObj);
		});
}
