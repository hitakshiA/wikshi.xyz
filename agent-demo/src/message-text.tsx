import React,{memo} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Remote research and model output are text, never executable HTML or images.
export const MessageText=memo(function MessageText({text}:{text:string}){
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
    urlTransform={url=>/^(https?:\/\/|mailto:)/i.test(url)?url:''}
    components={{
      a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
      table:({children})=><div className="markdown-table" tabIndex={0} aria-label="Response table"><table>{children}</table></div>,
      h1:({children})=><h3>{children}</h3>,h2:({children})=><h3>{children}</h3>,
    }}>{text}</Markdown></div>;
});
