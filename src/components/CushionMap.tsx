import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Unlink, Link, Check, X, Clock, Edit3, MoreVertical } from 'lucide-react';
import { Cushion, Customer, RoomConfig } from '../types';
import { db, doc, updateDoc, writeBatch, deleteDoc, setDoc } from '../firebase';

interface CushionMapProps {
  cushions: Cushion[];
  customers: Customer[];
  onEditCustomer: (customer: Customer) => void;
  roomConfig: RoomConfig;
  pickRequestId: string | null;
  onClearPickRequest: () => void;
}

export default function CushionMap({ cushions, customers, onEditCustomer, roomConfig, pickRequestId, onClearPickRequest }: CushionMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [ticker, setTicker] = useState<number>(0);
  const [editExitState, setEditExitState] = useState<{ cushionId: string; customerId: string; currentTime: string } | null>(null);
  const [assignModalCushion, setAssignModalCushion] = useState<Cushion | null>(null);
  const [openMenuCushionId, setOpenMenuCushionId] = useState<string | null>(null);
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);

  const dragInfo = useRef<{
    active: boolean;
    cushionId: string;
    targetIds: string[];
    origins: { [id: string]: { x: number; y: number } };
    startPointer: { x: number; y: number };
  } | null>(null);
  const dragMoved = useRef<boolean>(false);

  const cushionPct = roomConfig.cushionSizeM * 22;
  const cushionHalfPct = cushionPct / 2;
  const shapeClipPath = `polygon(${roomConfig.shapePoints.map(p => `${p.x}% ${p.y}%`).join(', ')})`;

  // グループ情報を構築
  const groupMap = new Map<string, Cushion[]>();
  cushions.forEach(c => {
    if (!c.groupId) return;
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, []);
    groupMap.get(c.groupId)!.push(c);
  });
  const groupCustomer = new Map<string, Customer | null>();
  groupMap.forEach((groupCushions, groupId) => {
    const occupied = groupCushions.find(c => c.customerId);
    groupCustomer.set(groupId, occupied?.customerId ? (customers.find(c => c.id === occupied.customerId) || null) : null);
  });

  useEffect(() => {
    const interval = setInterval(() => setTicker(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!openMenuCushionId) return;
    const close = () => setOpenMenuCushionId(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openMenuCushionId]);

  useEffect(() => {
    if (!linkingFromId) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[id^="cushion-card-"]')) return;
      setLinkingFromId(null);
    };
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, [linkingFromId]);

  void ticker;

  const getMinutesRemaining = (exitTimeStr: string | null) => {
    if (!exitTimeStr) return 999;
    const [hStr, mStr] = exitTimeStr.split(':');
    const now = new Date();
    const exitDate = new Date(now);
    exitDate.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0);
    return Math.ceil((exitDate.getTime() - now.getTime()) / 60000);
  };

  const adjustTime = (timeStr: string, deltaMinutes: number): string => {
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + deltaMinutes;
    const norm = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
  };

  const openExitEdit = (cushionId: string, customerId: string, exitTimePlanned: string | null) => {
    const now = new Date();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setEditExitState({ cushionId, customerId, currentTime: exitTimePlanned || defaultTime });
  };

  const saveExitTime = async () => {
    if (!editExitState) return;
    try {
      await updateDoc(doc(db, 'customers', editExitState.customerId), { exitTimePlanned: editExitState.currentTime });
      setEditExitState(null);
    } catch (err) {
      console.error('Error updating exit time', err);
    }
  };

  const handleAddCushion = async () => {
    const id = `cushion-${Date.now()}`;
    const labelsInUse = cushions.map(c => c.label);
    let nextNum = cushions.length + 1;
    while (labelsInUse.includes(String(nextNum).padStart(2, '0'))) nextNum++;
    const newCushion: Cushion = { id, label: String(nextNum).padStart(2, '0'), x: 40 + Math.random() * 10, y: 40 + Math.random() * 10, groupId: null, customerId: null };
    try { await setDoc(doc(db, 'cushions', id), newCushion); } catch (e) { console.error(e); }
  };

  const handleDeleteCushion = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cushion = cushions.find(c => c.id === id);
    if (!cushion) return;
    const msg = cushion.customerId ? '⚠️ この座布団には現在お客様が着席中です！\n本当に削除しますか？' : '本当にこの座布団を削除しますか？';
    if (!window.confirm(msg)) return;
    try { await deleteDoc(doc(db, 'cushions', id)); setSelectedIds(prev => prev.filter(i => i !== id)); } catch (e) { console.error(e); }
  };

  const handleCheckOut = async (cushion: Cushion, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cushion.customerId) return;
    const customer = customers.find(c => c.id === cushion.customerId);
    if (!window.confirm(`${customer?.ticketNumber || '着席中のお客様'} を退室しますか？\n(関連する全座布団が空席になります)`)) return;
    try {
      const batch = writeBatch(db);
      cushions.filter(c => c.customerId === cushion.customerId).forEach(c => batch.update(doc(db, 'cushions', c.id), { customerId: null }));
      batch.update(doc(db, 'customers', cushion.customerId), { status: 'completed', updatedAt: Date.now() });
      await batch.commit();
    } catch (err) { console.error(err); }
  };

  const handleCushionClick = (cushionId: string) => {
    if (isSelectMode) setSelectedIds(prev => prev.includes(cushionId) ? prev.filter(id => id !== cushionId) : [...prev, cushionId]);
  };

  const handleGroupCushions = async () => {
    if (selectedIds.length < 2) return;
    const newGroupId = `group-${Date.now()}`;
    const batch = writeBatch(db);
    selectedIds.forEach(id => batch.update(doc(db, 'cushions', id), { groupId: newGroupId }));
    try { await batch.commit(); setSelectedIds([]); setIsSelectMode(false); } catch (e) { console.error(e); }
  };

  const handleUngroupCushions = async () => {
    const groupIdsToUngroup = new Set<string>();
    cushions.forEach(c => { if (selectedIds.includes(c.id) && c.groupId) groupIdsToUngroup.add(c.groupId); });
    const batch = writeBatch(db);
    cushions.filter(c => c.groupId && groupIdsToUngroup.has(c.groupId)).forEach(c => batch.update(doc(db, 'cushions', c.id), { groupId: null }));
    try { await batch.commit(); setSelectedIds([]); setIsSelectMode(false); } catch (e) { console.error(e); }
  };

  const handleRemoveFromGroup = async (cushionId: string) => {
    try { await updateDoc(doc(db, 'cushions', cushionId), { groupId: null }); } catch (e) { console.error(e); }
  };

  const handleLinkTo = async (targetCushion: Cushion) => {
    if (!linkingFromId) return;
    const srcCushion = cushions.find(c => c.id === linkingFromId);
    if (!srcCushion) { setLinkingFromId(null); return; }
    const newGroupId = targetCushion.groupId || srcCushion.groupId || `group-${Date.now()}`;
    const batch = writeBatch(db);
    batch.update(doc(db, 'cushions', srcCushion.id), { groupId: newGroupId });
    batch.update(doc(db, 'cushions', targetCushion.id), { groupId: newGroupId });
    try { await batch.commit(); } catch (e) { console.error(e); }
    setLinkingFromId(null);
  };

  const handlePointerDown = (cushion: Cushion, e: React.PointerEvent) => {
    if (isSelectMode) return;
    e.preventDefault();
    dragMoved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const targetIds = cushion.groupId ? cushions.filter(c => c.groupId === cushion.groupId).map(c => c.id) : [cushion.id];
    const origins: { [id: string]: { x: number; y: number } } = {};
    targetIds.forEach(id => { const c = cushions.find(i => i.id === id); if (c) origins[id] = { x: c.x, y: c.y }; });
    dragInfo.current = { active: true, cushionId: cushion.id, targetIds, origins, startPointer: { x: e.clientX, y: e.clientY } };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragInfo.current?.active || !mapRef.current) return;
    const mapRect = mapRef.current.getBoundingClientRect();
    const deltaX = e.clientX - dragInfo.current.startPointer.x;
    const deltaY = e.clientY - dragInfo.current.startPointer.y;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) dragMoved.current = true;
    const dpX = (deltaX / mapRect.width) * 100;
    const dpY = (deltaY / mapRect.height) * 100;
    dragInfo.current.targetIds.forEach(id => {
      const origin = dragInfo.current!.origins[id];
      if (origin) {
        const newX = Math.min(Math.max(origin.x + dpX, cushionHalfPct), 100 - cushionHalfPct);
        const newY = Math.min(Math.max(origin.y + dpY, cushionHalfPct), 100 - cushionHalfPct);
        const el = document.getElementById(`cushion-card-${id}`);
        if (el) { el.style.left = `${newX}%`; el.style.top = `${newY}%`; }
      }
    });
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    if (!dragInfo.current?.active || !mapRef.current) return;
    const drag = dragInfo.current;
    dragInfo.current = null;
    const mapRect = mapRef.current.getBoundingClientRect();
    const deltaX = e.clientX - drag.startPointer.x;
    const deltaY = e.clientY - drag.startPointer.y;
    const dpX = (deltaX / mapRect.width) * 100;
    const dpY = (deltaY / mapRect.height) * 100;
    const batch = writeBatch(db);
    let changed = false;
    drag.targetIds.forEach(id => {
      const origin = drag.origins[id];
      if (origin && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
        changed = true;
        const finalX = Math.min(Math.max(origin.x + dpX, cushionHalfPct), 100 - cushionHalfPct);
        const finalY = Math.min(Math.max(origin.y + dpY, cushionHalfPct), 100 - cushionHalfPct);
        batch.update(doc(db, 'cushions', id), { x: finalX, y: finalY });
      }
    });
    if (changed) { try { await batch.commit(); } catch (err) { console.error(err); } }
    else { setTicker(t => t + 1); }
  };

  const seatCustomerOnCushion = async (customer: Customer, targetCushion: Cushion) => {
    if (targetCushion.customerId) { alert('⚠️ この座席にはすでに別のお客様が着席しています。'); return; }
    const batch = writeBatch(db);
    let seatedTime = '';
    let exitTimePlanned = '';
    let matchedCust: Customer | null = null;
    if (targetCushion.groupId) {
      for (const sibling of cushions.filter(c => c.groupId === targetCushion.groupId && c.id !== targetCushion.id)) {
        if (sibling.customerId) { const ac = customers.find(c => c.id === sibling.customerId && c.status === 'seated'); if (ac) { matchedCust = ac; break; } }
      }
    }
    if (matchedCust) { seatedTime = matchedCust.seatedTime || ''; exitTimePlanned = matchedCust.exitTimePlanned || ''; }
    else {
      const now = new Date();
      seatedTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      now.setMinutes(now.getMinutes() + 60);
      exitTimePlanned = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }
    batch.update(doc(db, 'cushions', targetCushion.id), { customerId: customer.id });
    batch.update(doc(db, 'customers', customer.id), { status: 'seated', seatedTime, exitTimePlanned });
    await batch.commit();
  };

  const handleAssignPickedRequest = async (targetCushion: Cushion) => {
    if (!pickRequestId || targetCushion.customerId) return;
    const customer = customers.find(c => c.id === pickRequestId);
    if (!customer) return;
    try { await seatCustomerOnCushion(customer, targetCushion); onClearPickRequest(); } catch (err) { console.error(err); }
  };

  const handleDropOnCushion = async (targetCushion: Cushion, e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.type === 'customer') {
        const customer = customers.find(c => c.id === data.customerId);
        if (customer) await seatCustomerOnCushion(customer, targetCushion);
      } else if (data.type === 'cushion_swap') {
        const src = cushions.find(c => c.id === data.cushionId);
        if (!src || src.id === targetCushion.id) return;
        if (targetCushion.customerId) { alert('⚠️ 移動先の座席には既にお客様が着席しています。'); return; }
        const batch = writeBatch(db);
        batch.update(doc(db, 'cushions', src.id), { customerId: targetCushion.customerId || null });
        batch.update(doc(db, 'cushions', targetCushion.id), { customerId: src.customerId || null });
        await batch.commit();
      }
    } catch (err) { console.error(err); }
  };

  const handleCushionLabelChange = async (cushionId: string, currentLabel: string) => {
    const newLabel = window.prompt('座布団の名称を入力してください（例: 01, A2, 桜）', currentLabel);
    if (!newLabel?.trim()) return;
    try { await updateDoc(doc(db, 'cushions', cushionId), { label: newLabel.trim() }); } catch (err) { console.error(err); }
  };

  const groupColors: { [id: string]: string } = {};
  let colorIdx = 0;
  const borderPalette = ['border-natural-clay', 'border-natural-olive', 'border-natural-moss'];
  cushions.forEach(c => {
    if (c.groupId && !groupColors[c.groupId]) { groupColors[c.groupId] = borderPalette[colorIdx % borderPalette.length]; colorIdx++; }
  });

  return (
    <div className="flex-1 flex flex-col bg-natural-beige rounded border border-natural-border overflow-hidden shadow-sm min-h-[500px]">
      {/* ツールバー */}
      <div className="bg-[#FAF7F2] border-b border-natural-border px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1 h-4 bg-natural-clay rounded-sm shrink-0" />
          <span className="text-natural-wood font-bold text-sm tracking-wide">休憩室マップ</span>
          <span className="text-xs text-natural-wood/60 font-medium">{cushions.length}個の座布団</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds([]); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold select-none cursor-pointer border transition-all ${isSelectMode ? 'bg-natural-clay/20 border-natural-clay text-natural-wood shadow-sm' : 'bg-white border-natural-border text-natural-wood hover:bg-natural-beige'}`}>
            {isSelectMode ? <Check size={14} /> : <Link size={14} />}
            <span>{isSelectMode ? '連結選択中' : '座布団を連結する'}</span>
          </button>
          {isSelectMode && selectedIds.length >= 2 && (
            <button onClick={handleGroupCushions} className="flex items-center gap-1 px-3 py-1.5 bg-natural-moss text-white rounded text-xs font-bold shadow-sm animate-pulse cursor-pointer">
              <Link size={14} /><span>選択した座布団を連結</span>
            </button>
          )}
          {isSelectMode && selectedIds.length > 0 && cushions.some(c => selectedIds.includes(c.id) && c.groupId) && (
            <button onClick={handleUngroupCushions} className="flex items-center gap-1 px-3 py-1.5 bg-rose-50 border border-rose-200 text-[#FF6B6B] rounded text-xs font-bold cursor-pointer">
              <Unlink size={14} /><span>結合を解除</span>
            </button>
          )}
          <button onClick={handleAddCushion} className="flex items-center gap-1.5 px-3 py-1.5 bg-natural-olive hover:bg-[#4A2F18] text-white rounded text-xs font-bold cursor-pointer transition-colors shadow-sm">
            <Plus size={14} /><span>座布団追加</span>
          </button>
        </div>
      </div>


      {linkingFromId && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center justify-between text-xs text-blue-800 shrink-0">
          <span>🔗 <strong>連結先を選択:</strong> 連結したい座布団をクリックしてください。同じ座布団をクリックするとキャンセルします。</span>
          <button onClick={() => setLinkingFromId(null)} className="font-bold hover:underline cursor-pointer">キャンセル</button>
        </div>
      )}

      {/* マップ本体 */}
      <div className="flex-1 overflow-hidden m-4 rounded shadow-inner border border-natural-border bg-natural-sand">
        <div
          ref={mapRef}
          className="w-full h-full relative select-none touch-none"
          style={{
            clipPath: shapeClipPath,
            backgroundImage: `radial-gradient(#D3C8B7 2px, transparent 2px), linear-gradient(to right, rgb(225,220,210) 1px, transparent 1px), linear-gradient(to bottom, rgb(225,220,210) 1px, transparent 1px)`,
            backgroundSize: '24px 24px, 10% 10%, 10% 10%',
          }}
          onPointerMove={handlePointerMove}
        >
          <div className="absolute top-4 left-4 text-xs font-bold text-natural-wood/40 uppercase tracking-widest font-mono pointer-events-none">畳 Rest Area Map</div>
          <div className="absolute bottom-4 right-4 text-xs font-bold text-natural-wood/30 font-mono pointer-events-none">← 床の間 / 出入口</div>

          {/* 座布団カード */}
          {cushions.map(cushion => {
            const customer = cushion.customerId ? customers.find(c => c.id === cushion.customerId) : null;
            const isSelected = selectedIds.includes(cushion.id);
            const hasGroup = cushion.groupId !== null;
            const isGroupedOccupied = cushion.groupId ? !!(groupCustomer.get(cushion.groupId)) : false;
            const isAssignable = pickRequestId !== null && !customer;

            // グループ着席中かつ自身も着席中のカードはラベルのみ（オーバーレイに情報あり）、空席は通常表示
            const showMinimalCard = isGroupedOccupied && !!customer;

            let cardColor = 'bg-white/40 border-2 border-dashed border-natural-border hover:bg-white/50';
            let durationText = '';
            let durationBg = 'bg-natural-moss text-white';
            let timeRemaining = 999;

            if (customer) {
              timeRemaining = getMinutesRemaining(customer.exitTimePlanned);
              if (timeRemaining <= 0) {
                cardColor = 'bg-[#FFF5F5] border border-[#FF6B6B]/60 border-b-4 border-[#FF6B6B] shadow-lg';
                durationText = `超過 ${Math.abs(timeRemaining)}分`;
                durationBg = 'bg-[#FF6B6B] text-white';
              } else if (timeRemaining <= 5) {
                // 5分前に黄色（従来10分→5分に変更）
                cardColor = 'bg-[#FFFAE6] border border-[#FFD966]/60 border-b-4 border-[#FFD966] shadow-md';
                durationText = `あと ${timeRemaining}分`;
                durationBg = 'bg-[#FFD966] text-amber-950';
              } else {
                cardColor = 'bg-natural-cream border border-natural-border/60 border-b-4 border-natural-border shadow-md';
                durationText = `あと ${timeRemaining}分`;
              }
            }

            return (
              <div
                key={cushion.id}
                id={`cushion-card-${cushion.id}`}
                style={{
                  left: `${cushion.x}%`,
                  top: `${cushion.y}%`,
                  position: 'absolute',
                  transform: 'translate(-50%, -50%)',
                  zIndex: dragInfo.current?.cushionId === cushion.id ? 50 : (customer ? 20 : 10),
                  width: `${cushionPct}%`,
                  ...(showMinimalCard ? { aspectRatio: '1/1' } : {}),
                }}
                onPointerDown={(e) => handlePointerDown(cushion, e)}
                onPointerUp={handlePointerUp}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDropOnCushion(cushion, e)}
                onClick={() => {
                  if (dragMoved.current) return;
                  if (linkingFromId) {
                    if (cushion.id !== linkingFromId) handleLinkTo(cushion);
                    else setLinkingFromId(null);
                  } else if (isAssignable) handleAssignPickedRequest(cushion);
                  else if (isSelectMode) handleCushionClick(cushion.id);
                  else if (!customer) setAssignModalCushion(cushion);
                }}
                className={`rounded-md border overflow-hidden transition-all select-none ${
                  showMinimalCard ? 'flex items-center justify-center cursor-pointer' : 'flex flex-col p-2 justify-between cursor-move'
                } ${cardColor} ${
                  isSelected ? 'ring-4 ring-natural-clay/60 scale-105' : ''
                } ${
                  hasGroup ? `border-2 ${groupColors[cushion.groupId!] || ''}` : ''
                } ${
                  isAssignable ? 'ring-4 ring-natural-clay shadow-[0_0_14px_rgba(139,105,20,0.7)] cursor-pointer animate-pulse' : ''
                } ${
                  !isAssignable && timeRemaining > 0 && timeRemaining <= 5 ? 'animate-pulse' : ''
                } ${
                  linkingFromId === cushion.id ? 'ring-4 ring-blue-500 scale-105 cursor-pointer' : ''
                } ${
                  linkingFromId && linkingFromId !== cushion.id ? 'ring-2 ring-blue-300 hover:ring-blue-500 cursor-pointer' : ''
                }`}
              >
                {showMinimalCard ? (
                  // グループ着席中：ラベルのみ（オーバーレイに情報表示）
                  <div className="flex flex-col items-center justify-center w-full h-full relative px-0.5">
                    <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleDeleteCushion(cushion.id, e); }}
                      className="absolute top-0.5 right-0.5 text-natural-clay hover:text-[#FF6B6B] p-0.5 cursor-pointer z-10"><Trash2 size={9} /></button>
                    <span className="font-mono font-extrabold text-xs text-natural-wood leading-none">{cushion.label}</span>
                    {customer && <span className="text-[11px] font-bold opacity-60 leading-none truncate max-w-full">{customer.ticketNumber}</span>}
                  </div>
                ) : (
                  // フル表示（常時：入室時間・退出時間・人数・管理番号を全て表示）
                  <>
                    {/* ヘッダー行：席ラベル ＋ ハンバーガーメニュー */}
                    <div className="flex items-center justify-between text-xs border-b border-natural-border/60 pb-1 mb-1 shrink-0">
                      <div className="flex items-center gap-1">
                        <span onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleCushionLabelChange(cushion.id, cushion.label); }}
                          className="font-mono font-bold bg-[#FAF7F2] hover:bg-natural-khaki px-1.5 rounded cursor-pointer text-natural-wood border border-natural-border/40 text-xs">
                          席{cushion.label}
                        </span>
                        {cushion.groupId && <span className="bg-natural-clay text-white text-[10px] px-1 rounded-sm font-semibold">連動</span>}
                      </div>
                      <div className="relative">
                        <button
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); setOpenMenuCushionId(prev => prev === cushion.id ? null : cushion.id); }}
                          className="text-natural-wood/50 hover:text-natural-wood p-0.5 rounded hover:bg-natural-khaki cursor-pointer"
                        >
                          <MoreVertical size={13} />
                        </button>
                        {openMenuCushionId === cushion.id && (
                          <div onPointerDown={e => e.stopPropagation()} className="absolute right-0 top-full mt-0.5 bg-white border border-natural-border rounded shadow-xl z-50 min-w-[104px] py-0.5">
                            {customer && (
                              <button
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => { e.stopPropagation(); onEditCustomer(customer); setOpenMenuCushionId(null); }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-natural-khaki text-natural-wood font-bold cursor-pointer"
                              >
                                人数変更
                              </button>
                            )}
                            <button
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); setLinkingFromId(cushion.id); setOpenMenuCushionId(null); }}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-blue-700 font-bold cursor-pointer"
                            >
                              🔗 連結する
                            </button>
                            {cushion.groupId && (
                              <button
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => { e.stopPropagation(); handleRemoveFromGroup(cushion.id); setOpenMenuCushionId(null); }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 text-amber-700 font-bold cursor-pointer"
                              >
                                🔓 連結を解除
                              </button>
                            )}
                            <button
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); handleDeleteCushion(cushion.id, e); setOpenMenuCushionId(null); }}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-[#FFF5F5] text-[#FF6B6B] font-bold cursor-pointer"
                            >
                              座布団削除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 flex flex-col items-center justify-center text-center min-h-0">
                      {customer ? (
                        <div draggable onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'cushion_swap', cushionId: cushion.id, customerId: customer.id }))}
                          className="w-full cursor-grab active:cursor-grabbing">
                          {/* 管理番号・人数 */}
                          <div className="font-mono text-sm font-extrabold text-natural-wood flex items-center justify-center gap-1 flex-wrap leading-tight">
                            {customer.ticketNumber}
                            <span className="text-[11px] bg-natural-khaki px-1.5 rounded-sm font-sans font-semibold">{customer.groupSize}名</span>
                          </div>
                          {/* 入室時間（小さく） */}
                          <div className="text-[10px] text-natural-wood/45 mt-1 font-medium">
                            入室 {customer.seatedTime}
                          </div>
                          {/* 退出時間（大きく・明確にタップ可） */}
                          <button
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); openExitEdit(cushion.id, customer.id, customer.exitTimePlanned); }}
                            className="mt-1 w-full bg-[#FAF7F2] hover:bg-natural-khaki border border-dashed border-natural-clay/50 rounded-md px-1 py-1.5 flex items-center justify-center gap-1 cursor-pointer transition-all group"
                            title="タップで退出時間を変更"
                          >
                            <span className="font-mono font-extrabold text-base text-natural-wood group-hover:text-natural-clay leading-none">
                              {customer.exitTimePlanned || '--:--'}
                            </span>
                            <Edit3 size={12} className="text-natural-clay shrink-0" />
                          </button>
                          <div className="text-[9px] text-natural-clay/60 mt-0.5 font-medium">退出予定（タップで変更）</div>
                          {/* 残り時間バッジ */}
                          <div className={`mt-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5 ${durationBg} ${timeRemaining <= 0 ? 'animate-pulse' : ''}`}>
                            <Clock size={9} /><span>{durationText}</span>
                          </div>
                        </div>
                      ) : (
                        <div className={`text-xs py-1.5 font-bold flex flex-col items-center ${isAssignable ? 'text-natural-clay' : 'text-[#8B7E6D]'}`}>
                          <span>空席</span>
                          <p className={`text-[8px] mt-0.5 ${isAssignable ? 'text-natural-clay/80' : 'text-[#8B7E6D]/60'}`}>
                            {isAssignable ? 'クリックで着席' : 'タップで着席'}
                          </p>
                        </div>
                      )}
                    </div>

                    {customer && (
                      <div className="mt-1 pt-1 border-t border-natural-border/60 shrink-0">
                        <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleCheckOut(cushion, e); }}
                          className="w-full py-1 text-xs bg-[#FF6B6B] hover:bg-[#E05A5A] text-white rounded font-extrabold cursor-pointer">
                          退室
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* グループオーバーレイ：グループ座布団にまたがって情報表示 */}
          {Array.from(groupMap.entries()).map(([groupId, groupCushions]) => {
            const cust = groupCustomer.get(groupId);
            if (!cust) return null;
            const xs = groupCushions.map(c => c.x);
            const ys = groupCushions.map(c => c.y);
            const minX = Math.min(...xs) - cushionHalfPct;
            const minY = Math.min(...ys) - cushionHalfPct;
            const maxX = Math.max(...xs) + cushionHalfPct;
            const maxY = Math.max(...ys) + cushionHalfPct;
            const timeRem = getMinutesRemaining(cust.exitTimePlanned);
            const occupiedCushion = groupCushions.find(c => c.customerId);
            const timerColor = timeRem <= 0 ? 'text-red-500' : timeRem <= 5 ? 'text-amber-600' : 'text-natural-moss';

            return (
              <div key={`overlay-${groupId}`} style={{ position: 'absolute', left: `${minX}%`, top: `${minY}%`, width: `${maxX - minX}%`, height: `${maxY - minY}%`, zIndex: 25, pointerEvents: 'none' }}
                className="flex items-center justify-center">
                <div className="bg-natural-cream/96 border-2 border-natural-clay/60 rounded-lg shadow-xl pointer-events-auto text-center w-full max-w-[94%] px-2 py-1.5">
                  {/* 管理番号・人数 */}
                  <div className="font-mono font-extrabold text-sm text-natural-wood">{cust.ticketNumber}</div>
                  <div className="text-xs font-bold text-natural-wood/80">{cust.groupSize}名</div>
                  {/* 入室時間→退出時間（退出時間クリックで編集） */}
                  <div className="text-[11px] text-natural-wood/70 flex items-center justify-center gap-0.5">
                    <span>{cust.seatedTime}</span><span>→</span>
                    <span
                      onClick={e => { e.stopPropagation(); if (occupiedCushion?.customerId) openExitEdit(occupiedCushion.id, occupiedCushion.customerId, cust.exitTimePlanned); }}
                      className="font-extrabold text-natural-wood cursor-pointer hover:text-natural-clay hover:underline flex items-center gap-0.5"
                      title="クリックで退出時間を変更"
                    >
                      {cust.exitTimePlanned}<Edit3 size={8} className="text-natural-clay opacity-60" />
                    </span>
                  </div>
                  <div className={`text-[10px] font-bold ${timerColor} ${timeRem <= 0 ? 'animate-pulse' : ''}`}>
                    {timeRem <= 0 ? `超過${Math.abs(timeRem)}分` : `あと${timeRem}分`}
                  </div>
                  {occupiedCushion && (
                    <button onClick={e => handleCheckOut(occupiedCushion, e)} onPointerDown={e => e.stopPropagation()}
                      className="mt-1 px-2 py-0.5 text-xs bg-[#FF6B6B] hover:bg-[#E05A5A] text-white rounded font-bold cursor-pointer w-full">
                      退室
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 空席クリック → 顧客選択モーダル */}
      {assignModalCushion && !assignModalCushion.customerId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[60]" onClick={() => setAssignModalCushion(null)}>
          <div className="bg-white rounded border border-natural-border shadow-2xl p-4 max-w-sm w-full text-natural-wood" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b-2 border-natural-clay mb-3">
              <span className="font-bold text-sm flex items-center gap-1.5">
                <Check size={14} className="text-natural-clay" />
                席 {assignModalCushion.label} へ着席
              </span>
              <button onClick={() => setAssignModalCushion(null)} className="text-natural-clay hover:text-natural-wood cursor-pointer"><X size={16} /></button>
            </div>
            {(() => {
              const available = customers
                .filter(c => ['waiting', 'called', 'moving'].includes(c.status))
                .sort((a, b) => a.seq - b.seq);
              if (available.length === 0) {
                return <p className="text-xs text-natural-wood/60 py-6 text-center">着席可能なお客様がいません</p>;
              }
              const statusLabel: Record<string, string> = { waiting: '待機', called: '呼出中', moving: '移動中' };
              const statusColor: Record<string, string> = {
                waiting: 'bg-natural-khaki text-natural-wood',
                called: 'bg-amber-100 text-amber-800',
                moving: 'bg-green-100 text-natural-moss',
              };
              return (
                <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                  {available.map(cust => (
                    <button key={cust.id}
                      onClick={async () => {
                        try { await seatCustomerOnCushion(cust, assignModalCushion); setAssignModalCushion(null); }
                        catch (err) { console.error(err); }
                      }}
                      className="flex items-center justify-between px-3 py-2.5 rounded border border-natural-border hover:bg-natural-khaki cursor-pointer text-left transition-all w-full">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-extrabold text-natural-wood text-sm">{cust.ticketNumber}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusColor[cust.status] || ''}`}>
                          {statusLabel[cust.status] || cust.status}
                        </span>
                      </div>
                      <span className="text-xs text-natural-wood/70 font-semibold">{cust.groupSize}名</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 退出時間変更モーダル */}
      {editExitState && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[60]" onClick={() => setEditExitState(null)}>
          <div className="bg-white rounded border border-natural-border shadow-2xl p-4 max-w-xs w-full text-natural-wood" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b-2 border-natural-clay mb-3">
              <span className="font-bold text-sm flex items-center gap-1.5"><Clock size={14} className="text-natural-clay" />退出時間の変更</span>
              <button onClick={() => setEditExitState(null)} className="text-natural-clay hover:text-natural-wood cursor-pointer"><X size={16} /></button>
            </div>
            {(() => {
              const cust = customers.find(c => c.id === editExitState.customerId);
              return cust ? <div className="text-xs text-natural-wood/60 mb-3 font-medium">{cust.ticketNumber} / {cust.groupSize}名</div> : null;
            })()}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-natural-clay whitespace-nowrap">退出時間</label>
                <input
                  type="time"
                  value={editExitState.currentTime}
                  onChange={e => setEditExitState(prev => prev ? { ...prev, currentTime: e.target.value } : null)}
                  className="flex-1 h-9 px-2 border border-natural-border rounded text-sm font-bold font-mono focus:outline-none focus:border-natural-clay bg-[#FAF7F2]/40"
                />
              </div>
              <div className="flex gap-2">
                {([5, 10] as const).map(delta => (
                  <button key={delta} onClick={() => setEditExitState(prev => prev ? { ...prev, currentTime: adjustTime(prev.currentTime, delta) } : null)}
                    className="flex-1 py-2.5 rounded text-sm font-bold cursor-pointer border bg-green-50 border-green-200 text-green-700 hover:bg-green-100 transition-all">
                    +{delta}分
                  </button>
                ))}
              </div>
              <button onClick={saveExitTime} className="w-full py-2.5 bg-natural-olive hover:bg-natural-olive/90 text-white rounded text-xs font-extrabold cursor-pointer shadow-md">
                変更を保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
