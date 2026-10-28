import React, { useState } from 'react';
import { Search, Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { Modal } from '@/components/ui/Modal';
const AuditLogs = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedLog, setSelectedLog] = useState(null);
    // Mock data
    const logs = [
        { id: 'AL-1023', timestamp: '2026-10-15 14:30:22', user: 'admin@railconnect.com', action: 'UPDATED', module: 'Trains', recordId: '12951', ip: '192.168.1.105', status: 'SUCCESS' },
        { id: 'AL-1024', timestamp: '2026-10-15 15:10:05', user: 'staff@railconnect.com', action: 'CREATED', module: 'Schedules', recordId: 'SCH-8992', ip: '10.0.0.45', status: 'SUCCESS' },
        { id: 'AL-1025', timestamp: '2026-10-15 16:45:11', user: 'admin@railconnect.com', action: 'DELETED', module: 'Fares', recordId: 'FR-221', ip: '192.168.1.105', status: 'SUCCESS' },
        { id: 'AL-1026', timestamp: '2026-10-16 09:12:33', user: 'system', action: 'CANCELLED', module: 'Bookings', recordId: 'PNR-2435678904', ip: 'localhost', status: 'SUCCESS' },
        { id: 'AL-1027', timestamp: '2026-10-16 10:05:19', user: 'admin@railconnect.com', action: 'UPDATED', module: 'Users', recordId: 'USR-773', ip: '192.168.1.112', status: 'FAILED' },
    ];
    const getActionBadge = (action) => {
        switch (action) {
            case 'CREATED': return <Badge className="bg-success text-white">Created</Badge>;
            case 'UPDATED': return <Badge className="bg-primary text-white">Updated</Badge>;
            case 'DELETED': return <Badge className="bg-error text-white">Deleted</Badge>;
            case 'CANCELLED': return <Badge className="bg-warning text-white">Cancelled</Badge>;
            default: return <Badge variant="secondary">{action}</Badge>;
        }
    };
    const handleRowClick = (log) => {
        setSelectedLog(log);
        setModalOpen(true);
    };
    return (<div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <Button variant="outline"><Download className="mr-2 h-4 w-4"/> Export Logs</Button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"/>
              <Input placeholder="Search by User, Record ID or IP..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
            </div>
            <Select>
              <option value="">All Modules</option>
              <option value="trains">Trains</option>
              <option value="bookings">Bookings</option>
              <option value="users">Users</option>
            </Select>
            <Select>
              <option value="">All Actions</option>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
              <option value="deleted">Deleted</option>
            </Select>
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Record ID</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (<TableRow key={log.id} className="cursor-pointer hover:bg-gray-50" onClick={() => handleRowClick(log)}>
                    <TableCell className="whitespace-nowrap text-xs font-medium text-muted">{log.timestamp}</TableCell>
                    <TableCell className="font-medium text-sm">{log.user}</TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>{log.module}</TableCell>
                    <TableCell className="font-mono text-xs">{log.recordId}</TableCell>
                    <TableCell>
                      <Badge variant={log.status === 'SUCCESS' ? 'success' : 'error'}>{log.status}</Badge>
                    </TableCell>
                  </TableRow>))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex justify-end">
            <Pagination currentPage={1} totalPages={25} onPageChange={() => { }}/>
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Audit Log Details" className="max-w-2xl">
        {selectedLog && (<div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 bg-gray-50 p-4 rounded-lg">
              <div>
                <p className="text-xs text-muted font-semibold uppercase">Log ID</p>
                <p className="font-mono text-sm">{selectedLog.id}</p>
              </div>
              <div>
                <p className="text-xs text-muted font-semibold uppercase">Timestamp</p>
                <p className="text-sm">{selectedLog.timestamp}</p>
              </div>
              <div>
                <p className="text-xs text-muted font-semibold uppercase">Status</p>
                <Badge variant={selectedLog.status === 'SUCCESS' ? 'success' : 'error'} className="mt-1">{selectedLog.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted font-semibold uppercase">User</p>
                <p className="text-sm">{selectedLog.user}</p>
              </div>
              <div>
                <p className="text-xs text-muted font-semibold uppercase">IP Address</p>
                <p className="font-mono text-sm">{selectedLog.ip}</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm border-b pb-2">Action Details</h4>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <p className="text-xs text-muted">Action</p>
                  <p className="font-medium">{selectedLog.action}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Module & Record</p>
                  <p className="font-medium">{selectedLog.module} / {selectedLog.recordId}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm border-b pb-2">Payload Details</h4>
              <div className="bg-gray-900 rounded p-4 overflow-auto max-h-48">
                <pre className="text-xs text-green-400 font-mono">
                  {JSON.stringify({
                "old_values": { "status": "ACTIVE", "seats": 120 },
                "new_values": { "status": "INACTIVE", "seats": 120 }
            }, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={() => setModalOpen(false)}>Close</Button>
            </div>
          </div>)}
      </Modal>
    </div>);
};
export default AuditLogs;
