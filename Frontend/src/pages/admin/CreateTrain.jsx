import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { trainService } from '@/services/trainService';
import { stationService } from '@/services/stationService';

const dayOptions = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

const CreateTrain = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [stations, setStations] = useState([]);
  const [loadingStations, setLoadingStations] = useState(true);
  const [form, setForm] = useState({ trainNumber:'', trainName:'', trainType:'Express', status:'active', sourceStation:'', destinationStation:'', departureTime:'', arrivalTime:'', distanceKm:'', runningDays:[...dayOptions], classes:[{classCode:'SL',className:'Sleeper (SL)',coaches:2,seatsPerCoach:72,baseFare:0}] });
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const set = (key, value) => setForm(f => ({...f,[key]:value}));
  useEffect(() => {
    let mounted = true;
    stationService.getAllStations().then(result => {
      const rows = Array.isArray(result) ? result : (result?.stations || result?.data || []);
      if (mounted) setStations(rows);
    }).catch(err => { if (mounted) setError(err.message || 'Unable to load stations.'); })
      .finally(() => { if (mounted) setLoadingStations(false); });
    return () => { mounted = false; };
  }, []);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (isEdit) { setError('Editing existing trains will be enabled after the create/deactivate flow is verified.'); return; }
    if (form.sourceStation === form.destinationStation) { setError('Source and destination stations must be different.'); return; }
    try {
      setSaving(true);
      await trainService.createAdmin(form);
      navigate('/admin/trains');
    } catch (err) { setError(err.message || 'Unable to save train.'); }
    finally { setSaving(false); }
  };
  const toggleDay = day => set('runningDays', form.runningDays.includes(day) ? form.runningDays.filter(d=>d!==day) : [...form.runningDays,day]);
  const updateClass = (index,key,value) => set('classes', form.classes.map((c,i)=>i===index?{...c,[key]:value}:c));
  return <div className="p-6 max-w-5xl mx-auto space-y-6">
    <div className="flex items-center gap-4"><Button variant="ghost" size="icon" onClick={()=>navigate(-1)}><ArrowLeft className="h-5 w-5"/></Button><h1 className="text-2xl font-bold text-foreground">{isEdit?'Edit Train':'Add New Train'}</h1></div>
    {error && <div className="border border-error rounded-md p-3 text-sm text-error">{error}</div>}
    <form onSubmit={submit} className="space-y-6">
      <Card><CardHeader><CardTitle>Basic Information</CardTitle></CardHeader><CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2"><label className="text-sm font-medium">Train Number</label><Input value={form.trainNumber} onChange={e=>set('trainNumber',e.target.value)} placeholder="e.g., 12951" required/></div>
        <div className="space-y-2"><label className="text-sm font-medium">Train Name</label><Input value={form.trainName} onChange={e=>set('trainName',e.target.value)} placeholder="e.g., Rajdhani Express" required/></div>
        <div className="space-y-2"><label className="text-sm font-medium">Train Type</label><Select value={form.trainType} onChange={e=>set('trainType',e.target.value)}><option value="Rajdhani">Rajdhani</option><option value="Shatabdi">Shatabdi</option><option value="Superfast">Superfast</option><option value="Express">Express</option><option value="Passenger">Passenger</option></Select></div>
        <div className="space-y-2"><label className="text-sm font-medium">Status</label><Select value={form.status} onChange={e=>set('status',e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Route Information</CardTitle></CardHeader><CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2"><label className="text-sm font-medium">Source Station</label><Select disabled={loadingStations} value={form.sourceStation} onChange={e=>set('sourceStation',e.target.value)} required><option value="">Select Station</option>{stations.map(st=><option key={st.id || st.code || st.station_code} value={st.code || st.station_code}>{st.name || st.station_name} ({st.code || st.station_code})</option>)}</Select></div>
        <div className="space-y-2"><label className="text-sm font-medium">Destination Station</label><Select disabled={loadingStations} value={form.destinationStation} onChange={e=>set('destinationStation',e.target.value)} required><option value="">Select Station</option>{stations.map(st=><option key={st.id || st.code || st.station_code} value={st.code || st.station_code}>{st.name || st.station_name} ({st.code || st.station_code})</option>)}</Select></div>
        <div className="space-y-2"><label className="text-sm font-medium">Departure Time</label><Input type="time" value={form.departureTime} onChange={e=>set('departureTime',e.target.value)} required/></div>
        <div className="space-y-2"><label className="text-sm font-medium">Arrival Time</label><Input type="time" value={form.arrivalTime} onChange={e=>set('arrivalTime',e.target.value)} required/></div>
        <div className="space-y-2"><label className="text-sm font-medium">Distance (km)</label><Input type="number" min="0" value={form.distanceKm} onChange={e=>set('distanceKm',e.target.value)} required/></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Running Days</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-3">{dayOptions.map(day=><label key={day} className="flex items-center space-x-2 border p-3 rounded-lg cursor-pointer"><input type="checkbox" checked={form.runningDays.includes(day)} onChange={()=>toggleDay(day)}/><span className="text-sm font-medium">{day}</span></label>)}</div></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Classes & Coaches</CardTitle><Button type="button" variant="outline" size="sm" onClick={()=>set('classes',[...form.classes,{classCode:'3A',className:'Third AC (3A)',coaches:1,seatsPerCoach:64,baseFare:0}])}><Plus className="h-4 w-4 mr-2"/>Add Class</Button></CardHeader><CardContent className="space-y-4">{form.classes.map((c,i)=><div key={i} className="flex flex-wrap items-end gap-4 p-4 border rounded-lg"><div className="space-y-2 flex-1 min-w-[120px]"><label className="text-xs font-medium">Class Type</label><Select value={c.classCode} onChange={e=>updateClass(i,'classCode',e.target.value)}><option value="1A">First AC (1A)</option><option value="2A">Second AC (2A)</option><option value="3A">Third AC (3A)</option><option value="SL">Sleeper (SL)</option><option value="CC">Chair Car (CC)</option></Select></div><div className="space-y-2 flex-1 min-w-[100px]"><label className="text-xs font-medium">Coaches</label><Input type="number" min="1" value={c.coaches} onChange={e=>updateClass(i,'coaches',e.target.value)}/></div><div className="space-y-2 flex-1 min-w-[100px]"><label className="text-xs font-medium">Seats/Coach</label><Input type="number" min="1" value={c.seatsPerCoach} onChange={e=>updateClass(i,'seatsPerCoach',e.target.value)}/></div><Button type="button" variant="ghost" size="icon" disabled={form.classes.length===1} onClick={()=>set('classes',form.classes.filter((_,idx)=>idx!==i))}><Trash2 className="h-4 w-4"/></Button></div>)}</CardContent></Card>
      <div className="flex justify-end gap-4 pb-10"><Button type="button" variant="outline" onClick={()=>navigate('/admin/trains')}>Cancel</Button><Button type="submit" disabled={saving}>{saving?'Saving...':'Save Train'}</Button></div>
    </form>
  </div>;
};
export default CreateTrain;
