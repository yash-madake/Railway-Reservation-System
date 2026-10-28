import React, { useState } from 'react';
import { Search, Eye, MoreVertical, Shield, UserX, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Dropdown } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Avatar } from '@/components/ui/Avatar';
const UserManagement = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    // Mock data
    const users = [
        { id: '1', name: 'John Doe', email: 'john@example.com', phone: '+91 9876543210', role: 'ADMIN', status: 'ACTIVE', joined: '2025-01-15' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com', phone: '+91 9876543211', role: 'PASSENGER', status: 'ACTIVE', joined: '2025-03-22' },
        { id: '3', name: 'Raj Kumar', email: 'raj@example.com', phone: '+91 9876543212', role: 'STAFF', status: 'ACTIVE', joined: '2025-06-10' },
        { id: '4', name: 'Pooja Singh', email: 'pooja@example.com', phone: '+91 9876543213', role: 'PASSENGER', status: 'INACTIVE', joined: '2025-11-05' },
        { id: '5', name: 'Ravi Verma', email: 'ravi@example.com', phone: '+91 9876543214', role: 'PASSENGER', status: 'ACTIVE', joined: '2026-02-18' },
    ];
    const handleView = (user) => {
        setSelectedUser(user);
        setModalOpen(true);
    };
    const getRoleBadge = (role) => {
        switch (role) {
            case 'ADMIN': return <Badge className="bg-primary hover:bg-primary/90 text-white">Admin</Badge>;
            case 'STAFF': return <Badge className="bg-success hover:bg-success/90 text-white">Staff</Badge>;
            default: return <Badge variant="secondary">Passenger</Badge>;
        }
    };
    return (<div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <Button>Add User</Button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"/>
              <Input placeholder="Search by Name, Email or Phone..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
            </div>
            <div className="flex gap-4">
              <Select className="w-[150px]">
                <option value="">All Roles</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
                <option value="passenger">Passenger</option>
              </Select>
              <Select className="w-[150px]">
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Contact Info</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (<TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar fallback={user.name.substring(0, 2)}/>
                        <span className="font-medium">{user.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{user.email}</div>
                        <div className="text-muted">{user.phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      <Badge variant={user.status === 'ACTIVE' ? 'success' : 'default'} className={user.status === 'INACTIVE' ? 'bg-gray-200 text-gray-700' : ''}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.joined}</TableCell>
                    <TableCell className="text-right">
                      <Dropdown trigger={<Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button>} items={[
                { label: 'View Profile', icon: <Eye className="h-4 w-4"/>, onClick: () => handleView(user) },
                { label: 'Edit Role', icon: <Shield className="h-4 w-4"/>, onClick: () => { } },
                {
                    label: user.status === 'ACTIVE' ? 'Deactivate' : 'Activate',
                    icon: user.status === 'ACTIVE' ? <UserX className="h-4 w-4"/> : <UserCheck className="h-4 w-4"/>,
                    onClick: () => { },
                    className: user.status === 'ACTIVE' ? 'text-error' : 'text-success'
                },
            ]}/>
                    </TableCell>
                  </TableRow>))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex justify-end">
            <Pagination currentPage={1} totalPages={8} onPageChange={() => { }}/>
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="User Profile">
        {selectedUser && (<div className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar fallback={selectedUser.name.substring(0, 2)} className="h-16 w-16 text-lg"/>
              <div>
                <h2 className="text-xl font-bold">{selectedUser.name}</h2>
                <div className="flex gap-2 mt-1">
                  {getRoleBadge(selectedUser.role)}
                  <Badge variant={selectedUser.status === 'ACTIVE' ? 'success' : 'default'} className={selectedUser.status === 'INACTIVE' ? 'bg-gray-200 text-gray-700' : ''}>
                    {selectedUser.status}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted">Email</p>
                <p className="font-medium">{selectedUser.email}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Phone</p>
                <p className="font-medium">{selectedUser.phone}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Joined Date</p>
                <p className="font-medium">{selectedUser.joined}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Total Bookings</p>
                <p className="font-medium">12</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => setModalOpen(false)}>Close</Button>
            </div>
          </div>)}
      </Modal>
    </div>);
};
export default UserManagement;
