import { Command } from "commander";
import { CommObj } from "../../type.js";
import { IPCConnectionWDaemon } from "../../lib/cli.js";

export default function registerConfig(program: Command) {
	const config = program
		.command("config")
		.description("Manage configuration (retry, backoff, delay, etc.)")
		.usage("set <key> <value>")
		.addHelpText(
			"after",
			`\nSubcommands:
			set max-retries <number>          Set maximum retries for jobs
			set backoff <exponential|fixed>   Set backoff strategy
			set delay-base <ms>               Set base delay in milliseconds

Examples:
	$ queuectl config set max-retries 5
	$ queuectl config set backoff exponential
	$ queuectl config set delay-base 5000
`
	);

	config
		.command("set")
		.argument("<key>", "Configuration key (max-retries, backoff, delay-base)")
		.argument("<value>", "Configuration value")
		.description("Set a configuration key-value pair")
		.action(async (key: string, value: string) => {
			const commObj: CommObj = {
				command: "config",
				option: "set",
				flag: key,
				value
			};
			await IPCConnectionWDaemon(commObj);
		});
}
