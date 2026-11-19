import fsp from 'node:fs/promises';
import path from 'node:path';

const ENV_FILE = path.resolve(process.cwd(), '.env');

function formatEnvValue(val: string): string {
	if (/[\s#"'\\]/.test(val)) {
		return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}
	return val;
}

/**
 * Updates or inserts specific keys in the local .env file and syncs process.env.
 */
export async function updateEnvVariables(updates: Record<string, string>): Promise<void> {
	let content = '';
	try {
		content = await fsp.readFile(ENV_FILE, 'utf8');
	} catch {
		content = '';
	}

	const lines = content ? content.split(/\r?\n/) : [];
	const remaining = new Map(Object.entries(updates));

	const nextLines = lines.map((line) => {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
		if (!match) return line;
		const key = match[1];
		if (remaining.has(key)) {
			const val = remaining.get(key)!;
			remaining.delete(key);
			return `${key}=${formatEnvValue(val)}`;
		}
		return line;
	});

	for (const [key, val] of remaining.entries()) {
		nextLines.push(`${key}=${formatEnvValue(val)}`);
	}

	const finalText = nextLines.join('\n').replace(/\n+$/, '\n');
	await fsp.writeFile(ENV_FILE, finalText, 'utf8');

	for (const [key, val] of Object.entries(updates)) {
		process.env[key] = val;
	}
}
