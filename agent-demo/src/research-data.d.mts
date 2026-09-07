export type ResearchRow = Record<string,unknown>;
export type ResearchKind = {label:string;title:string;noun:string};
export function resultRows(value:unknown):ResearchRow[];
export function resultColumns(rows:unknown):string[];
export function displayValue(value:unknown):string;
export function resultKind(service:string):ResearchKind;
export function exportCsv(rows:unknown,columns?:string[]):string;
export function exportJson(rows:unknown):string;
