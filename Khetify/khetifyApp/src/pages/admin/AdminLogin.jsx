import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { adminLogin, saveAdminSession, isAdminAuthed } from '../../lib/adminApi';

// Platform admin login. Issues a super_admin JWT (stored under "adminToken",
// separate from company/seller sessions) then lands on the admin dashboard.
const AdminLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/admin/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in → skip the form.
  if (isAdminAuthed()) return <Navigate to={from} replace />;

  const validate = () => {
    const e = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) e.email = 'Email is required';
    else if (!emailRegex.test(email.trim())) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async (ev) => {
    ev.preventDefault();
    setServerError('');
    if (!validate()) return;
    try {
      setLoading(true);
      const res = await adminLogin({ email: email.trim().toLowerCase(), password });
      saveAdminSession(res.token, res.admin);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(err.response?.data?.message || 'Login failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#f8f6f6] min-h-screen flex flex-col relative overflow-y-auto font-['Sora',sans-serif] antialiased">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-black/40 z-10" />
        <div
          className="w-full h-full bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=2400&q=80')",
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4 py-12">
        <div className="w-full max-w-[440px] bg-white rounded-xl shadow-lg p-8 sm:p-10 border border-gray-100">
          <div className="mb-6 text-center">
            <h1 className="text-[#ea2a33] text-4xl font-bold tracking-tight inline-flex items-center gap-2">
              Khettify
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-100 rounded-full px-2 py-0.5 align-middle">
                Admin
              </span>
            </h1>
          </div>

          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin sign in</h2>
            <p className="text-sm text-gray-500 font-medium">Review &amp; approve registered companies</p>
          </div>

          <form className="space-y-4" onSubmit={handleLogin}>
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Email<span className="text-[#EA2831] ml-0.5">*</span>
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                  errors.email ? 'border-red-500' : 'border-gray-300 focus:border-[#ea2a33]'
                }`}
                placeholder="admin@example.com"
                type="email"
                autoComplete="username"
              />
              {errors.email && <p className="text-red-500 text-xs font-medium mt-1">⚠ {errors.email}</p>}
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Password<span className="text-[#EA2831] ml-0.5">*</span>
              </label>
              <div className="relative">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`block w-full h-12 px-4 py-3 pr-11 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                    errors.password ? 'border-red-500' : 'border-gray-300 focus:border-[#ea2a33]'
                  }`}
                  placeholder="••••••••"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400"
                  onClick={() => setShowPassword((s) => !s)}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs font-medium mt-1">⚠ {errors.password}</p>}
            </div>

            <div className="pt-2">
              <button
                className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>

        {serverError && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] bg-[#333] text-white p-3 rounded-lg flex items-center gap-3 shadow-2xl">
            <div className="bg-red-500 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-md">!</div>
            <p className="text-sm font-medium">{serverError}</p>
            <button onClick={() => setServerError('')} className="ml-auto text-gray-400 text-lg hover:text-white">×</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminLogin;
