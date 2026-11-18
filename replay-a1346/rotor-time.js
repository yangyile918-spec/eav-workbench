// Illustrative rotor speed integrated over recorded time, including pause and rewind.
const speed=rpm=>Number.isFinite(rpm)?Math.min(28,Math.abs(rpm)*Math.PI/30):0;
export function rotorPhases(data,segment){
 const lo=segment.start_index,hi=segment.end_index,gaps=new Set(segment.gaps_after);
 return Array.from({length:4},(_,motor)=>{const phases=new Float64Array(hi-lo+1),rpms=data.series['Fc_esc_rpm_'+motor]||[];for(let i=lo+1;i<=hi;i++)phases[i-lo]=phases[i-lo-1]+(gaps.has(i-1)?0:speed(rpms[i-1])*(data.series.time[i]-data.series.time[i-1])/1000);return phases;});
}
export function rotorPhase(phases,data,segment,frame,motor){const i=frame.index,elapsed=frame.gap?0:Math.max(0,(frame.raw-data.series.time[i])/1000);return (phases[motor][i-segment.start_index]+speed(data.series['Fc_esc_rpm_'+motor]?.[i])*elapsed)%(2*Math.PI);}
