import net from "net";
import fs from "fs";
import { CommObj } from "../type.js";
import { enqueue, worker, status, list, dlq, config, metrics } from "../lib/daemon.js"
import { initDB, initMetrics, incrementCommandMetrics } from "../db/better-sqlite.js";

const SOCKET_PATH = process.env.SOCKET_PATH || "/tmp/queuectl.sock";

if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

const daemon = net.createServer((conn) => {
	console.log();

	incrementCommandMetrics();

	conn.on("data", async (data) => {
		try {
			const commObj: CommObj = JSON.parse(data.toString());
			console.log("Received data:", commObj);

			let result: unknown;

			switch (commObj.command) {
				case "enqueue":
					result = await enqueue(commObj); break;
				case "worker":
					result = worker(commObj); break;
				case "status":
					result = await status(); break;
				case "list":
					result = await list(commObj); break;
				case "dlq":
					result = await dlq(commObj); break;
				case "config":
					result = config(commObj); break;
				case "metrics":
					result = metrics(); break;
				default:
					result = { success: false, message: "Invalid command" };
			};

			conn.write(`${JSON.stringify(result)}`);
		} catch (err) {
			if (err instanceof Error) {
				conn.write(JSON.stringify({ success: false, message: err.message }));	
			} else {
				conn.write(JSON.stringify({ success: false, message: String(err) }));
			}
		}
	});
});

daemon.listen(SOCKET_PATH, () => {
	initDB();
	initMetrics();

	console.log("Daemon is listening on ", SOCKET_PATH);
});
