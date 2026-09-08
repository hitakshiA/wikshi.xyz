export function isResearch(service:string):boolean;
export function shouldPoll(op:any):boolean;
export function readyToSummarize(op:any):boolean;
export function hasStarted(op:any):boolean;
export function mergeOperation(previous:any,incoming:any):any;
export function continuationPrompt(ids:string[]):string;
