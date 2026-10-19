import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, FileText, Printer, ExternalLink, Building2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function ContractModal() {
  const { profile, isContractModalOpen, closeContractModal } = useApp();
  const [activeTab, setActiveTab] = useState<'contract' | 'ct01'>('contract');
  const navigate = useNavigate();

  if (!isContractModalOpen) return null;

  const cleanRoom = profile.room?.roomNumber
    ? (profile.room.roomNumber.startsWith('P.') ? profile.room.roomNumber : `P. ${profile.room.roomNumber}`)
    : 'P. G02';

  const contractCode = profile.contractUrl || `HĐ-${cleanRoom.replace(/[^\w]/g, '')}`;

  const birthYear = profile.dob ? profile.dob.slice(-4) : '2000';
  const dobParts = profile.dob ? profile.dob.split('/') : ['15', '08', '2000'];
  const dobDay = dobParts[0] || '15';
  const dobMonth = dobParts[1] || '08';
  const dobYear = dobParts[2] || '2000';

  const cccdDigits = (profile.cccd || '080092013210')
    .replace(/\D/g, '')
    .padEnd(12, ' ')
    .slice(0, 12)
    .split('');
  const landlordCccdDigits = '079090001800'.split('');

  const handleOpenFull = () => {
    closeContractModal();
    navigate('/contract');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={closeContractModal}
    >
      <div 
        className="w-full max-w-3xl bg-white dark:bg-[#0f172a] rounded-3xl border border-white/90 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] flex flex-col max-h-[92vh] overflow-hidden relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <FileText size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Văn bản Pháp lý & Hợp đồng
                </h3>
                <span className="badge-paid text-[10px] py-0.5">Hiệu lực</span>
              </div>
              <p className="text-xs text-slate-400">
                Mã: {contractCode} — Phòng {cleanRoom}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenFull}
              className="w-11 h-11 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
              title="Mở toàn màn hình"
              aria-label="Mở toàn màn hình"
            >
              <ExternalLink size={18} />
            </button>
            <button 
              type="button"
              onClick={closeContractModal}
              className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Đóng"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab selection */}
        <div className="shrink-0 px-5 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/40 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('contract')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'contract'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Hợp đồng thuê phòng (PDF 2)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ct01')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'ct01'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Tờ khai cư trú CT01 (PDF 1)
          </button>
        </div>

        {/* Body Container: Scrollable A4 Document Sheet */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-100 dark:bg-[#070b14]">
          <div 
            style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
            className="contract-document-a4 w-full bg-white text-black shadow-md border border-slate-300 rounded-none p-6 sm:p-10 leading-[1.45] text-[13px] select-text"
          >
            
            {activeTab === 'contract' ? (
              /* TAB 1: CONTRACT A4 */
              <div className="space-y-3.5 text-black">
                <div className="text-center space-y-0.5">
                  <p className="font-bold text-[13px] uppercase tracking-wider">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                  <p className="font-bold text-[13px]">Độc Lập – Tự do – Hạnh Phúc</p>
                  <div className="w-32 h-[1px] bg-black mx-auto mt-1" />
                </div>

                <div className="text-center pt-2 pb-1">
                  <h4 className="text-[15px] font-bold uppercase">HỢP ĐỒNG THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ</h4>
                </div>

                <div className="space-y-1">
                  <p>Hôm nay, ngày <span className="font-bold underline">01</span> tháng <span className="font-bold underline">06</span> năm 20<span className="font-bold underline">26</span></p>
                  <p>Tại căn nhà số: <span className="font-bold">Nhà Trọ Phong Lan</span> Đường <span className="font-bold">Lê Văn Chí</span>, Khu phố <span className="font-bold">3</span>, phường <span className="font-bold">Linh Chiểu</span>, TP. Hồ Chí Minh</p>
                </div>

                <div className="space-y-1 pt-1">
                  <p className="font-bold uppercase text-[12.5px]">I/ BÊN CHO THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ: (Gọi tắt là bên A):</p>
                  <p>1. Ông/bà: <span className="font-bold">BÙI TRUNG KHẢI</span>, Sinh năm: <span className="font-bold">1990</span>, Số CCCD: <span className="font-bold">079090001800</span></p>
                  <p>Nơi đăng ký thường trú: Số 123 Đường Kha Vạn Cân, Khu phố 2, Phường Linh Chiểu, Tỉnh (TP): TP. Hồ Chí Minh</p>
                  <p>2. Ông/bà: ......................................., Sinh năm: ............., Số CCCD: ................................</p>
                  <p>Là chủ sở hữu căn nhà tại địa chỉ số: Nhà Trọ Phong Lan Đường Lê Văn Chí, Khu phố 3, Phường Linh Chiểu, TP. Hồ Chí Minh.</p>
                </div>

                <div className="space-y-1 pt-1">
                  <p className="font-bold uppercase text-[12.5px]">II/ BÊN THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ: (Gọi tắt là bên B):</p>
                  <p>1. Ông/bà: <span className="font-bold uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</span> Sinh năm: <span className="font-bold">{birthYear}</span> Số CCCD/ĐDCN: <span className="font-bold">{profile.cccd || '080092013210'}</span></p>
                  <p>Nơi đăng ký thường trú: <span className="font-bold">{profile.address || 'Xã Long Hựu Đông, Huyện Cần Đước, Tỉnh Long An'}</span></p>
                  <p>2. Ông/bà:     .............................. Sinh năm:  ........  Số CCCD/ĐDCN: .............................</p>
                </div>

                <div className="space-y-1.5 pt-1 text-justify">
                  <p className="font-bold text-center">Sau khi thỏa thuận, hai bên thống nhất như sau:</p>
                  <p>Bên A đồng ý cho bên B được thuê/mượn/ở nhờ nhà, phòng trọ số <span className="font-bold underline">{cleanRoom}</span> tại căn nhà số nhà Nhà Trọ Phong Lan Đường Lê Văn Chí, Khu phố 3, Phường Linh Chiểu, TP. Hồ Chí Minh</p>
                  <p>Thời hạn thuê (mượn, ở nhờ nhà): <span className="font-bold">30 tháng</span> kể từ ngày ký họp đồng</p>
                  <p>Bên B chỉ được quyền ở và đăng ký tạm trú vào địa chỉ nhà bên A, bên B không được tranh chấp nhà, yêu cầu gì về tài sản của bên A.</p>
                  <p>Hợp đồng này được lập thành 02 bản có giá trị như nhau mỗi bên giữ 01 bản./.</p>
                </div>

                <div className="pt-6 grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="font-bold text-[12px] uppercase">BÊN CHO/MƯỢN/Ở NHỜ<br />NHÀ/PHÒNG TRỌ</p>
                    <p className="italic text-[11px]">(Ký tên, ghi rõ họ tên)</p>
                    <p className="italic font-bold text-[12px] mt-6">(Đã ký)</p>
                    <p className="font-bold text-[13px] mt-1">Bùi Trung Khải</p>
                  </div>

                  <div>
                    <p className="font-bold text-[12px] uppercase">BÊN THUÊ/MƯỢN/Ở NHỜ<br />NHÀ/PHÒNG TRỌ</p>
                    <p className="italic text-[11px]">(Ký tên, ghi rõ họ tên)</p>
                    <p className="italic font-bold text-[12px] mt-6">(Đã ký)</p>
                    <p className="font-bold text-[13px] mt-1 uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</p>
                  </div>
                </div>
              </div>
            ) : (
              /* TAB 2: CT01 A4 */
              <div className="space-y-3 text-black">
                <div className="text-[11px] italic leading-tight">
                  <p>Mẫu CT01 ban hành kèm theo Thông tư số 53/2025/TT-BCA</p>
                  <p>ngày 01/7/2025 của Bộ trưởng Bộ Công an</p>
                </div>

                <div className="text-center space-y-0.5 pt-1">
                  <p className="font-bold text-[13px] uppercase tracking-wider">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                  <p className="font-bold text-[13px]">Độc lập – Tự do – Hạnh phúc</p>
                  <div className="w-28 h-[1px] bg-black mx-auto mt-1" />
                </div>

                <div className="text-center pt-1 pb-1 space-y-0.5">
                  <h4 className="text-[15px] font-bold uppercase">TỜ KHAI THAY ĐỔI THÔNG TIN CƯ TRÚ</h4>
                  <p className="text-[12px]">Kính gửi<sup>(1)</sup>: <span className="font-semibold underline">Công an Phường Linh Chiểu, TP. Thủ Đức, TP. Hồ Chí Minh</span></p>
                </div>

                <div className="space-y-1.5 text-[12.5px]">
                  <p>1. Họ, chữ đệm và tên khai sinh: <span className="font-bold uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</span></p>
                  <p>2. Ngày sinh: <span className="font-semibold">{dobDay}/{dobMonth}/{dobYear}</span> — 3. Giới tính: Nam</p>
                  
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="shrink-0">4. Số định danh cá nhân:</span>
                    <div className="flex gap-0.5 font-mono font-bold">
                      {cccdDigits.map((d, i) => (
                        <span key={i} className="w-5 h-6 border border-black flex items-center justify-center text-[11px]">{d}</span>
                      ))}
                    </div>
                  </div>

                  <p>5. SĐT: {profile.phone || '0348667694'} — 6. Email: {profile.email || 'resident@ecostay.vn'}</p>
                  <p>7. Chủ hộ: <span className="font-bold">BÙI TRUNG KHẢI</span> — 8. Quan hệ: Người thuê trọ</p>

                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0">9. Số ĐDCN chủ hộ:</span>
                    <div className="flex gap-0.5 font-mono font-bold">
                      {landlordCccdDigits.map((d, i) => (
                        <span key={i} className="w-5 h-6 border border-black flex items-center justify-center text-[11px]">{d}</span>
                      ))}
                    </div>
                  </div>

                  <p className="pt-0.5">10. Nội dung đề nghị: <span className="font-semibold">Đăng ký tạm trú tại Phòng {cleanRoom}, Nhà Trọ Phong Lan, Đường Lê Văn Chí, Phường Linh Chiểu, TP. Thủ Đức, TP. Hồ Chí Minh.</span></p>
                </div>

                <div className="pt-4 grid grid-cols-2 gap-4 text-center text-[11px]">
                  <div>
                    <p className="font-bold uppercase">Ý KIẾN CỦA CHỦ HỘ</p>
                    <p className="italic text-slate-500">(Ký, ghi rõ họ tên)</p>
                    <p className="italic font-bold text-[11px] mt-6">(Đã ký)</p>
                    <p className="font-bold mt-1">Bùi Trung Khải</p>
                  </div>
                  <div>
                    <p className="font-bold uppercase">NGƯỜI KÊ KHAI</p>
                    <p className="italic text-slate-500">(Ký, ghi rõ họ tên)</p>
                    <p className="italic font-bold text-[11px] mt-6">(Đã ký)</p>
                    <p className="font-bold mt-1 uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 p-3 sm:p-3.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0f172a] flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={closeContractModal}
            className="soft-button text-xs py-2 px-3 text-slate-600 dark:text-slate-300 cursor-pointer"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="soft-button text-xs py-2 px-2.5 flex items-center gap-1 text-slate-700 dark:text-slate-200 cursor-pointer font-semibold"
            >
              <Printer size={13} />
              <span>In A4</span>
            </button>

            <button
              type="button"
              onClick={handleOpenFull}
              className="primary-button text-xs py-2 px-3 flex items-center gap-1 shadow-sm cursor-pointer font-semibold"
            >
              <ExternalLink size={13} />
              <span>Xem toàn màn hình</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
