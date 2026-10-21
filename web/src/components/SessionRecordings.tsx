import { can, useMe } from '../lib/me';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { recordingOffset, waveformPeaks } from '../lib/waveform';
import { Alert, Badge, Panel } from './ui';
type File={id:string;egressId:string;index:number;name:string;source:string;state:string;mime:string|null;startMs:number|null;durationMs:number|null;size:number|null};
type Data={files:File[];agentRecording:string;accessDays:number};
const MAX_BYTES=16*1024*1024,MAX_SECONDS=300;
const clock=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
export function SessionRecordings({sid,compact=false}:{sid:string;compact?:boolean}) {
  const allowed = can(useMe().data, 'recordings');
  const [params,setParams]=useSearchParams();
  const result=useApi<Data>(['recordings',sid],`/recordings/sessions/${encodeURIComponent(sid)}`, { enabled: allowed });
  const requested=params.get('recording');
  const file=requested?result.data?.files.find(f=>f.id===requested):result.data?.files.find(f=>f.state==='ready')??result.data?.files[0];
  const media=useRef<HTMLVideoElement>(null);
  const [position,setPosition]=useState(0),[duration,setDuration]=useState<number|null>(null),[error,setError]=useState(''),[peaks,setPeaks]=useState<number[]>([]),[waveState,setWaveState]=useState('');
  const stream=file?`/api/recordings/${encodeURIComponent(file.egressId)}/${file.index}/stream`:'';
  const target=params.get('mediaAt'),at=target!==null?Number(target):null;
  const knownDuration=duration??(file?.durationMs!=null?file.durationMs/1000:null);
  const offset=at!==null&&file?recordingOffset(at,file.startMs,knownDuration):null;
  useEffect(()=>{setError('');setDuration(null);setPosition(0);setPeaks([]);},[file?.id]);
  useEffect(()=>{if(offset!==null&&media.current&&media.current.readyState>=1)media.current.currentTime=offset;},[offset,file?.id]);
  const waveDuration=file?.durationMs!=null?file.durationMs/1000:duration;
  useEffect(()=>{
    setPeaks([]);setWaveState('');
    if(!file||file.state!=='ready')return;
    if(!waveDuration)return;
    if(waveDuration>MAX_SECONDS||(file.size??0)>MAX_BYTES){setWaveState('Waveform unavailable for recordings over 5 minutes or 16 MiB. Playback and seeking remain available.');return;}
    const controller=new AbortController();let cancelled=false;
    setWaveState('Decoding waveform…');
    (async()=>{
      const response=await fetch(stream,{credentials:'same-origin',signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error((await response.json()).error??'Recording download failed');
      if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('Recording is too large for waveform decoding');
      const reader=response.body?.getReader();if(!reader)throw new Error('Waveform streaming is unavailable');
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('Recording is too large for waveform decoding');}chunks.push(value);}
      const bytes=new Uint8Array(size);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.byteLength;}
      const audio=await new OfflineAudioContext(1,1,8000).decodeAudioData(bytes.buffer);
      if(audio.duration>MAX_SECONDS)throw new Error('Decoded audio exceeds the waveform duration limit');
      const data=waveformPeaks(Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i)));
      if(!cancelled){setPeaks(data);setWaveState(data.length?'':'No decoded audio samples');}
    })().catch(e=>{if(!cancelled)setWaveState(e instanceof Error?`Waveform unavailable: ${e.message}`:'Waveform unavailable for this codec');});
    return()=>{cancelled=true;controller.abort();};
  },[file?.id,file?.state,waveDuration,stream]);
  function seek(seconds:number){if(!media.current||knownDuration==null)return;const value=Math.min(knownDuration,Math.max(0,seconds));media.current.currentTime=value;if(file?.startMs!=null)setParams(old=>{const next=new URLSearchParams(old);next.set('mediaAt',String(Math.round(file.startMs!+value*1000)));next.set('recording',file.id);return next;});}
  if(!allowed)return compact?null:<Alert>Recording access is required for playback.</Alert>;
  if(result.error)return <Alert kind="bad">{(result.error as Error).message}</Alert>;
  if(!result.data)return <Alert>Loading recordings…</Alert>;
  if(compact&&!file&&!requested)return null;
  return <div className={compact?'insights-recording':undefined}><Panel title={compact?undefined:"Session recording"}>
    <div style={{padding:14,minWidth:0}}>
      {!file?<><p className="muted">{requested?'The requested recording is not available in this session.':'No Egress file is recorded for this session. Agent-side recordings are not collected.'}</p>{requested&&<button className="btn secondary sm" onClick={()=>setParams(old=>{const next=new URLSearchParams(old);next.delete('recording');next.delete('mediaAt');return next;})}>Choose an available source</button>}</>:<>
        {compact&&result.data.files.length===1?<div className="insights-recording-name" title={file.name}><Badge>Egress media</Badge><span>{file.name}</span></div>:<label>Recording source <select className="select" aria-label="Recording source" value={file.id} onChange={e=>setParams(old=>{const next=new URLSearchParams(old);next.set('recording',e.target.value);next.delete('mediaAt');return next;})}>{result.data.files.map(f=><option value={f.id} key={f.id}>Egress · {f.name} · {f.state}</option>)}</select></label>}
        {!compact&&<div className="badges" style={{margin:'10px 0'}}><Badge>Egress media</Badge><span className="muted">Agent-side media: not collected · Console access window: {result.data.accessDays} days</span></div>}
        {file.state!=='ready'?<Alert kind="warn">Recording {file.state}. {file.state==='unconfigured'?'An administrator must configure trusted storage access.':file.state==='expired'?'The console access window has expired.':file.state==='unsupported'?'This source cannot be streamed safely by the configured integration.':file.state==='unavailable'?'The access window cannot be verified because source timestamps were not reported.':'The file is missing from the stored Egress results.'}</Alert>:<>
          <video ref={media} key={file.id} controls preload="metadata" src={stream} aria-label="Session recording playback" style={{width:'100%',maxHeight:file.mime?.startsWith('audio/')?64:420,background:'var(--surface-2)'}}
            onLoadedMetadata={()=>{const d=media.current?.duration;if(d!=null&&Number.isFinite(d)){setDuration(d);const value=at!==null?recordingOffset(at,file.startMs,d):null;if(value!==null)media.current!.currentTime=value;}}}
            onTimeUpdate={()=>setPosition(media.current?.currentTime??0)} onError={()=>{setError('Recording could not be loaded.');fetch(stream,{method:'HEAD',credentials:'same-origin'}).then(r=>{if(!r.ok)setError(r.status===404?'Recording file is missing.':r.status===410?'Recording access has expired.':r.status===401||r.status===403?'Recording access is no longer available.':'Recording storage is unavailable or this codec is unsupported.');}).catch(()=>{});}} />
          {error&&<Alert kind="bad">{error}</Alert>}
          {peaks.length>0?<svg viewBox={`0 0 ${peaks.length} 64`} style={{width:'100%',height:72,cursor:'pointer',background:'var(--surface-2)'}} role="slider" aria-label="Recording waveform seek" aria-valuemin={0} aria-valuemax={knownDuration??0} aria-valuenow={Math.min(knownDuration??0,position)} tabIndex={0}
            onClick={e=>{const box=e.currentTarget.getBoundingClientRect();seek((e.clientX-box.left)/box.width*(knownDuration??0));}}
            onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();seek(e.key==='Home'?0:e.key==='End'?knownDuration??0:position+(e.key==='ArrowRight'?5:-5));}}}>
            {peaks.map((v,i)=><line key={i} x1={i} x2={i} y1={32-v*30} y2={32+v*30} stroke={i/peaks.length<=position/(knownDuration||1)?'var(--accent)':'var(--muted)'} />)}
          </svg>:<p className="muted">{waveState||'Waveform waits for recording duration metadata.'}</p>}
          {!compact&&<div className="mono muted">{clock(position)} / {knownDuration==null?'Unknown duration':clock(knownDuration)}</div>}
          {at!==null&&offset===null&&<Alert kind="warn">The selected timestamp cannot be aligned with this recording. {file.startMs==null?'Its media start time was not reported.':'Select a source covering that timestamp.'}</Alert>}
          <details className="insights-help"><summary>Recording alignment</summary><p>Seeking uses the Egress file's reported start time. Agent-side recordings are not collected. Console access window: {result.data.accessDays} days.</p></details>
        </>}
      </>}
    </div>
  </Panel></div>;
}
