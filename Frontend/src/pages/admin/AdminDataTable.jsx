import React, { useEffect, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { apiClient } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';

const configs={
 users:{title:'User management',endpoint:'/admin/users',columns:[['name','Name'],['email','Email'],['phone','Phone'],['role','Role'],['status','Status'],['createdAt','Created']]},
 bookings:{title:'Booking management',endpoint:'/admin/bookings',columns:[['pnr','PNR'],['passenger','Passenger'],['trainNumber','Train'],['origin','From'],['destination','To'],['journeyDate','Journey date'],['amount','Fare'],['status','Status']]},
 payments:{title:'Payment management',endpoint:'/admin/payments',columns:[['transactionId','Transaction'],['pnr','PNR'],['amount','Amount'],['method','Method'],['status','Status'],['paidAt','Paid at']]},
 cancellations:{title:'Cancellation management',endpoint:'/admin/cancellations',columns:[['pnr','PNR'],['reason','Reason'],['refundAmount','Refund'],['status','Status'],['cancelledAt','Cancelled at']]},
 audit:{title:'Audit logs',endpoint:'/admin/audit-logs',columns:[['createdAt','Timestamp'],['actor','Actor'],['action','Action'],['module','Module'],['recordId','Record'],['status','Status']]}
};

export default function AdminDataTable({type}){
 const c=configs[type]; const [rows,setRows]=useState([]); const [meta,setMeta]=useState({page:1,totalPages:1}); const [search,setSearch]=useState(''); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 const load=async(page=1)=>{setLoading(true);setError('');try{const r=await apiClient.get(c.endpoint,{page,pageSize:15,search});setRows(r.data||[]);setMeta(r); }catch(e){setError(e.message||'Unable to load data.');}finally{setLoading(false)}};
 useEffect(()=>{const t=setTimeout(()=>load(1),250);return()=>clearTimeout(t)},[search]);
 return <div className="space-y-6">
  <div><span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">Operations control centre</span><h1 className="text-h2 font-bold text-ink mt-1">{c.title}</h1><p className="text-caption text-ink-soft">Server-side search, filtering and pagination.</p></div>
  <Card><CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="text-h4">Records</CardTitle><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-soft"/><Input aria-label="Search records" className="pl-9 w-full sm:w-80" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search records"/></div><Button variant="secondary" size="sm" onClick={()=>load(meta.page)} aria-label="Refresh"><RefreshCw className="size-4"/></Button></div></CardHeader>
   <CardContent className="p-0">{loading?<div className="p-8 text-center text-ink-soft">Loading records…</div>:error?<div className="p-8 text-center text-error-strong">{error}</div>:rows.length===0?<div className="p-8 text-center text-ink-soft">No records match the current search.</div>:<div className="overflow-x-auto"><Table><TableHeader><TableRow>{c.columns.map(([k,label])=><TableHead key={k}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((r,i)=><TableRow key={r.id||r.pnr||r.transactionId||i}>{c.columns.map(([k])=><TableCell key={k} className={['amount','refundAmount'].includes(k)?'num font-semibold':''}>{k==='status'?<Badge variant={['SUCCESS','CONFIRMED','active','PROCESSED'].includes(r[k])?'success':(['FAILED','CANCELLED','inactive','REJECTED'].includes(r[k])?'error':'outline')}>{r[k]}</Badge>:k==='amount'||k==='refundAmount'?`₹${Number(r[k]||0).toLocaleString('en-IN')}`:String(r[k]??'—')}</TableCell>)}</TableRow>)}</TableBody></Table></div>}</CardContent>
   <div className="p-4 border-t border-line flex justify-end"><Pagination currentPage={meta.page||1} totalPages={meta.totalPages||1} onPageChange={load}/></div>
  </Card>
 </div>
}
