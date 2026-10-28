import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Trash2, Eye, Edit } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { trainService } from '@/services/trainService';

const TrainManagement = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [trainToDelete, setTrainToDelete] = useState(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        setError('');
        const data = await trainService.listAdmin({ page, pageSize: 20, search: searchTerm, type, status });
        setResult(data);
      } catch (e) {
        setError(e.message || 'Unable to load trains.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [page, searchTerm, type, status]);

  const confirmDelete = async () => {
    if (!trainToDelete) return;
    try {
      await trainService.deleteAdmin(trainToDelete.id);
      setDeleteModalOpen(false);
      setTrainToDelete(null);
      setPage(1);
      const data = await trainService.listAdmin({ page: 1, pageSize: 20, search: searchTerm, type, status });
      setResult(data);
    } catch (e) {
      setError(e.message || 'Unable to delete train.');
      setDeleteModalOpen(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">Train Management</h1>
        <Button onClick={() => navigate('/admin/trains/create')} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> Add Train
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          {error && <div className="border border-error rounded-md p-3 text-sm text-error">{error}</div>}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <Input placeholder="Search by Train Number or Name..." className="pl-9" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }} />
            </div>
            <div className="flex gap-4">
              <Select className="w-[150px]" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
                <option value="">All Types</option>
                <option value="Rajdhani">Rajdhani</option>
                <option value="Shatabdi">Shatabdi</option>
                <option value="Superfast">Superfast</option>
                <option value="Express">Express</option>
                <option value="Passenger">Passenger</option>
              </Select>
              <Select className="w-[150px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Number</TableHead><TableHead>Train Name</TableHead><TableHead>Type</TableHead>
                <TableHead>Route</TableHead><TableHead>Timings</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={7}>Loading trains...</TableCell></TableRow> :
                  result.data.length === 0 ? <TableRow><TableCell colSpan={7}>No trains found.</TableCell></TableRow> :
                  result.data.map((train) => (
                    <TableRow key={train.id}>
                      <TableCell className="font-semibold">{train.number}</TableCell>
                      <TableCell>{train.name}</TableCell><TableCell>{train.type}</TableCell>
                      <TableCell>{train.source || '-'} &rarr; {train.destination || '-'}</TableCell>
                      <TableCell>{train.dep || '--:--'} - {train.arr || '--:--'}</TableCell>
                      <TableCell><Badge variant={String(train.status).toUpperCase() === 'ACTIVE' ? 'success' : 'secondary'}>{String(train.status).toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-right"><div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/trains/${train.id}`)}><Eye className="h-4 w-4 text-muted" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/trains/${train.id}/edit`)}><Edit className="h-4 w-4 text-muted" /></Button>
                        <Button variant="ghost" size="icon" disabled={String(train.status).toLowerCase() === 'inactive'} onClick={() => { setTrainToDelete(train); setDeleteModalOpen(true); }}><Trash2 className="h-4 w-4 text-muted" /></Button>
                      </div></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex justify-end">
            <Pagination currentPage={result.page} totalPages={result.totalPages || 1} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Train">
        <div className="space-y-4">
          <p>Delete train <strong>{trainToDelete?.number}</strong>? Its route stops and train classes will also be removed. Bookings keep their record but no longer point to this train.</p>
          <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setDeleteModalOpen(false)}>Cancel</Button><Button variant="error" onClick={confirmDelete}>Delete</Button></div>
        </div>
      </Modal>
    </div>
  );
};
export default TrainManagement;
