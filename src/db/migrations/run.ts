import { DatabaseManager } from '../index.js';
import { databaseConfig } from '../../config/index.js';
import { schema } from './schema.js';
import { fileURLToPath } from 'url';

async function run_migrations() {
	const config = databaseConfig;
	const db_manager = await DatabaseManager.get_instance(config);
	const db = db_manager.get_client();

	try {
		console.log('Starting migrations...');

		for (const migration of schema) {
			console.log(`Executing: ${migration.slice(0, 50)}...`);
			await db.execute(migration);
		}

		console.log('Migrations completed successfully');
	} catch (error) {
		console.error('Error running migrations:', error);
		throw error;
	}
}

// Run migrations if this file is executed directly (ESM compatible)
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
	run_migrations()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}

export { run_migrations };
