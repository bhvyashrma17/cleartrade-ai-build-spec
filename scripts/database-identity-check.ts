import { validateDatabaseEnvironment } from '../src/lib/runtime-config';

const result = validateDatabaseEnvironment('migration');
console.log(`Database identity validation passed for ${result.environment} migration tooling.`);
