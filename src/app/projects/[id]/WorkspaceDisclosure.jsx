'use client';
import LocalizedElement from '@/app/components/i18n/LocalizedElement';
import './WorkspacePolish.css';
// Native disclosure: controls stay mounted and retain their values and handlers.
export default function WorkspaceDisclosure({title,children,className='',open=false}){
 return <details className={`workspace-disclosure ${className}`} open={open||undefined}>
  <summary><LocalizedElement as="span">{title}</LocalizedElement><span aria-hidden="true" className="workspace-disclosure-chevron">⌄</span></summary>
  <div className="workspace-disclosure-content">{children}</div>
 </details>;
}
