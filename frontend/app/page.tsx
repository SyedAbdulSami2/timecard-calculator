'use client'
import {useMemo,useRef,useState} from 'react'

type Row={date:string;day:string;clock_in:string;clock_out:string;break_minutes:number;regular_hours:number;overtime_hours:number;holiday_hours:number;on_call_hours:number;call_back_hours:number;total_hours:number;warning?:string}
const emptyRow=():Row=>({date:'',day:'',clock_in:'',clock_out:'',break_minutes:0,regular_hours:0,overtime_hours:0,holiday_hours:0,on_call_hours:0,call_back_hours:0,total_hours:0})
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000'
async function runBrowserOcr(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop()

  // JPG / JPEG / PNG
  if (['jpg', 'jpeg', 'png'].includes(ext || '')) {
    const Tesseract = await import('tesseract.js')
    const result = await Tesseract.recognize(file, 'eng')
    return result.data.text || ''
  }

  // PDF
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist')

    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjs.getDocument({ data }).promise

    let allText = ''

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)

      // First try embedded PDF text
      const content = await page.getTextContent()
      const embeddedText = content.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim()

      if (embeddedText.length > 40) {
        allText += '\n' + embeddedText
        continue
      }

      // Scanned PDF: render page and OCR it
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      if (!ctx) continue

      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({
        canvasContext: ctx,
        viewport
      }).promise

      const Tesseract = await import('tesseract.js')
      const result = await Tesseract.recognize(canvas, 'eng')

      allText += '\n' + (result.data.text || '')
    }

    return allText.trim()
  }

  return ''
}
export default function Home(){
 const [employee,setEmployee]=useState('');const[weekStart,setWeekStart]=useState('');const[weekEnd,setWeekEnd]=useState('');const[rows,setRows]=useState<Row[]>([emptyRow()]);
 const[otMode,setOtMode]=useState('none'); const[dailyThreshold,setDailyThreshold]=useState(8); const[weeklyThreshold,setWeeklyThreshold]=useState(40); const[message,setMessage]=useState(''); const[summary,setSummary]=useState<any>(null); const fileRef=useRef<HTMLInputElement>(null)
 const update=(i:number,k:keyof Row,v:any)=>setRows(x=>x.map((r,n)=>n===i?{...r,[k]:v}:r));
 const payload=useMemo(()=>({timecard:{employee_name:employee,week_start:weekStart,week_end:weekEnd,rows},overtime:{mode:otMode,daily_threshold:dailyThreshold,weekly_threshold:weeklyThreshold,custom_threshold:weeklyThreshold},holiday_in_regular:false,on_call_in_regular:false,call_back_in_regular:false}),[employee,weekStart,weekEnd,rows,otMode,dailyThreshold,weeklyThreshold])
 async function upload(file?:File){if(!file)return; setMessage('Reading timecard…'); const f=new FormData();f.append('file',file);try{const r=await fetch(`${API}/extract`,{method:'POST',body:f});const d=await r.json(); if(!r.ok)throw new Error(d.detail||'Upload failed'); setEmployee(d.employee_name||'');setWeekStart(d.week_start||'');setWeekEnd(d.week_end||'');setRows(d.rows?.length?d.rows:[emptyRow()]);setMessage(d.warnings?.[0]||'Extraction complete. Review all fields before calculating.')}catch(e:any){setMessage(e.message||'Could not read file')}}
 async function calculate(){setMessage('');const r=await fetch(`${API}/calculate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();setRows(d.rows||rows);setSummary(d.summary)}
 async function downloadCsv(){const r=await fetch(`${API}/export/csv`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const b=await r.blob();const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='timecard-summary.csv';a.click();URL.revokeObjectURL(u)}
 return <main className="wrap">
  <nav className="nav"><div className="brand">TimeCard Calculator</div><div>Privacy-first • No account required</div></nav>
  <section className="hero"><h1>TimeCard Calculator</h1><p>Upload your timecard and automatically calculate your daily and weekly hours.</p><div className="actions"><button className="btn primary" onClick={()=>fileRef.current?.click()}>Upload Timecard</button><button className="btn secondary" onClick={()=>document.getElementById('review')?.scrollIntoView({behavior:'smooth'})}>Enter Time Manually</button><input ref={fileRef} hidden type="file" accept=".pdf,.xlsx,.csv,.jpg,.jpeg,.png" onChange={e=>upload(e.target.files?.[0])}/></div></section>
  <section className="steps"><div className="step"><b>1. Upload</b><p>PDF, Excel, CSV, JPG, JPEG or PNG.</p></div><div className="step"><b>2. Review</b><p>Confirm extracted values. We never guess uncertain data.</p></div><div className="step"><b>3. Calculate</b><p>Normal, overnight and break-deducted shifts.</p></div><div className="step"><b>4. Export</b><p>Download, print or copy your summary.</p></div></section>
  <section className="card" id="review"><h2>Timecard review</h2>{message&&<div className="notice">{message}</div>}<div className="grid2"><div className="field"><label>Employee Name</label><input value={employee} onChange={e=>setEmployee(e.target.value)}/></div><div></div><div className="field"><label>Week Start</label><input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)}/></div><div className="field"><label>Week End</label><input type="date" value={weekEnd} onChange={e=>setWeekEnd(e.target.value)}/></div></div>
   <h3>Overtime settings</h3><div className="grid2"><div className="field"><label>Rule</label><select value={otMode} onChange={e=>setOtMode(e.target.value)}><option value="none">No overtime</option><option value="daily">After daily threshold</option><option value="weekly">After weekly threshold</option><option value="custom">Custom weekly threshold</option></select></div><div className="field"><label>{otMode==='daily'?'Daily threshold':'Weekly/custom threshold'}</label><input type="number" step="0.25" value={otMode==='daily'?dailyThreshold:weeklyThreshold} onChange={e=>otMode==='daily'?setDailyThreshold(+e.target.value):setWeeklyThreshold(+e.target.value)}/></div></div>
   <p style={{color:'#64748b',fontSize:13}}>Overtime rules vary by employer, facility, contract and jurisdiction. Choose the rule that applies to you.</p>
   <div className="tableWrap"><table><thead><tr>{['Date','Day','Clock In','Clock Out','Break','Regular','OT','Holiday','On-Call','Call-Back','Total',''].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>
    <td><input value={r.date} onChange={e=>update(i,'date',e.target.value)}/></td><td><input value={r.day} onChange={e=>update(i,'day',e.target.value)}/></td><td><input value={r.clock_in} onChange={e=>update(i,'clock_in',e.target.value)} placeholder="7:00 AM"/></td><td><input value={r.clock_out} onChange={e=>update(i,'clock_out',e.target.value)} placeholder="7:30 PM"/></td><td><input type="number" value={r.break_minutes} onChange={e=>update(i,'break_minutes',+e.target.value)}/></td><td><input type="number" step="0.25" value={r.regular_hours} onChange={e=>update(i,'regular_hours',+e.target.value)}/></td><td><input type="number" step="0.25" value={r.overtime_hours} onChange={e=>update(i,'overtime_hours',+e.target.value)}/></td><td><input type="number" step="0.25" value={r.holiday_hours} onChange={e=>update(i,'holiday_hours',+e.target.value)}/></td><td><input type="number" step="0.25" value={r.on_call_hours} onChange={e=>update(i,'on_call_hours',+e.target.value)}/></td><td><input type="number" step="0.25" value={r.call_back_hours} onChange={e=>update(i,'call_back_hours',+e.target.value)}/></td><td>{r.total_hours?.toFixed?.(2)||'0.00'}</td><td><button className="btn secondary" onClick={()=>setRows(x=>x.filter((_,n)=>n!==i))}>Delete</button></td>
   </tr>)}</tbody></table></div>
   <div className="actions"><button className="btn secondary" onClick={()=>setRows(x=>[...x,emptyRow()])}>+ Add Row</button><button className="btn primary" onClick={calculate}>Calculate Hours</button><button className="btn secondary" onClick={()=>{setRows([emptyRow()]);setSummary(null);setEmployee('');setWeekStart('');setWeekEnd('')}}>Reset</button></div>
  </section>
  {summary&&<section className="card"><h2>Weekly summary</h2><p><b>{employee||'Employee'}</b> {weekStart||weekEnd?`• ${weekStart} – ${weekEnd}`:''}</p><div className="summary">{[['Regular',summary.regular_hours],['Overtime',summary.overtime_hours],['Holiday',summary.holiday_hours],['On-Call',summary.on_call_hours],['Call-Back',summary.call_back_hours],['TOTAL',summary.total_hours]].map(([k,v])=><div className="metric" key={String(k)}><span>{k}</span><strong>{Number(v).toFixed(2)}</strong></div>)}</div><div className="actions"><button className="btn primary" onClick={downloadCsv}>Download CSV</button><button className="btn secondary" onClick={()=>window.print()}>Print</button><button className="btn secondary" onClick={()=>navigator.clipboard.writeText(`Employee: ${employee}\nWeek: ${weekStart} - ${weekEnd}\nTotal Hours: ${summary.total_hours.toFixed(2)}`)}>Copy Summary</button></div></section>}
  <section className="card"><h2>Privacy & trust</h2><p>No account is required for the MVP. Uploaded documents should be processed temporarily and deleted after processing. The application is designed to flag uncertain data for manual review instead of inventing values.</p></section>
  <footer className="footer">TimeCard Calculator MVP • Add a reviewed Privacy Policy and Terms of Use before public launch.</footer>
 </main>
}
