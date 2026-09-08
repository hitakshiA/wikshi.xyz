export type MeetingTask={id:string;title:string;status:string};
export function meetingTasks(operations:any[]):MeetingTask[];
export function meetingStatusPrompt(meeting:MeetingTask):string;
