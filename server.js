import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, dbEnabled, initDatabase } from './database.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const PORT=Number(process.env.PORT)||3000;
const DATA=path.join(__dirname,'data');
await fs.mkdir(DATA,{recursive:true});
async function readJson(name,fallback){try{return JSON.parse(await fs.readFile(path.join(DATA,name),'utf8'))}catch{return fallback}}
async function writeJson(name,value){await fs.writeFile(path.join(DATA,name),JSON.stringify(value,null,2)+'\n','utf8')}
if(dbEnabled)await initDatabase();

app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(compression());
app.use(morgan('tiny'));
app.use(express.json({limit:'64kb'}));
app.use('/api/',rateLimit({windowMs:60_000,limit:90,standardHeaders:true,legacyHeaders:false,message:{error:'طلبات كثيرة؛ انتظر قليلًا ثم أعد المحاولة.'}}));

app.get('/api/health',async(_req,res)=>{
  let database='json-fallback';
  if(dbEnabled){try{await pool.query('SELECT 1');database='postgresql'}catch{database='unavailable'}}
  res.status(database==='unavailable'?503:200).json({ok:database!=='unavailable',app:'know-your-product',version:'1.5.0',database});
});

app.get('/api/product/:barcode',async(req,res)=>{
  const code=req.params.barcode;
  if(!/^\d{8,14}$/.test(code))return res.status(400).json({error:'الباركود يجب أن يتكون من 8 إلى 14 رقمًا.'});
  if(dbEnabled){
    const result=await pool.query('SELECT payload,source,source_url FROM products WHERE barcode=$1 LIMIT 1',[code]);
    if(result.rowCount)return res.json({...result.rows[0].payload,source:result.rows[0].source,source_url:result.rows[0].source_url});
  }else{
    const local=await readJson('products.json',[]);
    const match=local.find(p=>String(p.barcode)===code);
    if(match)return res.json(match);
  }
  res.status(404).json({error:'لم نعثر على المنتج في قاعدة البيانات المحلية؛ يمكن البحث في المصادر المفتوحة.'});
});

app.get('/api/search',async(req,res)=>{
  const q=String(req.query.q||'').trim();
  if(q.length<2)return res.status(400).json({error:'اكتب حرفين على الأقل.'});
  const limit=Math.min(30,Math.max(1,Number.parseInt(String(req.query.limit||'20'),10)||20));
  if(dbEnabled){
    const result=await pool.query(
      `SELECT payload,source,source_url FROM products
       WHERE name ILIKE $1 OR brand ILIKE $1 OR barcode=$2
       ORDER BY CASE WHEN barcode=$2 THEN 0 ELSE 1 END, imported_at DESC
       LIMIT $3`,
      ['%'+q+'%',q,limit]
    );
    return res.json({results:result.rows.map(row=>({...row.payload,source:row.source,source_url:row.source_url})),count:result.rowCount,storage:'postgresql'});
  }
  const list=await readJson('products.json',[]);
  const words=q.toLocaleLowerCase().split(/\s+/);
  const results=list.filter(p=>words.every(w=>[p.name,p.brand,p.barcode].some(v=>String(v||'').toLocaleLowerCase().includes(w)))).slice(0,limit);
  res.json({results,count:results.length,storage:'json'});
});

const contributionLimiter=rateLimit({windowMs:60*60_000,limit:5,standardHeaders:true,legacyHeaders:false,message:{error:'وصلت إلى الحد المؤقت للمساهمات. حاول لاحقًا.'}});
app.post('/api/contributions',contributionLimiter,async(req,res)=>{
  const name=String(req.body?.name||'').trim();
  const barcode=String(req.body?.barcode||'').trim();
  if(name.length<2)return res.status(400).json({error:'اسم المنتج مطلوب ويجب أن يتكون من حرفين على الأقل.'});
  if(barcode&&!/^[0-9]{8,14}$/.test(barcode))return res.status(400).json({error:'الباركود يجب أن يتكون من 8 إلى 14 رقمًا.'});
  const row={id:globalThis.crypto.randomUUID(),name:name.slice(0,180),brand:String(req.body?.brand||'').slice(0,180),barcode,usage:String(req.body?.usage||'').slice(0,1000),ingredients:String(req.body?.ingredients||'').slice(0,4000),warnings:String(req.body?.warnings||'').slice(0,2000),createdAt:new Date().toISOString(),status:'pending'};
  if(dbEnabled){
    await pool.query(
      'INSERT INTO contributions(id,name,brand,barcode,usage,ingredients,warnings,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [row.id,row.name,row.brand,row.barcode,row.usage,row.ingredients,row.warnings,row.createdAt,row.status]
    );
  }else{
    const rows=await readJson('contributions.json',[]);
    if(rows.length>=10000)return res.status(503).json({error:'توقفت المساهمات مؤقتًا لأن مخزن المراجعة بلغ الحد المحدد.'});
    rows.push(row);
    await writeJson('contributions.json',rows);
  }
  res.status(201).json({message:'تم استلام المساهمة للمراجعة.',id:row.id,status:'pending'});
});

app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.get('*',(req,res,next)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'المسار غير موجود.'});res.sendFile(path.join(__dirname,'public','index.html'),err=>err&&next(err))});
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'حدث خطأ داخلي.'})});

const server=app.listen(PORT,'0.0.0.0',()=>console.log('Know Your Product listening on '+PORT+'; database: '+(dbEnabled?'PostgreSQL':'JSON fallback')));
async function shutdown(){server.close(async()=>{if(pool)await pool.end().catch(()=>{});process.exit(0)})}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
