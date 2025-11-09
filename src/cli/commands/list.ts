import { Command } from "commander";
import { CommObj } from "../../type.js";
import { IPCConnectionWDaemon } from "../../lib/cli.js";

export default function registerList(program: Command) {
	program
		.command("list")
		.description("List jobs by state")
		.option("--state <state>", "Filter by job state (pending, running, done, failed)")
		.usage("--state pending")
		.addHelpText(
			"after",
			`\nExample:\n  $ queuectl list --state pending\n`
		)
		.action(async (opts: { state: string }) => {
			const state = opts.state;
			const commObj: CommObj = {
				command: "list",
				option: null,
				flag: "--state",
				value: state.toString()
			};
			IPCConnectionWDaemon(commObj);
		});
}
