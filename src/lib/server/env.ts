import { env } from '$env/dynamic/private';

const REQUIRED_FOR_FEEDBACK = [
	'FEEDBACK_APP_ID',
	'FEEDBACK_DB_HOST',
	'FEEDBACK_DB_USER',
	'FEEDBACK_DB_PASSWORD',
	'FEEDBACK_DB_NAME'
];

export function getEnv(name: string, required = true): string {
	const value = env[name] ?? '';
	if (required && !value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

/**
 * Presence-only check, no DB round-trip — a transient DB outage must not hide
 * the feature from real players, so this only answers "has this deployment
 * been set up at all."
 */
export function isFeedbackConfigured(): boolean {
	return REQUIRED_FOR_FEEDBACK.every((name) => !!(env[name] ?? '').trim());
}
