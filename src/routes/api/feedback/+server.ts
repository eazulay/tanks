import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, isFeedbackConfigured } from '$lib/server/env';
import { getPool } from '$lib/server/db';
import { isRateLimited } from '$lib/server/rateLimit';

const MAX_MESSAGE_LENGTH = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: RequestHandler = async () => {
	return json({ enabled: isFeedbackConfigured() });
};

export const POST: RequestHandler = async (event) => {
	// Endpoint doesn't functionally exist on an unconfigured deployment —
	// matches the "absent, not broken" requirement even for a direct request.
	if (!isFeedbackConfigured()) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const { message, email, name, website } = body as Record<string, unknown>;

	// Honeypot: mirrors the hidden field's DOM name, since a mundane-sounding
	// field a real form might have is less likely to be recognized and
	// deliberately omitted than an obvious "hp"-style abbreviation. Pretend
	// success without inserting anything — a fake success (not a 4xx)
	// discourages bot retries and reveals nothing about the detection.
	if (typeof website === 'string' && website.trim() !== '') {
		return json({ ok: true }, { status: 201 });
	}

	const ip = event.getClientAddress();
	if (isRateLimited(ip)) {
		return json({ ok: true }, { status: 201 });
	}

	if (typeof message !== 'string' || message.trim() === '') {
		return json({ error: 'message_required' }, { status: 400 });
	}
	const cleanMessage = message.trim().slice(0, MAX_MESSAGE_LENGTH);

	let cleanEmail: string | null = null;
	if (typeof email === 'string' && email.trim() !== '') {
		const trimmedEmail = email.trim();
		if (!EMAIL_RE.test(trimmedEmail)) {
			return json({ error: 'invalid_email' }, { status: 400 });
		}
		cleanEmail = trimmedEmail.slice(0, 320);
	}

	const cleanName =
		typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 100) : null;

	const appId = Number(getEnv('FEEDBACK_APP_ID'));

	try {
		const pool = getPool();
		await pool.execute(
			'INSERT INTO feedback (app_id, message, email, name, ip_address) VALUES (?, ?, ?, ?, ?)',
			[appId, cleanMessage, cleanEmail, cleanName, ip]
		);
	} catch (err) {
		// Logged in full server-side for diagnosis; the client only gets a
		// generic code — the real error (bad DB credentials, connection
		// refused, etc.) shouldn't be exposed to whoever is submitting feedback.
		console.error('feedback insert failed:', err);
		return json({ error: 'server_error' }, { status: 500 });
	}

	return json({ ok: true }, { status: 201 });
};
