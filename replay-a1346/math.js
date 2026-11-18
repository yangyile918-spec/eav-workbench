export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
export function sampleAt(times,target,lo,hi){
 let a=lo,b=hi;while(a<b){const m=Math.ceil((a+b)/2);if(times[m]<=target)a=m;else b=m-1;}return a;
}
export function frameAt(data,segment,time){
 const times=data.series.time,lo=segment.start_index,hi=segment.end_index;
 const raw=times[lo]+clamp(time,0,segment.duration_s)*1000;
 const index=sampleAt(times,raw,lo,hi),next=Math.min(hi,index+1);
 const delta=times[next]-times[index],gap=segment.gaps_after.includes(index);
 const alpha=delta>0&&!gap?clamp((raw-times[index])/delta,0,1):0;
 return {index,next,alpha,gap:gap&&raw>times[index]&&raw<times[next],raw,target:time};
}
export function formatTime(seconds){
 const ms=Math.max(0,Math.round(seconds*1000));return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
export function worldPosition(n,e,d,originN=0,originE=0){return [e-originE,-d,-(n-originN)];}
export function interpolate(a,b,alpha){return finite(a)&&finite(b)?a+(b-a)*alpha:null;}
export function rcNormalized(raw,center=1494,range=450){return finite(raw)&&range>0?clamp((raw-center)/range,-1,1):null;}
