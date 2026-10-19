import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const connectionString=process.env.DATABASE_URL;
export const dbEnabled=Boolean(connectionString);
export const pool=dbEnabled?new pg.Pool({
  connectionString,
  ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:process.env.PGSSL_REJECT_UNAUTHORIZED!=='false'}:undefined,
  max:Number(process.env.PGPOOL_MAX)||10,
  idleTimeoutMillis:30000,
  connectionTimeoutMillis:10000
}):null;
export async function initDatabase(){
  if(!pool)return;
  const schema=await fs.readFile(path.join(__dirname,'database','schema.sql'),'utf8');
  await pool.query(schema);
}
