export type State = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

export interface CommObj {
	command: string | null;
	option: string | null;
	flag: string | null;
	value: string | null;
}

export interface JobObj {
	id: string;
	command: string;
	state: string;
	attempts: number;
	max_retries: number;
	created_at: string;
	updated_at: string;
	locked_at: string | undefined;
	timeout: number;
	run_after: string;
};

export interface IPCObj {
	result: boolean;
	message: string;
}
