#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs";
import path from "path";

const __filename = import.meta.filename;
const __dirname = import.meta.dirname;

const program = new Command();

program
	.name("queuectl")
	.description("CLI-based background job queue system")
	.version("1.0.0");

const commandsDir = path.join(__dirname, "..", "src", "cli", "commands");
for (const file of fs.readdirSync(commandsDir)) {
	if (!file.endsWith(".js")) continue;

	const mod = await import(path.join(commandsDir, file));
	const register = (mod && mod.default) as unknown;
	if (typeof register === "function") {
		(register as (p: Command) => void)(program);
	}
}

program.parse(process.argv);
