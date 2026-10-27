import React, { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
const BookingManagement = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all');
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedBooking, setSelectedBooking] = useState(null);
    // Mock data
    const bookings = [
        { pnr: '2435678901', passenger: 'Rahul Sharma + 2', train: '12951', date: '2026-10-15', route: 'NDLS → MMCT', class: '3A', fare: 4500, status: 'CONFIRMED' },
        { pnr: '2435678902', passenger: 'Priya Patel', train: '12009', date: '2026-10-16', route: 'BCT → ADI', class: 'CC', fare: 850, status: 'WAITLISTED' },
        { pnr: '2435678903', passenger: 'Amit Kumar', train: '12229', date: '2026-10-15', route: 'LJN → NDLS', class: '2A', fare: 1200, status: 'CONFIRMED' },
        { pnr: '2435678904', passenger: 'Sneha Gupta', train: '12627', date: '2026-10-17', route: 'SBC → NDLS', class: '1A', fare: 6500, status: 'CANCELLED' },
        { pnr: '2435678905', passenger: 'Vikram Singh + 1', train: '12925', date: '2026-10-18', route: 'BDTS → ASR', class: 'SL', fare: 1300, status: 'RAC' },
    ];
    const handleView = (booking) => {
        setSelectedBooking(booking);
        setModalOpen(true);
    };
    const getStatusVariant = (status) => {
        switch (status) {
            case 'CONFIRMED': return 'success';
            case 'CANCELLED': return 'error';
            case 'WAITLISTED': return 'warning';
            case 'RAC': return 'secondary';
            default: return 'default';
        }
    };
    const filteredBookings = activeTab === 'all'
        ? bookings
        : bookings.filter(b => b.status.toLowerCase() === activeTab.toLowerCase());
    return (<div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">Booking Management</h1>
        <Button variant="outline"><Filter className="mr-2 h-4 w-4"/> Advanced Filter</Button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"/>
            <Input placeholder="Search by PNR, Passenger Name or Train Number..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">All Bookings</TabsTrigger>
              <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
              <TabsTrigger value="rac">RAC</TabsTrigger>
              <TabsTrigger value="waitlisted">Waiting</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PNR</TableHead>
                  <TableHead>Passenger</TableHead>
                  <TableHead>Train</TableHead>
                  <TableHead>Journey Date</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Fare</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.map((booking) => (<TableRow key={booking.pnr}>
                    <TableCell className="font-semibold">{booking.pnr}</TableCell>
                    <TableCell>{booking.passenger}</TableCell>
                    <TableCell>{booking.train}</TableCell>
                    <TableCell>{booking.date}</TableCell>
                    <TableCell>{booking.route}</TableCell>
                    <TableCell>{booking.class}</TableCell>
                    <TableCell className="text-right">₹{booking.fare}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(booking.status)}>
                        {booking.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleView(booking)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex justify-end">
            <Pagination currentPage={1} totalPages={10} onPageChange={() => { }}/>
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Booking Details" className="max-w-3xl">
        {selectedBooking && (<div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm text-muted">PNR</p>
                <p className="font-bold">{selectedBooking.pnr}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Train</p>
                <p className="font-bold">{selectedBooking.train}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Date</p>
                <p className="font-bold">{selectedBooking.date}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Status</p>
                <Badge variant={getStatusVariant(selectedBooking.status)}>{selectedBooking.status}</Badge>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold">Passenger Details</h3>
              <div className="border rounded-md p-4">
                <p>{selectedBooking.passenger}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => setModalOpen(false)}>Close</Button>
            </div>
          </div>)}
      </Modal>
    </div>);
};
export default BookingManagement;
