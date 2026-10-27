import React, { useEffect, useState } from 'react';
import { Search, Plus, Edit, Power } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { stationService } from '@/services/stationService';

const emptyForm = { stationCode:'', stationName:'', city:'', state:'', timezone:'Asia/Kolkata', status:'active' };

const StationManagement = () => {
  const [rows,setRows]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const [searchTerm,setSearchTerm]=useState(''); const [status,setStatus]=useState(''); const [page,setPage]=useState(1); const [meta,setMeta]=useState({totalPages:1});
  const [modalOpen,setModalOpen]=useState(false); const [editing,setEditing]=useState(null); const [form,setForm]=useState(emptyForm); const [saving,setSaving]=useState(false);
  const load=async()=>{ setLoading(true); setError(''); try { const r=await stationService.listAdmin({page,pageSize:10,search:searchTerm,status}); setRows(r?.data||[]); setMeta(r||{totalPages:1}); } catch(e){setError(e.message||'Unable to load stations.');} finally{setLoading(false);} };
  useEffect(()=>{load();},[page,status]);
  useEffect(()=>{const t=setTimeout(()=>{setPage(1);load();},250); return()=>clearTimeout(t);},[searchTerm]);
  const openCreate=()=>{setEditing(null);setForm(emptyForm);setModalOpen(true);};
  const openEdit=(st)=>{setEditing(st);setForm({stationCode:st.code,stationName:st.name,city:st.city,state:st.state,timezone:st.timezone||'Asia/Kolkata',status:st.status});setModalOpen(true);};
  const submit=async e=>{e.preventDefault();setSaving(true);setError('');try{if(editing) await stationService.updateAdmin(editing.id,form);else await stationService.createAdmin(form);setModalOpen(false);await load();}catch(err){setError(err.message||'Unable to save station.');}finally{setSaving(false);}};
  const deactivate=async id=>{if(!window.confirm('Deactivate this station?'))return;try{await stationService.deactivateAdmin(id);await load();}catch(e){setError(e.message||'Unable to deactivate station.');}};
  return <div className="p-6 max-w-7xl mx-auto space-y-6">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"><h1 className="text-2xl font-bold text-foreground">Station Management</h1><Button onClick={openCreate} className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4"/>Add Station</Button></div>
    {error&&<div className="border border-error rounded-md p-3 text-sm text-error">{error}</div>}
    <Card><CardContent className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"/><Input placeholder="Search by Code, Name or City..." className="pl-9" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/></div><Select className="w-[160px]" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
      <div className="border rounded-md overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Station Name</TableHead><TableHead>City</TableHead><TableHead>State</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{loading?<TableRow><TableCell colSpan={6}>Loading stations...</TableCell></TableRow>:rows.length===0?<TableRow><TableCell colSpan={6}>No stations found.</TableCell></TableRow>:rows.map(st=><TableRow key={st.id}><TableCell className="font-semibold">{st.code}</TableCell><TableCell>{st.name}</TableCell><TableCell>{st.city}</TableCell><TableCell>{st.state}</TableCell><TableCell><Badge variant={st.status==='active'?'success':'secondary'}>{String(st.status).toUpperCase()}</Badge></TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant="ghost" size="icon" onClick={()=>openEdit(st)}><Edit className="h-4 w-4"/></Button>{st.status==='active'&&<Button variant="ghost" size="icon" onClick={()=>deactivate(st.id)}><Power className="h-4 w-4"/></Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>
      <div className="mt-4 flex justify-end"><Pagination currentPage={page} totalPages={meta.totalPages||1} onPageChange={setPage}/></div>
    </CardContent></Card>
    <Modal isOpen={modalOpen} onClose={()=>setModalOpen(false)} title={editing?'Edit Station':'Add Station'}><form className="space-y-4" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-sm font-medium">Station Code</label><Input value={form.stationCode} onChange={e=>setForm({...form,stationCode:e.target.value.toUpperCase()})} placeholder="e.g. NDLS" required disabled={!!editing}/></div><div className="space-y-2"><label className="text-sm font-medium">Status</label><Select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option></Select></div></div>
      <div className="space-y-2"><label className="text-sm font-medium">Station Name</label><Input value={form.stationName} onChange={e=>setForm({...form,stationName:e.target.value})} required/></div>
      <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-sm font-medium">City</label><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} required/></div><div className="space-y-2"><label className="text-sm font-medium">State</label><Input value={form.state} onChange={e=>setForm({...form,state:e.target.value})} required/></div></div>
      <div className="space-y-2"><label className="text-sm font-medium">Timezone</label><Input value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value})} required/></div>
      <div className="flex justify-end gap-3 pt-4 border-t mt-6"><Button type="button" variant="outline" onClick={()=>setModalOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving?'Saving...':'Save Station'}</Button></div>
    </form></Modal>
  </div>;
};
export default StationManagement;
