import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function AdminLogin() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user?.role !== 'admin') {
        logout();
        throw new Error('This login is only for administrators.');
      }
      const from = location.state?.from?.pathname || '/admin';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Admin login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md shadow-raised">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto size-14 rounded-2xl bg-navy text-white flex items-center justify-center">
            <ShieldCheck className="size-7" />
          </div>
          <div>
            <CardTitle className="text-2xl">Administrator Login</CardTitle>
            <p className="text-sm text-ink-soft mt-1">Yatrio railway operations console</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {error && <div className="rounded-control border border-error-strong/30 bg-error/10 p-3 text-sm text-error-strong">{error}</div>}
            <div className="space-y-2">
              <label className="text-sm font-medium">Admin email</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@yatrio.in" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <Button type="submit" disabled={loading} className="w-full">{loading ? 'Authorizing...' : 'Login as Admin'}</Button>
            <p className="text-xs text-center text-ink-soft">Only users with the <strong>admin</strong> role can enter this console.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
