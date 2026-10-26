import React,{useState} from 'react';
import type {Operation} from './cards';
import {meetingTasks,meetingStatusPrompt} from './meeting-task-data.mjs';
import './meeting-tasks.css';

export function MeetingTasks({operations,disabled,onCheck}:{operations:Operation[];disabled:boolean;onCheck:(prompt:string)=>Promise<boolean>}){
  const [checking,setChecking]=useState('');
  const meetings=meetingTasks(operations);
  if(!meetings.length)return null;
  return <section className="workspace-meetings" aria-label="Video meetings"><h3>Video meetings</h3>
    <ul>{meetings.map(meeting=><li key={meeting.id}>
      <strong title={meeting.title}>{meeting.title}</strong>
      <span>{meeting.status}</span>
      {meeting.transcript.length>0&&<details className="meeting-task-transcript"><summary>Read transcript</summary>{meeting.transcript.map((row,i)=><p key={i}><strong>{row.role}</strong><br/>{row.text}</p>)}</details>}
      <button type="button" disabled={disabled||!!checking} aria-label={`Check Status: ${meeting.title}`} onClick={async()=>{
        setChecking(meeting.id);
        try{await onCheck(meetingStatusPrompt(meeting));}finally{setChecking('');}
      }}>{checking===meeting.id?'Checking…':'Check Status'}</button>
    </li>)}</ul>
  </section>;
}
