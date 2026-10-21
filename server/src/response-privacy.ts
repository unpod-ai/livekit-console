// Recording bytes are served by explicit authenticated routes, never upstream URL shortcuts.
export function safeResponse<T>(value:T):T {
 if(Array.isArray(value))return value.map(item=>safeResponse(item)) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['location','playlistLocation'].includes(key)&&typeof item==='string'?'':safeResponse(item)])) as T;
 return value;
}
