import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export type Project = { id: string; name: string; env: NodeJS.ProcessEnv; dbPath: string; port: number; secret: string };
export type ProjectSetup = { projects: Project[]; controlDbPath: string; port: number; host: string };
const shared = ['PATH', 'HOME', 'TZ', 'LANG', 'NODE_EXTRA_CA_CERTS'];
const canonical = (file: string) => {
 const absolute=path.resolve(file); mkdirSync(path.dirname(absolute),{recursive:true,mode:0o700});
 return existsSync(absolute)?realpathSync(absolute):path.join(realpathSync(path.dirname(absolute)),path.basename(absolute));
};
export function loadProjects(env: NodeJS.ProcessEnv): ProjectSetup {
 const port=Number(env.PORT??8080), start=Number(env.CONSOLE_BACKEND_PORT_BASE??port+1);
 if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(start)||start<1)throw new Error('Invalid console ports');
 const defaultDb=canonical(env.DB_PATH??'data/console.db');
 const controlDbPath=canonical(env.CONSOLE_CONTROL_DB_PATH??path.join(path.dirname(defaultDb),'control.db'));
 let definitions: {id:string;name:string;envFile?:string}[]=[{id:'default',name:env.CONSOLE_PROJECT_NAME??'Default project'}];
 if(env.CONSOLE_PROJECTS_FILE){
  const file=JSON.parse(readFileSync(env.CONSOLE_PROJECTS_FILE,'utf8'));
  if(!file||!Array.isArray(file.projects)||!file.projects.length||file.projects.length>20)throw new Error('Configure 1–20 projects');
  definitions=file.projects;
 }
 const ids=new Set<string>(), files=new Set([controlDbPath]);
 const projects=definitions.map((definition,index)=>{
  if(!definition||typeof definition.id!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(definition.id)||ids.has(definition.id)||typeof definition.name!=='string'||!definition.name.trim()||definition.name.length>100||/[\x00-\x1f]/.test(definition.name))throw new Error('Invalid or duplicate project');
  ids.add(definition.id);
  let childEnv:NodeJS.ProcessEnv;
  if(definition.id==='default'){
   if(definition.envFile!==undefined)throw new Error('Default project uses existing environment');
   childEnv={...env,DB_PATH:defaultDb};
  }else{
   if(typeof definition.envFile!=='string'||!definition.envFile)throw new Error('Additional project envFile is required');
   const source=path.resolve(path.dirname(env.CONSOLE_PROJECTS_FILE!),definition.envFile);
   const supplied=parseEnv(readFileSync(source,'utf8'));
   for(const key of ['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','DB_PATH'])if(!supplied[key])throw new Error('Additional project requires explicit '+key);
   if(!path.isAbsolute(supplied.DB_PATH!))throw new Error('Project database must be absolute');
   // Runtime transport settings only. Project/cloud/provider credentials never inherit.
   childEnv=Object.fromEntries(shared.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]));
   Object.assign(childEnv,supplied,{ADMIN_USER:'gateway',ADMIN_PASSWORD:randomBytes(32).toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex')});
  }
  const dbPath=canonical(childEnv.DB_PATH!);if(files.has(dbPath))throw new Error('Project database paths must be unique');files.add(dbPath);
  const childPort=start+index;if(childPort>65535||childPort===port)throw new Error('Conflicting backend port');
  const secret=randomBytes(32).toString('hex');
  Object.assign(childEnv,{DB_PATH:dbPath,HOST:'127.0.0.1',PORT:String(childPort),CONSOLE_PROJECT_CHILD:'1',CONSOLE_PROJECT_ID:definition.id,CONSOLE_GATEWAY_SECRET:secret});
  return {id:definition.id,name:definition.name,env:childEnv,dbPath,port:childPort,secret};
 });
 if(!ids.has('default'))throw new Error('Default project is required');
 return {projects,controlDbPath,port,host:env.HOST??'0.0.0.0'};
}
