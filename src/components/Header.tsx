import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Settings, Edit2, Plus, X } from 'lucide-react';
import { SystemConfig, AvailabilitySlot } from '../types';

interface HeaderProps {
  config: SystemConfig;
  onOpenAdmin: () => void;
  onSaveAvailability: (slots: AvailabilitySlot[]) => Promise<void>;
}

export default function Header({ config, onOpenAdmin, onSaveAvailability }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [showEdit, setShowEdit] = useState<boolean>(false);
  const [editSlots, setEditSlots] = useState<AvailabilitySlot[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const w = days[date.getDay()];
    return `${y}年${m}月${d}日 (${w})`;
  };

  const formatTime = (date: Date) => date.toTimeString().split(' ')[0];

  const slots = config.availabilitySlots || [];
  const hasAvailability = slots.some(s => s.count > 0);

  const openEdit = () => {
    setEditSlots(slots.length > 0 ? slots.map(s => ({ ...s })) : [{ people: 4, count: 0 }, { people: 2, count: 0 }]);
    setShowEdit(true);
  };

  const addSlot = () => setEditSlots(prev => [...prev, { people: 1, count: 0 }]);

  const removeSlot = (i: number) => setEditSlots(prev => prev.filter((_, idx) => idx !== i));

  const updateSlot = (i: number, field: keyof AvailabilitySlot, value: number) => {
    setEditSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: Math.max(0, value) } : s));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSaveAvailability(editSlots);
    setSaving(false);
    setShowEdit(false);
  };

  return (
    <header className="bg-natural-olive text-natural-cream border-b-[3px] border-natural-clay shadow-md">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center gap-4">
        {/* Brand Logo & Title */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-2xl select-none">♨</div>
          <div>
            <h1 className="text-sm md:text-base font-bold tracking-wide text-natural-cream">
              温泉休憩室 混雑リアルタイム管理
            </h1>
            <p className="text-[10px] text-natural-cream/55 mt-0.5">
              座敷座布団の管理・待合チケットの受付連携システム
            </p>
          </div>
        </div>

        {/* 空き人数表示（手入力） */}
        <div className="flex-1 flex items-center gap-2 flex-wrap justify-center">
          <span className="text-[10px] font-bold text-natural-clay shrink-0 uppercase tracking-wide">空き:</span>
          {slots.length > 0 ? (
            <>
              {slots.map((slot, i) => (
                <span key={i} className="bg-white/15 border border-white/25 rounded-md px-2.5 py-1 text-xs font-extrabold text-natural-cream whitespace-nowrap">
                  {slot.people}人×{slot.count}
                </span>
              ))}
              <span className={`text-xs font-extrabold px-2 py-1 rounded-md whitespace-nowrap ${hasAvailability ? 'bg-natural-clay text-white' : 'text-natural-cream/50'}`}>
                {hasAvailability ? '空きあり' : '空きなし'}
              </span>
            </>
          ) : (
            <span className="text-natural-cream/40 text-[11px] font-semibold">未設定</span>
          )}
          <button
            onClick={openEdit}
            className="flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-[10px] font-bold text-natural-cream cursor-pointer transition-colors"
            title="空き人数を編集"
          >
            <Edit2 size={11} />
            <span>編集</span>
          </button>
        </div>

        {/* Admin button + Clock */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onOpenAdmin}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-white/10 border border-natural-cream/30 text-natural-cream rounded text-xs font-bold cursor-pointer transition-colors"
            title="部屋・座布団サイズ・レイアウトの管理設定"
          >
            <Settings size={14} />
            <span>管理設定</span>
          </button>

          <div className="flex flex-col items-end gap-0.5 text-right">
            <div className="text-[10px] text-natural-cream/85 flex items-center gap-1 font-mono">
              <Calendar size={11} className="text-natural-clay" />
              {formatDate(currentTime)}
            </div>
            <div className="text-sm font-bold font-mono text-natural-cream tracking-widest flex items-center gap-1.5">
              <Clock size={13} className="text-natural-clay" />
              {formatTime(currentTime)}
            </div>
          </div>
        </div>
      </div>

      {/* 空き人数編集モーダル */}
      {showEdit && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50" onClick={() => setShowEdit(false)}>
          <div className="bg-white rounded max-w-xs w-full p-5 shadow-2xl border border-natural-border flex flex-col gap-4 text-natural-wood" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b-2 border-natural-clay pb-2">
              <span className="text-sm font-bold tracking-wide">空き人数の設定</span>
              <button onClick={() => setShowEdit(false)} className="text-natural-clay hover:text-natural-wood cursor-pointer"><X size={18} /></button>
            </div>

            <div className="flex flex-col gap-2">
              {editSlots.map((slot, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={slot.people}
                    onChange={e => updateSlot(i, 'people', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1.5 border border-natural-border rounded text-sm font-bold font-mono text-center focus:outline-none focus:border-natural-clay bg-[#FAF7F2]/40"
                  />
                  <span className="text-sm font-bold text-natural-wood">人 ×</span>
                  <input
                    type="number"
                    min="0"
                    value={slot.count}
                    onChange={e => updateSlot(i, 'count', parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1.5 border border-natural-border rounded text-sm font-bold font-mono text-center focus:outline-none focus:border-natural-clay bg-[#FAF7F2]/40"
                  />
                  <span className="text-sm font-bold text-natural-wood/60">組</span>
                  <button onClick={() => removeSlot(i)} className="ml-auto text-natural-clay hover:text-[#FF6B6B] cursor-pointer"><X size={15} /></button>
                </div>
              ))}
            </div>

            <button
              onClick={addSlot}
              className="flex items-center justify-center gap-1 py-1.5 border border-dashed border-natural-border rounded text-xs font-bold text-natural-clay hover:bg-natural-beige cursor-pointer transition-colors"
            >
              <Plus size={13} />行を追加
            </button>

            <div className="flex gap-2 mt-1">
              <button onClick={() => setShowEdit(false)} className="flex-1 py-2 border border-natural-border rounded text-xs font-bold hover:bg-stone-50 cursor-pointer">
                閉じる
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-natural-olive hover:bg-natural-olive/90 text-white rounded text-xs font-extrabold cursor-pointer shadow-md disabled:opacity-60"
              >
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
