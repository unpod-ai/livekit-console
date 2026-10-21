// Recording bytes are served by explicit project-scoped authenticated routes, never upstream URL shortcuts.
export function safeProjectResponse<T>(value:T):T {
 if(Array.isArray(value))return value.map(item=>safeProjectResponse(item)) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['location','playlistLocation'].includes(key)&&typeof item==='string'?'':safeProjectResponse(item)])) as T;
 return value;
}
