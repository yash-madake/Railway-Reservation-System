import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Clock, Users } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { stationService } from '@/services/stationService';
import { trainService } from '@/services/trainService';

export default function TrainDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [train, setTrain] = useState(null);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [routeModal, setRouteModal] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [routeForm, setRouteForm] = useState({ stationCode: '', stopSequence: '', arrivalTime: '', departureTime: '', distanceKm: '', dayOffset: 1, haltMinutes: 0, platform: '1' });

  const load = async () => {
    try { setLoading(true); setError(''); setTrain(await trainService.getAdmin(id)); }
    catch (e) { setError(e.message || 'Unable to load train.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); stationService.getAllStations().then(r => setStations(Array.isArray(r) ? r : r?.data || r?.stations || [])).catch(() => {}); }, [id]);

  const addStop = async (e) => {
    e.preventDefault(); setSavingRoute(true); setError('');
    try { await trainService.addRouteStop(id, routeForm); setRouteModal(false); setRouteForm({ stationCode:'',stopSequence:'',arrivalTime:'',departureTime:'',distanceKm:'',dayOffset:1,haltMinutes:0,platform:'1' }); await load(); }
    catch (e) { setError(e.message || 'Unable to add route stop.'); }
    finally { setSavingRoute(false); }
  };

  const removeStop = async (routeId) => {
    if (!window.confirm('Delete this route stop?')) return;
    try { await trainService.deleteRouteStop(id, routeId); await load(); }
    catch (e) { setError(e.message || 'Unable to delete route stop.'); }
  };

  if (loading) return <div className="text-ink-soft">Loading train…</div>;
  if (!train) return <Card><CardContent className="p-8 text-error-strong">{error || 'Train not found.'}</CardContent></Card>;
  const routes = train.routes || [];
  const totalSeats = (train.classes || []).reduce((sum, c) => sum + Number(c.totalSeats || 0), 0);

  return <div className="max-w-7xl mx-auto space-y-6">
    <div className="flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
      <div className="flex items-center gap-3 min-w-0"><Button variant="ghost" size="icon" onClick={() => navigate('/admin/trains')}><ArrowLeft className="size-5" /></Button><div className="min-w-0"><h1 className="text-2xl font-bold text-ink truncate">{train.trainNumber} — {train.trainName}</h1><p className="text-sm text-ink-soft">{train.trainType}</p></div></div>
      <Button onClick={() => setRouteModal(true)}><Plus className="size-4 mr-2" /> Add Route Stop</Button>
    </div>
    {error && <div className="border border-error-strong/30 bg-error/10 rounded-control p-3 text-sm text-error-strong">{error}</div>}

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card><CardContent className="p-4"><div className="text-xs text-ink-soft">Status</div><Badge className="mt-2" variant={train.status === 'active' ? 'success' : 'secondary'}>{String(train.status).toUpperCase()}</Badge></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-ink-soft">Route stops</div><div className="text-2xl font-bold mt-1">{routes.length}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-ink-soft">Total capacity</div><div className="text-2xl font-bold mt-1">{totalSeats.toLocaleString('en-IN')}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-ink-soft">Running days</div><div className="text-sm font-semibold mt-2">{(train.runningDays || []).join(', ') || '—'}</div></CardContent></Card>
    </div>

    <Card><CardHeader><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><CardTitle>Route & Schedule</CardTitle><span className="text-sm text-ink-soft">{routes.length} stops</span></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-surface-sunken"><th className="text-left p-3">#</th><th className="text-left p-3">Station</th><th className="text-left p-3">Arrival</th><th className="text-left p-3">Departure</th><th className="text-left p-3">Distance</th><th className="text-right p-3">Action</th></tr></thead><tbody>{routes.map(r => <tr key={r.id} className="border-b last:border-0"><td className="p-3 font-semibold">{r.stopSequence}</td><td className="p-3"><div className="font-semibold">{r.stationName}</div><div className="text-xs text-ink-soft">{r.stationCode} · {r.city}</div></td><td className="p-3">{r.arrivalTime || '—'}</td><td className="p-3">{r.departureTime || '—'}</td><td className="p-3">{Number(r.distanceKm || 0).toLocaleString('en-IN')} km</td><td className="p-3 text-right"><Button variant="ghost" size="icon" onClick={() => removeStop(r.id)} disabled={routes.length <= 2}><Trash2 className="size-4 text-error-strong" /></Button></td></tr>)}</tbody></table></div></CardContent></Card>

    <div className="grid lg:grid-cols-2 gap-6"><Card><CardHeader><CardTitle>Classes & Capacity</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2">Class</th><th className="text-left py-2">Name</th><th className="text-right py-2">Seats</th></tr></thead><tbody>{(train.classes || []).map(c => <tr key={c.id} className="border-b last:border-0"><td className="py-2 font-bold">{c.classCode}</td><td className="py-2">{c.className}</td><td className="py-2 text-right">{c.totalSeats}</td></tr>)}</tbody></table></CardContent></Card><Card><CardHeader><CardTitle>Operational Info</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex gap-3"><Clock className="size-4 mt-0.5 text-royal" /><span>Pantry: <strong>{train.pantryAvailable ? 'Available' : 'Not available'}</strong></span></div><div className="flex gap-3"><Users className="size-4 mt-0.5 text-royal" /><span>Capacity: <strong>{totalSeats.toLocaleString('en-IN')} seats</strong></span></div></CardContent></Card></div>

    <Modal isOpen={routeModal} onClose={() => setRouteModal(false)} title="Add Route Stop"><form onSubmit={addStop} className="space-y-4"><div className="grid sm:grid-cols-2 gap-4"><div><label className="text-sm font-medium">Station</label><select className="mt-1 w-full rounded-control border border-line-mid p-2.5 bg-white" value={routeForm.stationCode} onChange={e=>setRouteForm({...routeForm,stationCode:e.target.value})} required><option value="">Select station</option>{stations.map(s=><option key={s.id||s.code} value={s.code}>{s.name} ({s.code})</option>)}</select></div><div><label className="text-sm font-medium">Stop sequence</label><Input type="number" min="1" value={routeForm.stopSequence} onChange={e=>setRouteForm({...routeForm,stopSequence:e.target.value})} required/></div><div><label className="text-sm font-medium">Arrival</label><Input type="time" value={routeForm.arrivalTime} onChange={e=>setRouteForm({...routeForm,arrivalTime:e.target.value})}/></div><div><label className="text-sm font-medium">Departure</label><Input type="time" value={routeForm.departureTime} onChange={e=>setRouteForm({...routeForm,departureTime:e.target.value})}/></div><div><label className="text-sm font-medium">Distance (km)</label><Input type="number" min="0" value={routeForm.distanceKm} onChange={e=>setRouteForm({...routeForm,distanceKm:e.target.value})}/></div><div><label className="text-sm font-medium">Platform</label><Input value={routeForm.platform} onChange={e=>setRouteForm({...routeForm,platform:e.target.value})}/></div></div><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={()=>setRouteModal(false)}>Cancel</Button><Button type="submit" disabled={savingRoute}>{savingRoute?'Adding…':'Add Stop'}</Button></div></form></Modal>
  </div>;
}
