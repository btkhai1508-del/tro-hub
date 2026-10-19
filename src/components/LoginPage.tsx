import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Building2, 
  Phone, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  KeyRound, 
  User, 
  Clock, 
  ShieldAlert, 
  PhoneCall
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginUser, loginWithZalo, registerResident, profile } = useApp();

  // Mode: 'login' | 'register' | 'forgot' | 'pending_approval'
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'pending_approval'>('login');

  // Login form state - clean inputs
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regRoom, setRegRoom] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPass, setRegConfirmPass] = useState('');
  const [registeredData, setRegisteredData] = useState<any>(null);

  // Status feedback
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Reset password state
  const [forgotInput, setForgotInput] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const res = await loginUser(phone, password);
      setIsLoading(false);
      if (res.success) {
        setSuccessMsg('Đăng nhập thành công! Đang chuyển hướng...');
        setTimeout(() => {
          const isAdmin = Boolean(res.isAdmin) || phone.trim().toLowerCase() === 'admin' || phone.replace(/\D/g, '').endsWith('902371800');
          const from = (location.state as any)?.from?.pathname;
          const target = isAdmin ? '/admin' : ((from && from !== '/login' && from !== '/' && from !== '/admin') ? from : '/');
          navigate(target, { replace: true });
        }, 400);
      } else {
        setErrorMsg(res.error || 'Sai số điện thoại hoặc mật khẩu. Thử lại hoặc liên hệ chủ trọ để reset.');
      }
    } catch (err: any) {
      setIsLoading(false);
      setErrorMsg('Không thể kiểm tra đăng nhập: ' + (err.message || 'Lỗi mạng'));
    }
  };

  const handleZaloLogin = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const res = await loginWithZalo();
      setIsLoading(false);
      if (res.success) {
        setSuccessMsg('Đăng nhập Zalo thành công! Đang chuyển hướng...');
        setTimeout(() => {
          const from = (location.state as any)?.from?.pathname;
          const target = res.isAdmin ? '/admin' : ((from && from !== '/login' && from !== '/' && from !== '/admin') ? from : '/');
          navigate(target, { replace: true });
        }, 400);
      } else {
        setErrorMsg(res.error || 'Không thể đăng nhập bằng Zalo. Bạn có thể đăng nhập bằng Số điện thoại và mật khẩu bên dưới.');
      }
    } catch (err: any) {
      setIsLoading(false);
      setErrorMsg('Lỗi kết nối Zalo: ' + (err.message || 'Vui lòng thử lại'));
    }
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (regPassword !== regConfirmPass) {
      setErrorMsg('Mật khẩu xác nhận không khớp');
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      const res = registerResident({
        name: regName,
        phone: regPhone,
        email: regEmail,
        roomNumber: regRoom,
        password: regPassword
      });
      setIsLoading(false);

      if (res.success && res.pendingApproval) {
        setRegisteredData({
          name: regName,
          phone: regPhone,
          roomNumber: regRoom
        });
        setMode('pending_approval');
        // Reset register fields
        setRegName('');
        setRegPhone('');
        setRegEmail('');
        setRegRoom('');
        setRegPassword('');
        setRegConfirmPass('');
      } else {
        setErrorMsg(res.error || 'Đăng ký không thành công');
      }
    }, 400);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-3 sm:p-6 bg-gradient-to-br from-slate-100 via-[#f3f4f8] to-slate-200 select-none">
      
      {/* Background Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[15%] -left-[10%] w-[500px] h-[500px] rounded-full bg-indigo-200/40 blur-[120px]" />
        <div className="absolute -bottom-[15%] -right-[10%] w-[500px] h-[500px] rounded-full bg-emerald-200/35 blur-[120px]" />
      </div>

      <div className="w-full max-w-[430px] relative z-10 animate-in fade-in zoom-in-95 duration-300">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-[22px] bg-slate-900 text-white flex items-center justify-center shadow-xl shadow-slate-900/20 ring-4 ring-white dark:ring-slate-800 mb-4">
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Nhà Trọ Phong Lan
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Cổng dịch vụ cư dân thông minh
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white/95 dark:bg-[#111827]/95 backdrop-blur-xl rounded-[32px] border border-white/80 dark:border-slate-800 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.12)] p-6 sm:p-8">
          
          {/* Switch Mode: Login vs Register */}
          {mode !== 'forgot' && mode !== 'pending_approval' && (
            <div className="grid grid-cols-2 p-1 bg-slate-100/90 dark:bg-slate-800/90 rounded-2xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`py-2 text-xs sm:text-[13px] font-bold rounded-xl transition-all cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`py-2 text-xs sm:text-[13px] font-bold rounded-xl transition-all cursor-pointer ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                Đăng ký mới
              </button>
            </div>
          )}

          {/* Feedback Alerts */}
          {errorMsg && (
            <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs flex items-start gap-2 animate-in fade-in duration-150">
              <AlertCircle size={16} className="shrink-0 text-rose-600 mt-0.5" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs flex items-center gap-2 animate-in fade-in duration-150">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* =========================================================================
              1. LOGIN MODE (Zalo 1-Tap Login OR Phone Number & Password)
              ========================================================================= */}
          {mode === 'login' && (
            <div className="space-y-4">
              {/* Quick Zalo Login Button */}
              <button
                type="button"
                onClick={handleZaloLogin}
                disabled={isLoading}
                className="w-full h-12 bg-gradient-to-r from-[#0068FF] to-[#0052cc] hover:from-[#0055d4] hover:to-[#0041a8] active:scale-[0.99] text-white font-bold text-xs sm:text-sm rounded-2xl flex items-center justify-center gap-2.5 shadow-lg shadow-[#0068FF]/25 transition-all cursor-pointer disabled:opacity-50"
              >
                <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center shadow-xs">
                  <span className="text-[#0068FF] text-xs font-black tracking-tighter">Z</span>
                </div>
                <span>{isLoading ? 'Đang xác thực Zalo...' : 'Đăng nhập nhanh với Zalo'}</span>
              </button>

              {/* Divider */}
              <div className="relative flex items-center justify-center pt-1 pb-1">
                <div className="border-t border-slate-200/80 dark:border-slate-800 w-full" />
                <span className="bg-white dark:bg-[#111827] px-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">hoặc số điện thoại</span>
                <div className="border-t border-slate-200/80 dark:border-slate-800 w-full" />
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
              
              {/* Phone Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Số điện thoại
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                    <Phone size={17} />
                  </div>
                  <input
                    type="tel"
                    required
                    placeholder="Ví dụ: 0902 371 800"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-3 text-xs sm:text-sm font-medium rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 focus:outline-none transition-all font-num placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Mật khẩu</label>
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Quên mật khẩu?
                  </button>
                </div>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                    <Lock size={17} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Nhập mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 text-xs sm:text-sm font-medium rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 focus:outline-none transition-all font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-1 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition-colors"
                    title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900 cursor-pointer accent-slate-900"
                  />
                  <span className="text-xs text-slate-600 font-medium">Ghi nhớ đăng nhập</span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold text-xs sm:text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 transition-all cursor-pointer disabled:opacity-50 mt-2"
              >
                <span>{isLoading ? 'Đang kiểm tra từ Google Sheet...' : 'Đăng nhập vào hệ thống'}</span>
                {!isLoading && <ArrowRight size={16} />}
              </button>

            </form>
            </div>
          )}

          {/* =========================================================================
              2. REGISTER MODE (Requires Landlord Approval)
              ========================================================================= */}
          {mode === 'register' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              
              {/* Notice Banner */}
              <div className="p-3 rounded-2xl bg-amber-50/90 border border-amber-200/80 text-amber-800 text-[11px] leading-relaxed flex items-start gap-2">
                <ShieldAlert size={16} className="shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <strong>Yêu cầu xác nhận:</strong> Sau khi đăng ký, tài khoản cần được <strong>Chủ trọ / Ban quản lý</strong> xác nhận duyệt phòng trước khi có thể đăng nhập.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Họ và tên cư dân</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                    <User size={16} />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Bùi Trung Khải"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    required
                    placeholder="09xx xxx xxx"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm font-num rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Số phòng thuê</label>
                  <input
                    type="text"
                    required
                    placeholder="P. 203"
                    value={regRoom}
                    onChange={(e) => setRegRoom(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm font-num rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Email liên hệ (tùy chọn)</label>
                <input
                  type="email"
                  placeholder="cudan@ecostay.vn"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Mật khẩu</label>
                  <input
                    type="password"
                    required
                    placeholder="Ít nhất 6 ký tự"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Nhập lại MK</label>
                  <input
                    type="password"
                    required
                    placeholder="Xác nhận MK"
                    value={regConfirmPass}
                    onChange={(e) => setRegConfirmPass(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer mt-3"
              >
                <span>{isLoading ? 'Đang gửi yêu cầu...' : 'Đăng ký – Chờ chủ trọ duyệt'}</span>
                {!isLoading && <ArrowRight size={16} />}
              </button>
            </form>
          )}

          {/* =========================================================================
              3. PENDING APPROVAL CONFIRMATION
              ========================================================================= */}
          {mode === 'pending_approval' && (
            <div className="text-center space-y-4 py-2 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200/60 shadow-xs">
                <Clock size={28} />
              </div>

              <div>
                <span className="inline-block px-3 py-1 rounded-full bg-amber-100/80 text-amber-800 text-[11px] font-bold uppercase tracking-wider mb-2">
                  Đang chờ chủ trọ xác nhận
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  Yêu cầu đăng ký đã được gửi!
                </h3>
              </div>

              {registeredData && (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-left text-xs space-y-1.5 font-medium">
                  <div className="flex justify-between text-slate-500">
                    <span>Họ và tên:</span>
                    <strong className="text-slate-900">{registeredData.name}</strong>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Số điện thoại:</span>
                    <strong className="text-slate-900 font-num">{registeredData.phone}</strong>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Số phòng đăng ký:</span>
                    <strong className="text-slate-900 font-num">{registeredData.roomNumber}</strong>
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-500 leading-relaxed">
                Chủ trọ sẽ đối chiếu hợp đồng thuê phòng và kích hoạt tài khoản của bạn. Sau khi được duyệt, bạn có thể đăng nhập bằng số điện thoại này.
              </p>

              <div className="pt-2 space-y-2">
                <a
                  href="tel:0902371800"
                  className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <PhoneCall size={14} />
                  <span>Liên hệ BQL Bùi Trung Khải duyệt nhanh (0902 371 800)</span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Quay lại màn hình đăng nhập
                </button>
              </div>
            </div>
          )}

          {/* =========================================================================
              4. FORGOT PASSWORD MODE
              ========================================================================= */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 text-slate-800 pb-1">
                <KeyRound size={20} className="text-amber-500" />
                <h3 className="font-bold text-sm">Khôi phục mật khẩu tài khoản</h3>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Nhập số điện thoại đã đăng ký với Ban Quản Lý Nhà Trọ Phong Lan. Chúng tôi sẽ gửi mã OTP đặt lại mật khẩu cho bạn.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  placeholder="Ví dụ: 0902 371 800"
                  value={forgotInput}
                  onChange={(e) => setForgotInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-slate-900/10 focus:outline-none font-num"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setSuccessMsg('Đã gửi mã khôi phục tới số điện thoại của bạn. Vui lòng kiểm tra tin nhắn SMS.');
                  setTimeout(() => setMode('login'), 2500);
                }}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Gửi mã xác nhận OTP
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-900 py-1 transition-colors cursor-pointer"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}

        </div>

        {/* Footer Support Info */}
        <div className="text-center mt-6 text-xs text-slate-500 dark:text-slate-400">
          Cần hỗ trợ nhận phòng hoặc xác thực tài khoản? Hotline BQL (Bùi Trung Khải):{' '}
          <a href="tel:0902371800" className="text-slate-700 font-bold hover:underline">
            0902 371 800
          </a>
        </div>

      </div>
    </div>
  );
}
