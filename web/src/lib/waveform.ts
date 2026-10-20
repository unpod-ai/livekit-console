/** Linear peak amplitude per bin, computed from decoded samples across every channel. */
export function waveformPeaks(channels: Float32Array[], bins=600): number[] {
  const length=channels[0]?.length??0;if(!length)return [];
  const count=Math.min(bins,length);
  return Array.from({length:count},(_,i)=>{let peak=0;const start=Math.floor(i*length/count),end=Math.floor((i+1)*length/count);for(const channel of channels)for(let n=start;n<end;n++)peak=Math.max(peak,Math.abs(channel[n]??0));return Math.min(1,peak);});
}
export function recordingOffset(at: number, start: number | null, duration: number | null): number | null {
  if(start==null||duration==null||!Number.isFinite(at))return null;
  const seconds=(at-start)/1000;return seconds>=0&&seconds<=duration?seconds:null;
}
