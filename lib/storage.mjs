import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import path from 'node:path';

export async function writable(directory){
  const probe=path.join(directory,'.write-check-'+randomUUID());
  let file;
  try{file=await open(probe,'wx',0o600);await file.writeFile('ok');await file.sync();}
  finally{if(file)await file.close();await unlink(probe).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function durableWrite(file,bytes){
  const temporary=file+'.'+randomUUID()+'.tmp';
  let handle,published=false;
  try{
    handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    await rename(temporary,file);published=true;
    // Persist the directory entry as well as the file before acknowledging it.
    let directory;
    try{directory=await open(path.dirname(file),'r');await directory.sync();}
    catch(error){if(!['EINVAL','ENOTSUP','EISDIR','EPERM'].includes(error.code))throw error;}
    finally{await directory?.close();}
  }catch(error){if(published)error.committed=true;throw error;}
  finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function storage(dataDir,{lockProcess=true}={}){
  await mkdir(dataDir,{recursive:true});
  await mkdir(path.join(dataDir,'uploads'),{recursive:true});
  await writable(dataDir);await writable(path.join(dataDir,'uploads'));
  // Production uses a single instance on an exclusively mounted persistent
  // disk. PID files cannot identify processes across replacement containers.
  if(!lockProcess)return {async health(){await writable(dataDir);await writable(path.join(dataDir,'uploads'));},async close(){}};
  const lock=path.join(dataDir,'.library.lock');
  const identity={pid:process.pid,host:hostname(),token:randomUUID()};
  for(let attempt=0;attempt<2;attempt++){
    try{
      const handle=await open(lock,'wx',0o600);
      try{await handle.writeFile(JSON.stringify(identity));await handle.sync();}finally{await handle.close();}
      break;
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      let old;try{old=JSON.parse(await readFile(lock,'utf8'));}catch{throw new Error('资料目录已锁定，请确认没有其他实例正在运行。');}
      let stale=false;
      if(old.host===identity.host&&Number.isSafeInteger(old.pid)&&old.pid>0){
        try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH')stale=true;}
      }
      if(!stale||attempt)throw new Error('资料目录已由其他实例使用，请保持单实例运行。');
      await unlink(lock);
    }
  }
  return {
    async health(){await writable(dataDir);await writable(path.join(dataDir,'uploads'));},
    async close(){
      let owner;try{owner=JSON.parse(await readFile(lock,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
      if(owner.token===identity.token)await unlink(lock);
    },
  };
}
