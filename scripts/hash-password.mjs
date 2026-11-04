import {emitKeypressEvents} from 'node:readline';
import {hashPassword} from '../lib/password.mjs';

if(!process.stdin.isTTY||!process.stdout.isTTY){
  console.error('请在交互式终端运行此脚本；不接受命令参数、环境变量或管道中的明文密码。');
  process.exitCode=1;
}else if(process.argv.length>2){
  console.error('请勿在命令参数中提供密码。');process.exitCode=1;
}else{
  emitKeypressEvents(process.stdin);process.stdin.setEncoding('utf8');
  async function hidden(prompt){
    process.stderr.write(prompt);const previous=process.stdin.isRaw;process.stdin.setRawMode(true);process.stdin.resume();
    let value='';
    try{return await new Promise((resolve,reject)=>{
      function keypress(text,key={}){
        if(key.ctrl&&key.name==='c'){finish();reject(new Error('已取消。'));}
        else if(key.name==='return'||key.name==='enter'){finish();resolve(value);}
        else if(key.name==='backspace'){value=[...value].slice(0,-1).join('');}
        else if(text&&!key.ctrl&&!key.meta&&!/[\u0000-\u001f\u007f]/.test(text)){
          value+=text;
        }
      }
      function finish(){process.stdin.off('keypress',keypress);process.stderr.write('\n');}
      process.stdin.on('keypress',keypress);
    });}finally{process.stdin.setRawMode(previous);process.stdin.pause();}
  }
  let first='',second='';
  try{
    first=await hidden('设置密码（至少 12 个字符，输入不显示）：');
    second=await hidden('再次输入密码：');
    if(first!==second)throw new Error('两次密码不一致。');
    const encoded=await hashPassword(first);
    process.stderr.write('将以下哈希设置为 OWNER_PASSWORD_HASH；请勿提交到源码仓库。\n');
    process.stdout.write(encoded+'\n');
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{first='';second='';}
}
