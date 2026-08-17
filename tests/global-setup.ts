import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { loadLocalEnvFile } from './env-file';

export default async function globalSetup() {
  loadLocalEnvFile();
  if (['production','staging'].includes((process.env.APP_ENV??'').toLowerCase())) throw new Error('Vitest refuses to use a production/staging environment.');
  const configured=process.env.DATABASE_URL;
  if(!configured)throw new Error('DATABASE_URL is required for the isolated Vitest database.');
  const url=new URL(configured);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Vitest requires PostgreSQL.');
  const database=url.pathname.slice(1).toLowerCase();
  if(!/(test|dev|local)/.test(database))throw new Error(`Vitest refuses database ${database}; its name must contain test, dev, or local.`);
  const schema=`vitest_${process.pid}_${randomUUID().replaceAll('-','')}`;
  const admin=new PrismaClient({datasourceUrl:configured});
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$disconnect();
  url.searchParams.set('schema',schema);
  process.env.DATABASE_URL=url.toString();
  // The datasource declares `directUrl` for Neon's pooled/direct split. Migrate reads it in
  // preference to `url`, so the isolated test schema must be set on BOTH — otherwise
  // `migrate deploy` would target whatever DIRECT_DATABASE_URL happens to point at, which is
  // the developer's real database rather than this run's throwaway schema.
  process.env.DIRECT_DATABASE_URL=url.toString();
  process.env.APP_ENV='test';
  process.env.COMTRADE_CLIENT='mock';
  process.env.DISCOVERY_ENGINE='warehouse';
  execFileSync(process.execPath,['./node_modules/prisma/build/index.js','migrate','deploy'],{cwd:process.cwd(),env:process.env,stdio:'inherit'});
  return async()=>{
    const cleanup=new PrismaClient({datasourceUrl:configured});
    await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.$disconnect();
  };
}
