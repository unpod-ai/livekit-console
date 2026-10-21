import { useRef, useState } from 'react';
const COLORS=['var(--chart-cyan)','var(--chart-purple)','var(--chart-green)','var(--chart-amber)','var(--chart-red)','var(--chart-orange)'];
type Row={agentName:string;t:number;count:number;p50:number|null;p95:number|null};
export function PerformanceChart({rows,from,to,bucketMs,bucket,onBucket,onRange}:{rows:Row[];from:number;to:number;bucketMs:number;bucket:number|null;onBucket:(t:number)=>void;onRange:(from:number,to:number)=>void}) {
 const start=useRef<number|null>(null),[drag,setDrag]=useState<[number,number]|null>(null);
 const agents=[...new Set(rows.map(r=>r.agentName))];
 const max=Math.max(1,...rows.map(r=>r.p95??0)),width=1000,left=65,right=980,top=14,bottom=215;
 const x=(t:number)=>left+(t-from)/(to-from)*(right-left),y=(v:number)=>bottom-v/max*(bottom-top);
 const point=(e:React.PointerEvent<SVGSVGElement>)=>{const box=e.currentTarget.getBoundingClientRect();return Math.max(left,Math.min(right,(e.clientX-box.left)/box.width*width));};
 const time=(px:number)=>Math.round(from+(px-left)/(right-left)*(to-from));
 return <div style={{padding:14}}>
  <p className="muted">p95 latency in milliseconds · Click a bucket for its exact contributors. Drag a window to apply it to this entire page.</p>
  {!rows.length?<p>No measured samples in this range.</p>:<>
   <div className="legend">{agents.map((agent,i)=><span key={agent}><i style={{background:COLORS[i%COLORS.length]}}/>{agent}</span>)}</div>
   <svg viewBox="0 0 1000 255" role="img" aria-label="Measured latency chart; drag to select time range" style={{width:'100%',minHeight:150,touchAction:'none',userSelect:'none'}}
    onPointerDown={e=>{if(e.button!==0)return;start.current=point(e);setDrag([start.current,start.current]);e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(start.current!==null)setDrag([start.current,point(e)]);}}
    onPointerCancel={()=>{start.current=null;setDrag(null);}}
    onPointerUp={e=>{if(start.current===null)return;const first=start.current,last=point(e);start.current=null;setDrag(null);if(Math.abs(last-first)>=8){const a=time(Math.min(first,last)),b=time(Math.max(first,last));if(b-a>=1000)onRange(a,b);}else onBucket(Math.floor(Math.min(to-1,time(last))/bucketMs)*bucketMs);}}>
    {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={left} x2={right} y1={y(max*f)} y2={y(max*f)} stroke="var(--border)"/><text x={left-8} y={y(max*f)+4} textAnchor="end" fill="var(--muted)" fontSize={12}>{(max*f).toFixed(1)}</text></g>)}
    {bucket!==null&&<rect x={Math.max(left,x(bucket))} y={top} width={Math.max(0,Math.min(right,x(bucket+bucketMs))-Math.max(left,x(bucket)))} height={bottom-top} fill="var(--accent)" opacity={.12}/>}
    {agents.map((agent,i)=>{const list=rows.filter(r=>r.agentName===agent);return <g key={agent}><path d={list.map((r,n)=>`${n&&r.t-list[n-1].t<=bucketMs?'L':'M'}${x((Math.max(from,r.t)+Math.min(to,r.t+bucketMs))/2)},${y(r.p95??0)}`).join(' ')} fill="none" stroke={COLORS[i%COLORS.length]} strokeWidth={2}/>{list.map(r=><circle key={r.t} cx={x((Math.max(from,r.t)+Math.min(to,r.t+bucketMs))/2)} cy={y(r.p95??0)} r={5} fill={COLORS[i%COLORS.length]} tabIndex={0} role="button" aria-label={`Inspect ${agent} bucket ${r.t}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onBucket(r.t);}}}><title>{agent}: p95 {r.p95?.toFixed(2)} ms · {r.count} samples · {new Date(r.t).toLocaleString()}</title></circle>)}</g>;})}
    {drag&&<rect x={Math.min(...drag)} y={top} width={Math.abs(drag[1]-drag[0])} height={bottom-top} fill="var(--accent)" opacity={.2}/>}
    {[from,from+(to-from)/2,to].map((t,i)=><text key={t} x={x(t)} y={245} textAnchor={i===0?'start':i===2?'end':'middle'} fill="var(--muted)" fontSize={12}>{new Date(t).toLocaleString()}</text>)}
   </svg>
  </>}
 </div>;
}
