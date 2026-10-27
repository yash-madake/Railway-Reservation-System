const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

function parseSql(sql) {
  let delimiter=';'; let buffer=''; const statements=[];
  const lines=sql.split(/\r?\n/);
  for(const line of lines){
    const m=line.match(/^\s*DELIMITER\s+(.+)\s*$/i);
    if(m){ delimiter=m[1]; continue; }
    buffer += line+'\n';
    if(buffer.trimEnd().endsWith(delimiter)){
      const statement=buffer.trimEnd().slice(0,-delimiter.length).trim();
      if(statement) statements.push(statement);
      buffer='';
    }
  }
  if(buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function runMigrations() {
  const connection=await mysql.createConnection({host:process.env.DB_HOST||'localhost',user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',port:process.env.DB_PORT||3306,multipleStatements:false});
  const dbName=process.env.DB_NAME||'yatrio_db';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${dbName}\``);
  const dir=path.join(__dirname,'../../migrations');
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
    console.log(`Executing migration: ${file}`);
    for(const statement of parseSql(fs.readFileSync(path.join(dir,file),'utf8'))){
      try { await connection.query(statement); }
      catch(err){
        if(['ER_DUP_KEYNAME','ER_DUP_FIELDNAME'].includes(err.code)) continue;
        if(err.code==='ER_TRG_ALREADY_EXISTS') continue;
        throw new Error(`${file}: ${err.message}`);
      }
    }
  }
  await connection.end(); console.log('All migrations completed successfully.');
}
if(require.main===module) runMigrations().catch(e=>{console.error('Migration failed:',e);process.exit(1)});
module.exports=runMigrations;
