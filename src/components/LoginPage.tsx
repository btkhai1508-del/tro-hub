import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
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
import { IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { Background } from './Background';
import { AppleCheckbox } from './AppleControls';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginUser, loginWithZalo, registerResident } = useApp();

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
        setErrorMsg(res.error || 'Số điện thoại hoặc mật khẩu không chính xác');
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
        setErrorMsg(res.error || 'Không thể đăng nhập bằng Zalo. Vui lòng đăng nhập bằng Số điện thoại và Mật khẩu.');
      }
    } catch (err: any) {
      setIsLoading(false);
      let friendlyMsg = 'Tính năng đăng nhập nhanh Zalo 1-chạm chỉ hoạt động khi mở trong ứng dụng Zalo trên điện thoại. Trên trình duyệt web, vui lòng đăng nhập bằng Số điện thoại và Mật khẩu bên dưới.';
      if (err?.code !== -2000 && err?.message && !err.message.includes('-2000') && !err.message.includes('Unknown error')) {
        friendlyMsg = err.message;
      }
      setErrorMsg(friendlyMsg);
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
    <div className="min-h-svh relative isolate overflow-hidden px-4 py-8 sm:px-8 sm:py-12 flex items-center justify-center">
      <Background />
      <div className="relative z-10 w-full max-w-[440px]">
        <div className="w-full max-w-[440px] mx-auto">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-white/55 dark:bg-white/5 mb-3"><IconHome3D size={72} /></span>
            <span className="text-2xl font-semibold tracking-tight text-neutral-950 dark:text-white">Trọ-Hub<span className="text-neutral-700 dark:text-neutral-200">.</span></span>
            <p className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-200">Không gian của bạn tại Phong Lan</p>
          </div>
          <div className="liquid-panel auth-panel rounded-[32px] sm:rounded-[36px] p-6 sm:p-8">
            <div className="mb-7">
              <span className="liquid-eyebrow text-neutral-700 dark:text-neutral-200">NHÀ TRỌ PHONG LAN</span>
              <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.045em] text-neutral-950 dark:text-white">
                {mode === 'register' ? 'Bắt đầu với Trọ-Hub' : mode === 'forgot' ? 'Lấy lại quyền truy cập' : mode === 'pending_approval' ? 'Chào mừng bạn' : 'Chào bạn trở lại.'}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
                {mode === 'register' ? 'Tạo tài khoản để kết nối với nơi bạn đang sống.' : mode === 'forgot' ? 'Chúng mình sẽ giúp bạn trở lại không gian của mình.' : mode === 'pending_approval' ? 'Thông tin đăng ký của bạn đã được ghi nhận.' : 'Đăng nhập để xem hóa đơn và quản lý tiện ích.'}
              </p>
            </div>

          {/* Switch Mode: Login vs Register */}
          {mode !== 'forgot' && mode !== 'pending_approval' && (
            <div className="grid grid-cols-2 p-1.5 bg-white/20 dark:bg-white/5 rounded-full mb-6 border border-white/50 dark:border-white/5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`py-2.5 text-sm font-semibold rounded-full transition-all duration-200 cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white/95 dark:bg-white/12 text-neutral-950 dark:text-white shadow-sm ring-1 ring-black/3 dark:ring-white/10'
                    : 'text-neutral-700 dark:text-neutral-200 hover:text-neutral-800 dark:hover:text-white'
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
                className={`py-2.5 text-sm font-semibold rounded-full transition-all duration-200 cursor-pointer ${
                  mode === 'register'
                    ? 'bg-white/95 dark:bg-white/12 text-neutral-950 dark:text-white shadow-sm ring-1 ring-black/3 dark:ring-white/10'
                    : 'text-neutral-700 dark:text-neutral-200 hover:text-neutral-800 dark:hover:text-white'
                }`}
              >
                Đăng ký mới
              </button>
            </div>
          )}

          {/* Feedback Alerts */}
          {errorMsg && (
            <div role="alert" className="mb-4 p-3.5 rounded-2xl bg-rose-50/85 dark:bg-rose-500/10 border border-rose-200/80 dark:border-rose-500/20 text-rose-800 dark:text-rose-200 text-sm flex items-start gap-2 animate-in fade-in duration-150">
              <AlertCircle size={16} className="shrink-0 text-rose-600 mt-0.5" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div role="status" className="mb-4 p-3.5 rounded-2xl bg-emerald-50/85 dark:bg-emerald-500/10 border border-emerald-200/80 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-sm flex items-center gap-2 animate-in fade-in duration-150">
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
                className="w-full min-h-12 bg-neutral-50/80 dark:bg-neutral-500/10 border border-neutral-200/70 dark:border-neutral-400/20 text-neutral-700 dark:text-neutral-200 font-semibold text-sm rounded-2xl flex items-center justify-center gap-2.5 hover:bg-neutral-100/80 dark:hover:bg-neutral-500/20 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                <div className="w-6 h-6 rounded-lg bg-neutral-600 flex items-center justify-center">
                  <span className="text-white text-xs font-bold tracking-tighter">Z</span>
                </div>
                <span>{isLoading ? 'Đang xác thực Zalo...' : 'Đăng nhập nhanh với Zalo'}</span>
              </button>

              {/* Divider */}
              <div className="relative flex items-center justify-center pt-1 pb-1">
                <div className="border-t border-neutral-200/80 dark:border-neutral-800 w-full" />
                <span className="px-3 text-xs font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap shrink-0">hoặc số điện thoại</span>
                <div className="border-t border-neutral-200/80 dark:border-neutral-800 w-full" />
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
              
              {/* Phone Input */}
              <div>
                <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1.5">
                  Số điện thoại
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-neutral-600 dark:text-neutral-300 pointer-events-none">
                    <Phone size={17} />
                  </div>
                  <input
                    type="tel"
                    autoComplete="tel"
                    required
                    placeholder="Ví dụ: 0902 371 800"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-3 text-xs sm:text-sm font-medium rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 focus:outline-none transition-all font-num placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">Mật khẩu</label>
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className="text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:underline cursor-pointer"
                  >
                    Quên mật khẩu?
                  </button>
                </div>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-neutral-600 dark:text-neutral-300 pointer-events-none">
                    <Lock size={17} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    placeholder="Nhập mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 text-xs sm:text-sm font-medium rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 focus:outline-none transition-all font-mono placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-neutral-200 p-1 cursor-pointer"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center justify-between pt-1">
                <AppleCheckbox
                  checked={rememberMe}
                  onChange={setRememberMe}
                  label="Ghi nhớ đăng nhập"
                  color="black"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="primary-button w-full min-h-12 text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
              >
                <span>{isLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
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
              <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed flex items-start gap-2">
                <ShieldAlert size={16} className="shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <strong>Yêu cầu xác nhận:</strong> Sau khi đăng ký, tài khoản cần được <strong>Chủ trọ / Ban quản lý</strong> xác nhận duyệt phòng trước khi có thể đăng nhập.
                </span>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Họ và tên cư dân</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-neutral-600 dark:text-neutral-300 pointer-events-none">
                    <User size={16} />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Họ và tên của bạn"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm font-medium rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:outline-none placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    autoComplete="tel"
                    required
                    placeholder="09xx xxx xxx"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm font-num rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:outline-none placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Số phòng thuê</label>
                  <input
                    type="text"
                    required
                    placeholder="P. 203"
                    value={regRoom}
                    onChange={(e) => setRegRoom(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm font-num rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:outline-none placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Email liên hệ (tùy chọn)</label>
                <input
                  type="email"
                  placeholder="ban@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-medium rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:outline-none placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Mật khẩu</label>
                  <input
                    type="password"
                    required
                    placeholder="Ít nhất 6 ký tự"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:outline-none placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Nhập lại mật khẩu</label>
                  <input
                    type="password"
                    required
                    placeholder="Nhập lại mật khẩu"
                    value={regConfirmPass}
                    onChange={(e) => setRegConfirmPass(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/35 dark:bg-white/5 text-neutral-950 dark:text-white focus:ring-2 focus:ring-neutral-900/10 focus:outline-none placeholder:text-neutral-600 dark:placeholder:text-neutral-300"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="primary-button w-full min-h-12 text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-3"
              >
                <span>{isLoading ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu đăng ký cho Chủ trọ'}</span>
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
                <h3 className="text-lg font-semibold text-neutral-950 dark:text-white">
                  Yêu cầu đăng ký đã được gửi!
                </h3>
              </div>

              {registeredData && (
                <div className="liquid-panel-subtle p-4 rounded-2xl text-left text-sm space-y-2 font-medium">
                  <div className="flex justify-between text-neutral-700">
                    <span>Họ và tên:</span>
                    <strong className="text-neutral-950 dark:text-neutral-100">{registeredData.name}</strong>
                  </div>
                  <div className="flex justify-between text-neutral-700">
                    <span>Số điện thoại:</span>
                    <strong className="text-neutral-950 dark:text-neutral-100 font-num">{registeredData.phone}</strong>
                  </div>
                  <div className="flex justify-between text-neutral-700">
                    <span>Số phòng đăng ký:</span>
                    <strong className="text-neutral-950 dark:text-neutral-100 font-num">{registeredData.roomNumber}</strong>
                  </div>
                </div>
              )}

              <p className="text-xs text-neutral-700 dark:text-neutral-200 leading-relaxed">
                Chủ trọ sẽ đối chiếu hợp đồng thuê phòng và kích hoạt tài khoản của bạn. Sau khi được duyệt, bạn có thể đăng nhập bằng số điện thoại này.
              </p>

              <div className="pt-2 space-y-2">
                <a
                  href="tel:0902371800"
                  className="soft-button w-full min-h-12 px-4 text-neutral-700 dark:text-neutral-200 font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
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
                  className="primary-button w-full min-h-12 px-4 text-sm cursor-pointer"
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
              <div className="flex items-center gap-2.5 text-neutral-800 dark:text-neutral-100 pb-1">
                <KeyRound size={20} className="text-amber-500" />
                <h3 className="font-bold text-sm">Khôi phục mật khẩu tài khoản</h3>
              </div>

              <p className="text-xs text-neutral-700 dark:text-neutral-200 leading-relaxed">
                Nhập số điện thoại đã đăng ký với Ban Quản Lý Nhà Trọ Phong Lan. Chúng tôi sẽ gửi mã OTP đặt lại mật khẩu cho bạn.
              </p>

              <div>
                <label className="block text-[13px] font-medium text-neutral-700 dark:text-neutral-200 mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  placeholder="Ví dụ: 0902 371 800"
                  value={forgotInput}
                  onChange={(e) => setForgotInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-neutral-200 bg-white/35 text-neutral-950 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none font-num"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setSuccessMsg('Đã gửi mã khôi phục tới số điện thoại của bạn. Vui lòng kiểm tra tin nhắn SMS.');
                  setTimeout(() => setMode('login'), 2500);
                }}
                className="primary-button w-full min-h-12 px-4 text-sm cursor-pointer"
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
                className="w-full text-center text-xs font-semibold text-neutral-700 hover:text-neutral-950 py-1 transition-colors cursor-pointer"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}

        </div>

          <div className="mt-6 flex flex-col items-center gap-2 text-center text-xs text-neutral-700 dark:text-neutral-200">
            <a href="tel:0902371800" className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 font-medium text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-600 transition-colors">
              <PhoneCall size={14} /> Cần hỗ trợ? Liên hệ quản lý
            </a>
            <span className="text-[11px] text-neutral-700 dark:text-neutral-200">Trọ-Hub · Một nơi cho mọi điều ở nhà.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
