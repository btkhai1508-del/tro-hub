import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Landmark } from 'lucide-react';
import { workerFetch } from '../lib/api';
import { fetchPaymentPortal, PaymentPortal, vietQrUrl } from '../lib/paymentPortal';
import { cn } from '../lib/utils';
import { IconWallet3D } from './Icons3D';

interface House { id: string; name: string }
interface Bank { bin: string; code: string; shortName: string; name: string }

const fieldClass =
  'w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500';
const labelClass = 'text-[11px] font-bold text-neutral-600 uppercase block mb-1.5 dark:text-neutral-300';

/**
 * Admin Tổng (and Developer) set, per house, the bank and account residents pay rent into.
 * VietQR draws the code from them; Zalo's quick transfer is offered when the account is the
 * one registered with Zalo Checkout.
 */
export function PaymentPortalSettings({ onBack }: { onBack: () => void }) {
  const [houses, setHouses] = useState<House[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [houseId, setHouseId] = useState('');
  const [saved, setSaved] = useState<PaymentPortal | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [bankBin, setBankBin] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    workerFetch('/api/houses')
      .then((res) => res.json())
      .then((data) => {
        const list: House[] = data?.houses ?? [];
        setHouses(list);
        setHouseId((current) => current || list[0]?.id || '');
        if (!data?.success) setMessage({ ok: false, text: data?.error || 'Chưa tải được danh sách nhà trọ.' });
      })
      .catch(() => setMessage({ ok: false, text: 'Chưa kết nối được máy chủ Cloudflare.' }));
    workerFetch('/api/banks')
      .then((res) => res.json())
      .then((data) => setBanks(data?.banks ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!houseId) return;
    setMessage(null);
    fetchPaymentPortal(houseId).then((result) => {
      setSaved(result?.portal ?? null);
      setCanEdit(Boolean(result?.canEdit));
      setBankBin(result?.portal.bankBin ?? '');
      setAccountNo(result?.portal.accountNo ?? '');
    });
  }, [houseId]);

  const bank = useMemo(() => banks.find((b) => b.bin === bankBin), [banks, bankBin]);
  const cleanAccount = accountNo.replace(/\s/g, '');
  const accountValid = /^[0-9A-Za-z]{6,19}$/.test(cleanAccount);
  const changed = Boolean(saved) && (bankBin !== saved?.bankBin || cleanAccount !== saved?.accountNo);
  const previewUrl = bankBin && accountValid ? vietQrUrl({ bankBin, accountNo: cleanAccount, accountName: saved?.accountName ?? '' }) : '';

  const save = async () => {
    if (!canEdit || !bank || !accountValid || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await workerFetch(`/api/houses/${encodeURIComponent(houseId)}/payment-portal`, {
        method: 'PUT',
        body: JSON.stringify({ bankBin, accountNo: cleanAccount }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) throw new Error(data?.error || 'Chưa lưu được thông tin thanh toán.');
      const fresh = await fetchPaymentPortal(houseId);
      setSaved(fresh?.portal ?? null);
      setMessage({ ok: true, text: `Đã lưu. Cư dân ${houses.find((h) => h.id === houseId)?.name ?? ''} sẽ chuyển tiền vào ${bank.shortName} ${cleanAccount}.` });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
        >
          <ArrowLeft size={16} />
          <span>Quay lại Tiện ích</span>
        </button>
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
          <IconWallet3D size={22} />
          <span>Thông tin thanh toán</span>
        </div>
      </div>

      <div className="soft-surface p-5 sm:p-8 space-y-6">
        <div className="border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <h2 className="type-h2 font-bold text-neutral-900 dark:text-white flex items-center gap-3">
            <IconWallet3D size={44} />
            <span>Thông tin thanh toán</span>
          </h2>
          <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-200 mt-1">
            Chọn ngân hàng và số tài khoản nhận tiền phòng của từng nhà. Mã QR VietQR cho cư dân được tạo tự động.
          </p>
        </div>

        {houses.length > 1 && (
          <div className="kit-segmented flex flex-wrap gap-1 p-1" role="tablist" aria-label="Chọn nhà trọ">
            {houses.map((h) => (
              <button
                key={h.id}
                type="button"
                role="tab"
                aria-selected={houseId === h.id}
                onClick={() => setHouseId(h.id)}
                className={cn('kit-segment min-h-11 px-3 apple-body font-medium flex-1', houseId === h.id && 'kit-segment-active')}
              >
                {h.name}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="portal-bank" className={labelClass}>Ngân hàng</label>
              <select id="portal-bank" value={bankBin} disabled={!canEdit} onChange={(e) => setBankBin(e.target.value)} className={fieldClass}>
                <option value="">Chọn ngân hàng</option>
                {banks.map((b) => (
                  <option key={b.bin} value={b.bin}>{b.shortName} — {b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="portal-account" className={labelClass}>Số tài khoản</label>
              <input
                id="portal-account"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={accountNo}
                disabled={!canEdit}
                onChange={(e) => setAccountNo(e.target.value)}
                placeholder="Ví dụ 0902371800"
                className={cn(fieldClass, 'font-num tracking-wider')}
              />
              {accountNo && !accountValid && <p className="mt-1.5 text-xs text-rose-600">Số tài khoản phải có 6–19 chữ số.</p>}
            </div>
            {saved?.accountName && (
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                Tên hiển thị trên QR: <span className="font-semibold text-neutral-900 dark:text-white">{saved.accountName}</span>
              </p>
            )}

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4 flex items-start gap-2.5 text-xs text-neutral-700 dark:text-neutral-200">
              <Landmark size={16} className="shrink-0 mt-0.5" />
              {saved?.zaloCheckout && !changed ? (
                <span>Chuyển khoản nhanh qua Zalo <b>đang bật</b> cho nhà này: tài khoản trùng với tài khoản đã đăng ký Zalo Checkout.</span>
              ) : (
                <span>Chuyển khoản nhanh qua Zalo <b>không khả dụng</b> với tài khoản này, vì Zalo chỉ chuyển vào tài khoản đã đăng ký Zalo Checkout. Cư dân vẫn trả bằng mã QR.</span>
              )}
            </div>

            {canEdit ? (
              <button
                type="button"
                onClick={save}
                disabled={!bank || !accountValid || !changed || busy}
                className="primary-button min-h-11 w-full px-4 apple-control flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                <span>{busy ? 'Đang lưu...' : 'Lưu thông tin thanh toán'}</span>
              </button>
            ) : (
              <p className="text-xs text-neutral-600 dark:text-neutral-300">Chỉ Admin Tổng được đổi ngân hàng và số tài khoản.</p>
            )}
            {message && (
              <p role={message.ok ? 'status' : 'alert'} className={cn('text-xs font-semibold', message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
                {message.text}
              </p>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-3 md:border-l border-neutral-200 dark:border-neutral-800 md:pl-6">
            {previewUrl ? (
              <img src={previewUrl} alt={`Mã QR ${bank?.shortName ?? ''} ${cleanAccount}`} className="w-52 h-52 object-contain bg-white rounded-xl p-2" />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-center text-xs text-neutral-500 dark:text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-4">
                Chọn ngân hàng và nhập số tài khoản để xem mã QR
              </div>
            )}
            <p className="text-[11px] text-neutral-600 dark:text-neutral-300 text-center max-w-[240px]">
              Mã mẫu chưa có số tiền. Khi cư dân thanh toán, số tiền và nội dung chuyển khoản được thêm tự động.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
