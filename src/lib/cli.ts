import net from "net";
import { CommObj, IPCObj } from "../type.js";
import dotenv from "dotenv";

dotenv.config();

const SOCKET_PATH = process.env.SOCKET_PATH || "/tmp/queuectl.sock";

export function IPCConnectionWDaemon(commObj: CommObj) {
	const client = net.createConnection(SOCKET_PATH);

	client.write(JSON.stringify(commObj));

	client.on("data", (data) => {
		const res: IPCObj = JSON.parse(data.toString());
		if (res.result) {
			console.log(res.message);
		} else {
			console.error(res?.message ?? "Error performing action");
		}
		client.end();
	});

	client.on("error", (err) => {
		console.error("IPC connection error:", err.message);
	});
};
