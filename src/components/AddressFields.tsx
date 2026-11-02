import React, { useEffect, useState } from 'react';
import { AddressParts, VnProvince, joinAddress, loadProvinces, splitAddress } from '../lib/vnAddress';

const EMPTY: AddressParts = { province: '', ward: '', detail: '' };

export function AddressFields({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [provinces, setProvinces] = useState<VnProvince[]>([]);
  const [parts, setParts] = useState<AddressParts>(EMPTY);

  useEffect(() => {
    let active = true;
    loadProvinces().then(list => { if (active) setProvinces(list); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Split again only when the text changed from outside, such as a CCCD scan.
  useEffect(() => {
    if (provinces.length && joinAddress(parts) !== value) setParts(splitAddress(value, provinces));
  }, [value, provinces]);

  const update = (next: AddressParts) => {
    setParts(next);
    onChange(joinAddress(next));
  };
  const wards = provinces.find(item => item.n === parts.province)?.w || [];

  return (
    <div className="kit-profile-field min-w-0 border-b border-black/[0.06] py-3.5 dark:border-white/[0.08] sm:col-span-2">
      <dt className="apple-callout font-medium kit-text-secondary">Địa chỉ thường trú</dt>
      <dd className="mt-1.5 grid gap-3 sm:grid-cols-2">
        <label className="apple-callout kit-text-secondary block min-w-0">
          Tỉnh / Thành phố
          <select value={parts.province} onChange={event => update({ ...parts, province: event.target.value, ward: '' })} className="kit-field mt-1 w-full px-3">
            <option value="">Chọn tỉnh / thành phố</option>
            {provinces.map(item => <option key={item.n} value={item.n}>{item.n}</option>)}
          </select>
        </label>
        <label className="apple-callout kit-text-secondary block min-w-0">
          Phường / Xã
          <select value={parts.ward} disabled={!parts.province} onChange={event => update({ ...parts, ward: event.target.value })} className="kit-field mt-1 w-full px-3 disabled:opacity-60">
            <option value="">Chọn phường / xã</option>
            {wards.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="apple-callout kit-text-secondary block min-w-0 sm:col-span-2">
          Số nhà, tên đường, khu phố
          <input type="text" value={parts.detail} placeholder="Ví dụ: 45 Lê Văn Sỹ, Khu phố 2" onChange={event => update({ ...parts, detail: event.target.value })} className="kit-field mt-1 w-full px-3" />
        </label>
      </dd>
    </div>
  );
}
