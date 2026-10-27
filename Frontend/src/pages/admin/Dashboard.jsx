import React,{useEffect,useState} from 'react';
import {LineChart,Line,BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from 'recharts';
import {RefreshCw} from 'lucide-react';
import {apiClient} from '@/api/client';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/Card';
import {Button} from '@/components/ui/Button';
import {Badge} from '@/components/ui/Badge';
import {StatTile} from '@/components/ui/StatTile';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/Table';

export default function Dashboard(){
 const [d,setD]=useState(null),[error,setError]=useState('');
 const load=()=>apiClient.get('/admin/dashboard').then(setD).catch(e=>setError(e.message||'Unable to load dashboard.'));
 useEffect(()=>{load()},[]);
 if(error)return <div className="space-y-4"><h1 className="text-h2 font-bold text-ink">Operations dashboard</h1><Card><CardContent className="p-8 text-error-strong">{error}</CardContent></Card></div>;
 if(!d)return <div className="text-ink-soft">Loading dashboard…</div>;
 const s=d.stats||{};
 return <div className="space-y-6">
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"><div><span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">Railway operations control centre</span><h1 className="text-h2 font-bold text-ink mt-1">Operations dashboard</h1><p className="text-caption text-ink-soft">Live reporting from the Team 7 administration layer.</p></div><Button variant="secondary" onClick={load}><RefreshCw className="size-4 mr-2"/>Refresh</Button></div>
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"><StatTile label="Users" value={s.users??0}/><StatTile label="Active trains" value={s.active_trains??0}/><StatTile label="Today's bookings" value={s.today_bookings??0}/><StatTile label="Today's revenue" value={`₹${Number(s.today_revenue||0).toLocaleString('en-IN')}`}/><StatTile label="Cancellations" value={s.today_cancellations??0}/><StatTile label="API errors / 24h" value={s.api_errors_24h??0}/></div>
  <div className="grid lg:grid-cols-2 gap-6"><Card><CardHeader><CardTitle>Revenue — last 7 days</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer><LineChart data={d.revenue||[]}><CartesianGrid vertical={false}/><XAxis dataKey="date"/><YAxis/><Tooltip/><Line type="monotone" dataKey="revenue" stroke="#014CA9" strokeWidth={3}/></LineChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><CardTitle>Popular corridors</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer><BarChart data={d.routes||[]}><CartesianGrid vertical={false}/><XAxis dataKey="origin"/><YAxis/><Tooltip/><Bar dataKey="bookings" fill="#0080F8"/></BarChart></ResponsiveContainer></CardContent></Card></div>
  <Card><CardHeader><CardTitle>Recent bookings</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PNR</TableHead><TableHead>Passenger</TableHead><TableHead>Train</TableHead><TableHead>Journey</TableHead><TableHead>Fare</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{(d.recent||[]).map(b=><TableRow key={b.pnr}><TableCell className="num font-semibold text-royal">{b.pnr}</TableCell><TableCell>{b.passenger_name||'—'}</TableCell><TableCell>{b.train_number||'—'}</TableCell><TableCell className="num">{b.journey_date}</TableCell><TableCell className="num">₹{Number(b.amount||0).toLocaleString('en-IN')}</TableCell><TableCell><Badge variant={b.status==='CONFIRMED'?'success':b.status==='CANCELLED'?'error':'warning'}>{b.status}</Badge></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
 </div>
}
