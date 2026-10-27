import React, { useState } from 'react';
import { Download, TrendingUp, Ticket, Users, Map } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Input } from '@/components/ui/Input';
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const Reports = () => {
    const [activeTab, setActiveTab] = useState('revenue');
    // Mock data
    const revenueData = [
        { name: '01 Oct', value: 1800000 },
        { name: '02 Oct', value: 2100000 },
        { name: '03 Oct', value: 1950000 },
        { name: '04 Oct', value: 2400000 },
        { name: '05 Oct', value: 2800000 },
        { name: '06 Oct', value: 2600000 },
        { name: '07 Oct', value: 1845600 },
    ];
    const bookingClassData = [
        { name: '3A', value: 4500 },
        { name: 'SL', value: 8500 },
        { name: '2A', value: 2100 },
        { name: '1A', value: 800 },
        { name: 'CC', value: 1200 },
    ];
    const routeData = [
        { name: 'NDLS - MMCT', bookings: 1250 },
        { name: 'HWH - CSMT', bookings: 980 },
        { name: 'SBC - MAS', bookings: 850 },
        { name: 'PNBE - NDLS', bookings: 780 },
        { name: 'ADI - BCT', bookings: 650 },
    ];
    return (<div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">Reports & Analytics</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 mr-4">
            <Input type="date" className="w-[140px]" defaultValue="2026-10-01"/>
            <span className="text-muted">to</span>
            <Input type="date" className="w-[140px]" defaultValue="2026-10-07"/>
          </div>
          <Button variant="outline"><Download className="mr-2 h-4 w-4"/> Export CSV</Button>
          <Button variant="outline"><Download className="mr-2 h-4 w-4"/> Export PDF</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full sm:w-[600px] grid-cols-4">
          <TabsTrigger value="revenue"><TrendingUp className="mr-2 h-4 w-4"/> Revenue</TabsTrigger>
          <TabsTrigger value="bookings"><Ticket className="mr-2 h-4 w-4"/> Bookings</TabsTrigger>
          <TabsTrigger value="occupancy"><Users className="mr-2 h-4 w-4"/> Occupancy</TabsTrigger>
          <TabsTrigger value="routes"><Map className="mr-2 h-4 w-4"/> Routes</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="revenue" className="space-y-6 mt-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard title="Total Revenue" value="₹1.55 Cr" subtext="Last 7 days"/>
              <StatCard title="Average Daily" value="₹22.14 L" subtext="Last 7 days"/>
              <StatCard title="Highest Day (05 Oct)" value="₹28.00 L" subtext="Saturday"/>
              <StatCard title="Lowest Day (01 Oct)" value="₹18.00 L" subtext="Tuesday"/>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Daily Revenue Trend</CardTitle>
              </CardHeader>
              <CardContent className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData} margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280' }}/>
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280' }} tickFormatter={(val) => `₹${val / 100000}L`}/>
                    <Tooltip formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Revenue']}/>
                    <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }}/>
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bookings" className="space-y-6 mt-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard title="Total Bookings" value="17,100" subtext="Last 7 days"/>
              <StatCard title="Confirmed" value="14,250" subtext="83.3%"/>
              <StatCard title="Cancelled" value="1,250" subtext="7.3%"/>
              <StatCard title="Cancellation Rate" value="7.3%" subtext="Target < 10%"/>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Bookings by Class</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={bookingClassData} cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={2} dataKey="value">
                        {bookingClassData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]}/>)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Daily Bookings Trend</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueData} margin={{ top: 20, right: 30, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280' }}/>
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280' }}/>
                      <Tooltip />
                      <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="occupancy" className="mt-0">
            {/* Similar structure for Occupancy */}
            <Card>
              <CardHeader><CardTitle>Occupancy Metrics</CardTitle></CardHeader>
              <CardContent className="h-96 flex items-center justify-center">
                <p className="text-muted text-lg">Occupancy charts will render here</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="routes" className="mt-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Popular Routes</CardTitle>
              </CardHeader>
              <CardContent className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={routeData} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false}/>
                    <XAxis type="number"/>
                    <YAxis dataKey="name" type="category"/>
                    <Tooltip />
                    <Bar dataKey="bookings" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={32}/>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>);
};
const StatCard = ({ title, value, subtext }) => (<Card>
    <CardContent className="p-6">
      <p className="text-sm font-medium text-muted mb-2">{title}</p>
      <h3 className="text-2xl font-bold">{value}</h3>
      <p className="text-xs text-muted mt-2">{subtext}</p>
    </CardContent>
  </Card>);
export default Reports;
