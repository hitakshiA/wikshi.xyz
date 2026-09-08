export const RESEARCH_TIMEOUT_MS:number;
export function researchDeadline(op:any,startedAt?:number):number;
export function researchTimeLeft(milliseconds:number):string;
export type ResearchPollingState={phase:'polling'|'cancelling'|'stopped';reason:'user'|'timeout'|null;remainingMs:number;error:string};
export function startResearchPolling(options:{operation:any;read:(signal:AbortSignal)=>Promise<any>;cancel:(reason:string,signal:AbortSignal)=>Promise<any>;onUpdate:(operation:any)=>void;onState:(state:ResearchPollingState)=>void;now?:()=>number;setTimer?:any;clearTimer?:any}):{cancel:(reason?:'user'|'timeout')=>void;observe:(operation:any)=>void;wake:()=>void;dispose:()=>void};
