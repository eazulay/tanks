import mysql from 'mysql2/promise';
import { getEnv } from './env';

// The `feedback` table is created and migrated manually (see spec/feedback.md
// for the DDL) — the app's DB credentials intentionally have no DDL
// privileges, only SELECT/INSERT/UPDATE on this one table.

let pool: mysql.Pool | null = null;

function createPool(): mysql.Pool {
	return mysql.createPool({
		host: getEnv('FEEDBACK_DB_HOST'),
		port: Number(getEnv('FEEDBACK_DB_PORT', false)) || 3306,
		user: getEnv('FEEDBACK_DB_USER'),
		password: getEnv('FEEDBACK_DB_PASSWORD'),
		database: getEnv('FEEDBACK_DB_NAME'),
		waitForConnections: true,
		connectionLimit: 5,
		queueLimit: 0
	});
}

export function getPool(): mysql.Pool {
	if (!pool) {
		pool = createPool();
	}
	return pool;
}
