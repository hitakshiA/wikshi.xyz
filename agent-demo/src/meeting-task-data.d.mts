export type MeetingTask={id:string;title:string;status:string;transcript:{role:string;text:string}[]};
export function meetingTasks(operations:any[]):MeetingTask[];
export function meetingStatusPrompt(meeting:MeetingTask):string;
