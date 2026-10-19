import 'dotenv/config';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import pg from 'pg';

const file=process.argv[2];
if(!file){console.error('Usage: npm run import:products -- /path/to/products.jsonl');process.exit(2)}
if(!process.env.DATABASE_URL){console.error('Set DATABASE_URL to a PostgreSQL database before importing.');process.exit(2)}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:process.env.PGSSL_REJECT_UNAUTHORIZED!=='false'}:undefined});
const input=readline.createInterface({input:fs.createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity});
let seen=0,stored=0,skipped=0;
try{
  await pool.query(await fs.readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
  let batch=[];
  async function flush(){
    if(!batch.length)return;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      for(const p of batch){
        await client.query(`INSERT INTO products(barcode,name,brand,source,source_url,payload,source_modified_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
          ON CONFLICT(barcode) DO UPDATE SET name=EXCLUDED.name,brand=EXCLUDED.brand,source=EXCLUDED.source,source_url=EXCLUDED.source_url,payload=EXCLUDED.payload,source_modified_at=EXCLUDED.source_modified_at,imported_at=NOW()`,
          [p.barcode,p.name,p.brand,p.source,p.source_url,JSON.stringify(p.payload),p.source_modified_at]);
        stored++;
      }
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    batch=[];
    if(stored&&stored%10000===0)console.log('Stored',stored,'products');
  }
  for await(const line of input){
    if(!line.trim())continue;
    seen++;
    try{
      const p=JSON.parse(line);
      const barcode=String(p.code||p.barcode||'').trim();
      const name=String(p.product_name||p.product_name_en||p.name||'').trim();
      if(!/^\d{8,14}$/.test(barcode)||!name){skipped++;continue}
      const source=String(p.source||'Open Food Facts');
      const host=source==='Open Beauty Facts'?'world.openbeautyfacts.org':source==='Open Products Facts'?'world.openproductsfacts.org':'world.openfoodfacts.org';
      batch.push({barcode,name:name.slice(0,500),brand:String(p.brands||p.brand||'').slice(0,500),source,source_url:'https://'+host+'/product/'+encodeURIComponent(barcode),payload:p,source_modified_at:Number.isFinite(Number(p.last_modified_t))?new Date(Number(p.last_modified_t)*1000).toISOString():null});
      if(batch.length>=250)await flush();
    }catch(e){if(e instanceof SyntaxError){skipped++;continue}throw e}
  }
  await flush();
  console.log(JSON.stringify({lines_seen:seen,products_upserted:stored,rows_skipped:skipped},null,2));
}finally{await input.close();await pool.end()}
