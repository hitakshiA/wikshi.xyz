export function readEvents(body:ReadableStream<Uint8Array>|null,onEvent:(event:any)=>void):Promise<void>;
export function updateToolRun<T extends {id:string;name:string;status:string}>(runs:T[],event:any):T[];
export function appendAssistantText(text:string,event:{type:string;text?:string}):string;
