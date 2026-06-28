import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Bell, ArrowRight, ArrowLeft, Trash2, ShieldAlert, Lock, Play, Pause } from 'lucide-react';
import { Customer, SystemConfig } from '../types';
import { db, doc, updateDoc, setDoc } from '../firebase';

interface QueueSidebarProps {
  customers: Customer[];
  config: SystemConfig;
  pickRequestId: string | null;
  onToggleSelectRequest: (customerId: string) => void;
}

export default function QueueSidebar({ customers, config, pickRequestId, onToggleSelectRequest }: QueueSidebarProps) {
  const [groupSize, setGroupSize] = useState<number>(2);
  const [seqLabelInput, setSeqLabelInput] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [ticker, setTicker] = useState<number>(0);

  // Update timer remaining estimates locally every 10 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setTicker(t => t + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Filter customers by status
  const waitingCustomers = customers.filter(c => c.status === 'waiting').sort((a,b) => a.createdAt - b.createdAt);
  const calledCustomers = customers.filter(c => c.status === 'called').sort((a,b) => a.createdAt - b.createdAt);
  const movingCustomers = customers.filter(c => c.status === 'moving').sort((a,b) => a.createdAt - b.createdAt);
  const seatedCustomers = customers.filter(c => c.status === 'seated').sort((a,b) => a.createdAt - b.createdAt);

  const activeSeatedCount = seatedCustomers.reduce((sum, c) => sum + c.groupSize, 0);
  const activeMovingCount = movingCustomers.reduce((sum, c) => sum + c.groupSize, 0);
  const totalOccupied = activeSeatedCount + activeMovingCount;
  const isCapacityReached = totalOccupied >= config.capacity;

  // Utility to parse planned exit time and get remaining minutes
  const getMinutesRemaining = (exitTimeStr: string | null) => {
    if (!exitTimeStr) return 999;
    const [hStr, mStr] = exitTimeStr.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    const now = new Date();
    const exitDate = new Date(now);
    exitDate.setHours(h, m, 0, 0);

    const diffMs = exitDate.getTime() - now.getTime();
    return Math.ceil(diffMs / 60000);
  };

  // 4. PREDICTED WAITING TIME SIMULATION ALGORITHM (顧客待ち時間予測)
  // Calculates estimated wait minutes for each customer in the line
  const getEstimatedWaitTimes = () => {
    const estimates: { [id: string]: string } = {};

    // Get currently seated customers and their leaving timelines
    const departureEvents = seatedCustomers
      .map(c => ({
        id: c.id,
        size: c.groupSize,
        minsLeft: Math.max(getMinutesRemaining(c.exitTimePlanned), 0)
      }))
      .sort((a, b) => a.minsLeft - b.minsLeft);

    // Initial pool coordinates
    let simulatedOccupancy = totalOccupied;
    const currentCapacity = config.capacity;

    // Queue of candidates to get seated
    const queue = [...waitingCustomers, ...calledCustomers];

    queue.forEach(waitCust => {
      // If roommate capacity is not full and we have enough vacant capacity for this group
      if (simulatedOccupancy + waitCust.groupSize <= currentCapacity) {
        estimates[waitCust.id] = "待ち時間なし (即時案内可)";
        simulatedOccupancy += waitCust.groupSize; // Mark as virtually seated
      } else {
        // Need to wait for seating departure events to free up enough space
        let accumulatedWait = 0;
        let index = 0;

        while (index < departureEvents.length && simulatedOccupancy + waitCust.groupSize > currentCapacity) {
          const earliestRelease = departureEvents[index];
          simulatedOccupancy -= earliestRelease.size;
          accumulatedWait = earliestRelease.minsLeft;
          index++;
        }

        // Output estimation string
        if (simulatedOccupancy + waitCust.groupSize <= currentCapacity) {
          estimates[waitCust.id] = `あと約 ${accumulatedWait} 分`;
        } else {
          // If capacity is physically extremely small vs customer size, fallback gracefully
          estimates[waitCust.id] = `満員のため案内制限中`;
        }

        simulatedOccupancy += waitCust.groupSize; // Seated virtual simulation
      }
    });

    return estimates;
  };

  const waitEstimates = getEstimatedWaitTimes();

  // Create & Register a new ticket (チケット発券)
  const handleRegisterTicket = async (targetStatus: 'waiting' | 'moving') => {
    if (submitting) return;

    // 「移動中」へ直接発券する場合は、案内可能人数を超えないか事前にチェックする
    if (targetStatus === 'moving' && totalOccupied + groupSize > config.capacity) {
      alert("⚠️ 案内可能人数を超えるため、「移動中」へ直接発券できません。");
      return;
    }

    setSubmitting(true);

    try {
      const ticketId = `ticket-${Date.now()}`;
      const trimmedLabel = seqLabelInput.trim();
      const nextSeqFormatted = String(config.nextSeq).padStart(3, '0');
      const ticketNumber = trimmedLabel || `#${nextSeqFormatted}`;

      const newCustomer: Customer = {
        id: ticketId,
        ticketNumber,
        seq: config.nextSeq,
        groupSize,
        status: targetStatus,
        seatedTime: null,
        exitTimePlanned: null,
        createdAt: Date.now(),
      };

      // Set customer ticket and update state configuration counter
      await setDoc(doc(db, 'customers', ticketId), newCustomer);
      await updateDoc(doc(db, 'config', 'global'), {
        nextSeq: config.nextSeq + 1
      });
      setSeqLabelInput('');

    } catch (err) {
      console.error("Error creating ticket", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Calling Gate (呼び出しストップ)
  const handleToggleCalling = async () => {
    try {
      await updateDoc(doc(db, 'config', 'global'), { callingStopped: !config.callingStopped });
    } catch (err) {
      console.error(err);
    }
  };

  // Cancel a queued ticket(削除はせず、取消履歴として残し管理画面から復元できるようにする)
  const handleCancelTicket = async (id: string, ticketNum: string) => {
    if (!window.confirm(`${ticketNum} の受付をキャンセルしますか？\n(取消履歴に残り、管理設定画面から復元できます)`)) return;
    try {
      await updateDoc(doc(db, 'customers', id), { status: 'canceled', updatedAt: Date.now() });
    } catch (err) {
      console.error(err);
    }
  };

  // Transition customer status forward or backward
  const handleUpdateStatus = async (customer: Customer, nextStatus: Customer['status']) => {
    // If calling is stopped, prevent ticket operator triggers from going called or moving
    if (config.callingStopped && (nextStatus === 'called' || nextStatus === 'moving')) {
      alert("⚠️ 現在「呼び出し中止」モードが設定されています。受付操作が一時ロックされています。");
      return;
    }

    // Capacity check blocks entering "moving / 移動中" if capacity is strictly reached
    if (nextStatus === 'moving' && isCapacityReached) {
      alert("⚠️ 現在、浴場休憩室の利用人数が定員に達しているか超過しています。「移動中」への変更はロックされています。");
      return;
    }

    try {
      await updateDoc(doc(db, 'customers', customer.id), { status: nextStatus });
    } catch (err) {
      console.error(err);
    }
  };

  // Drag handles for HTML5 drag
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({
      type: 'customer',
      customerId: id
    }));
  };

  return (
    <div className="w-full lg:w-[420px] flex flex-col bg-[#FAF7F2] rounded border border-natural-border overflow-hidden shadow-sm h-full text-natural-wood">
      {/* 1. CAPACITY & CALLING CONFIGURATION PANEL (案内設定) */}
      <div className="bg-[#FAF7F2]/80 border-b border-natural-border p-4 shrink-0">
        <h3 className="text-xs font-bold text-natural-clay tracking-wider mb-3 flex items-center gap-1.5 pb-2 border-b border-natural-border">
          <ShieldAlert size={14} className="text-natural-clay" />
          休憩室・案内制限コントロール
        </h3>

        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-natural-wood/60 font-medium px-0.5">
            定員: <strong className="text-natural-wood">{config.capacity}名</strong>　稼働中: <strong className="text-natural-wood">{totalOccupied}名</strong>　（定員変更は「管理設定」から）
          </div>
          {/* Calling status toggle */}
          <button
            onClick={handleToggleCalling}
            className={`p-2.5 rounded border flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm ${
              config.callingStopped
                ? 'bg-[#FFF5F5] border-[#FF6B6B]/40 text-[#FF6B6B] hover:bg-[#FFF5F5]/80'
                : 'bg-[#FAF7F2]/30 border-natural-border text-[#425232] hover:bg-natural-khaki/30'
            }`}
          >
            {config.callingStopped ? <Play size={14} /> : <Pause size={14} />}
            <span className="text-xs font-extrabold">
              {config.callingStopped ? '再開する' : '一時停止'}
            </span>
            {config.callingStopped && (
              <span className="text-[10px] font-bold bg-[#FF6B6B]/10 px-1.5 py-0.5 rounded">停止中</span>
            )}
          </button>
        </div>
      </div>

      {/* 2. REGISTRATION TICKET CREATOR PANEL (チケット発券) */}
      <div className="border-b border-natural-border p-4 bg-white shrink-0">
        <h3 className="text-xs font-bold text-natural-clay tracking-wider mb-2.5 flex items-center gap-1 sm:gap-1.5 pb-2 border-b border-natural-border">
          <UserPlus size={14} className="text-natural-clay" />
          新規順番受付 (チケット発券)
        </h3>
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-[#8B7E6D] font-extrabold">グループ人数</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setGroupSize(Math.max(1, groupSize - 1))}
                className="w-14 h-14 rounded-xl text-3xl font-bold bg-natural-beige border-2 border-natural-clay/60 text-natural-clay hover:bg-natural-khaki cursor-pointer transition-all flex items-center justify-center select-none"
              >
                −
              </button>
              <span className="flex-1 text-center text-5xl font-extrabold text-natural-wood tabular-nums">
                {groupSize}
              </span>
              <button
                type="button"
                onClick={() => setGroupSize(groupSize + 1)}
                className="w-14 h-14 rounded-xl text-3xl font-bold bg-natural-clay text-white hover:bg-natural-clay/90 cursor-pointer transition-all flex items-center justify-center select-none"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#8B7E6D] font-extrabold whitespace-nowrap">受付番号(任意):</span>
            <input
              type="text"
              value={seqLabelInput}
              onChange={(e) => setSeqLabelInput(e.target.value)}
              placeholder={`未入力なら #${String(config.nextSeq).padStart(3, '0')}`}
              className="flex-1 h-9 px-2 border border-natural-border rounded text-xs font-bold focus:outline-none focus:border-natural-clay bg-[#FAF7F2]/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleRegisterTicket('waiting')}
              className="h-10 bg-[#8B7E6D] hover:bg-[#726657] text-white disabled:bg-stone-300 font-bold text-xs tracking-wider rounded shadow cursor-pointer transition-colors flex flex-col items-center justify-center leading-tight"
            >
              <span>待機中へ</span>
              <span className="text-[9px] text-white/80 font-mono">
                (現 #{String(config.nextSeq).padStart(3, '0')})
              </span>
            </button>
            <button
              type="button"
              disabled={submitting || config.callingStopped}
              onClick={() => handleRegisterTicket('moving')}
              className="h-10 bg-natural-olive hover:bg-[#4A2F18] text-natural-cream disabled:bg-stone-300 disabled:text-stone-400 font-bold text-xs tracking-wider rounded shadow cursor-pointer transition-colors flex flex-col items-center justify-center leading-tight"
            >
              <span>移動中へ</span>
              <span className="text-[9px] text-natural-cream/80 font-mono disabled:text-stone-400">
                {config.callingStopped ? '(停止中)' : `(現 #${String(config.nextSeq).padStart(3, '0')})`}
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* 3. CORE QUEUEING COLUMNS PANEL (待合 3 フェーズリスト) */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-natural-beige/30">
        
        {/* PHASE A: 移動中 / GUIDING/MOVING LIST */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-natural-olive uppercase tracking-widest flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-natural-olive block" />
              休憩室へ案内移動中 (Guiding / Moving)
            </span>
            <span className="bg-natural-khaki text-natural-wood text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm">
              {movingCustomers.length}組
            </span>
          </div>

          <div className="flex flex-col gap-1.5 min-h-[40px] max-h-[170px] overflow-y-auto border border-natural-border p-2 rounded bg-white/80">
            {movingCustomers.length === 0 ? (
              <span className="text-natural-clay text-[11px] text-center italic py-2">移動中のお客様はいません。<br/>ドラッグしてマップ座布団へ着席させてください。</span>
            ) : (
              movingCustomers.map(cust => {
                const isPicked = pickRequestId === cust.id;
                return (
                <div
                  key={cust.id}
                  data-req-card
                  draggable
                  onDragStart={(e) => handleDragStart(e, cust.id)}
                  onClick={() => onToggleSelectRequest(cust.id)}
                  className={`flex flex-col gap-2 p-2.5 border rounded shadow-sm cursor-pointer transition-all ${
                    isPicked
                      ? 'bg-[#F0F9F4] border-2 border-natural-moss ring-2 ring-natural-moss/30'
                      : 'bg-[#FAF7F2] border-natural-border cursor-grab active:cursor-grabbing'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-extrabold text-natural-wood text-sm">{cust.ticketNumber}</span>
                      <span className="text-xs bg-natural-khaki border border-natural-border/40 text-natural-wood px-1.5 py-0.5 rounded font-bold">{cust.groupSize}人</span>
                      {isPicked && <span className="text-[10px] text-natural-moss font-bold">選択中</span>}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Rollback button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(cust, 'called'); }}
                        className="text-natural-clay hover:text-[#4A433F] font-bold p-1 cursor-pointer flex items-center text-[10px] gap-0.5"
                        title="お呼び出しに戻す"
                      >
                        <ArrowLeft size={11} />
                        呼出に戻す
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCancelTicket(cust.id, cust.ticketNumber); }}
                        className="text-[#8B7E6D] hover:text-[#FF6B6B] p-1 cursor-pointer animate-none"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <p className="text-[10px] text-natural-wood/80 font-semibold bg-white/60 p-1.5 rounded border border-natural-border/30 flex items-center gap-1">
                    👉 <span>{isPicked ? 'マップ上で光っている空席をクリックすると着席します(再クリックで選択解除)' : 'クリックして座席を選ぶか、マップ座布団へドラッグ＆ドロップで着席開始'}</span>
                  </p>
                </div>
                );
              })
            )}
          </div>
        </div>

        {/* PHASE B: 呼び出し中 / CALLED LIST */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#D35400] uppercase tracking-widest flex items-center gap-1 animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-[#E67E22] block" />
              呼び出し中 (Called)
            </span>
            <span className="bg-[#FFFAE6] text-amber-900 border border-[#FFD966]/40 text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm">
              {calledCustomers.length}組
            </span>
          </div>

          <div className="flex flex-col gap-1.5 min-h-[40px] max-h-[170px] overflow-y-auto border border-natural-border p-2 rounded bg-white/80">
            {calledCustomers.length === 0 ? (
              <span className="text-natural-clay text-[11px] text-center italic py-2">お呼び出し中のお客様はいません</span>
            ) : (
              calledCustomers.map(cust => (
                <div
                  key={cust.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, cust.id)}
                  className="flex items-center justify-between p-2 bg-[#FFFAE6]/50 hover:bg-[#FFFAE6] border-2 border-[#FFD966] rounded shadow-sm cursor-grab active:cursor-grabbing text-[#5D4037] animate-pulse"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-amber-950 text-sm">{cust.ticketNumber}</span>
                    <span className="text-xs bg-[#FFFAE6] border border-[#FFD966]/40 text-amber-800 px-1.5 py-0.5 rounded font-bold">{cust.groupSize}人</span>
                    <span className="text-[10px] text-amber-800/80 bg-[#FFFAE6]/80 px-1 rounded font-medium">呼出案内中</span>
                  </div>

                  <div className="flex items-center gap-1 animate-none">
                    {/* Rollback button */}
                    <button
                      onClick={() => handleUpdateStatus(cust, 'waiting')}
                      className="text-[#8B7E6D] hover:text-[#4A433F] p-1 cursor-pointer flex items-center text-[10px] gap-0.5 font-bold"
                      title="待機に戻す"
                    >
                      <ArrowLeft size={11} />
                      戻す
                    </button>
                    <button
                      onClick={() => handleCancelTicket(cust.id, cust.ticketNumber)}
                      className="text-[#8B7E6D] hover:text-[#FF6B6B] p-1 cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(cust, 'moving')}
                      disabled={isCapacityReached || config.callingStopped}
                      className="flex items-center gap-0.5 px-2 py-1 bg-natural-moss disabled:bg-stone-300 disabled:text-stone-400 text-white font-bold text-[10px] rounded shadow-xs"
                      title="移動開始"
                    >
                      {isCapacityReached ? <Lock size={9} /> : null}
                      <span>誘導</span>
                      <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* PHASE C: 待機中 / WAIT LIST */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-natural-clay uppercase tracking-widest flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-natural-clay block" />
              待機中 (Waiting)
            </span>
            <span className="bg-natural-khaki text-natural-wood text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm">
              {waitingCustomers.length}組
            </span>
          </div>

          <div className="flex flex-col gap-1.5 min-h-[40px] max-h-[170px] overflow-y-auto border border-natural-border/60 p-2 rounded bg-white/80">
            {waitingCustomers.length === 0 ? (
              <span className="text-natural-clay text-[11px] text-center italic py-2">待機中のお客様はいません</span>
            ) : (
              waitingCustomers.map(cust => (
                <div
                  key={cust.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, cust.id)}
                  className="flex items-center justify-between p-2 bg-white hover:bg-[#FAF7F2] border border-natural-border/60 rounded shadow-sm transition-all cursor-grab active:cursor-grabbing"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-natural-wood text-sm tracking-tight">{cust.ticketNumber}</span>
                    <span className="text-xs text-natural-wood bg-natural-khaki px-1.5 py-0.5 rounded font-bold">{cust.groupSize}人</span>
                    <span className="text-[10px] text-natural-clay bg-natural-khaki/30 px-1.5 py-0.5 rounded-md font-medium">
                      ⏱️ {waitEstimates[cust.id] || '計算中...'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCancelTicket(cust.id, cust.ticketNumber)}
                      className="text-natural-clay hover:text-[#FF6B6B] p-1 cursor-pointer"
                      title="キャンセル"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(cust, 'called')}
                      disabled={config.callingStopped}
                      className="flex items-center gap-0.5 px-2 py-1 bg-natural-clay text-white hover:bg-[#8B7E6D] disabled:bg-stone-300 disabled:text-stone-400 font-bold text-[10px] rounded shadow-xs"
                      title="お呼び出し"
                    >
                      <span>呼出</span>
                      <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live capacity reminder box */}
        {isCapacityReached && (
          <div className="bg-[#FFF5F5] border border-[#FF6B6B]/40 rounded p-3 flex flex-col gap-1 text-red-950 shrink-0">
            <span className="text-xs font-bold flex items-center gap-1">
              <ShieldAlert size={14} className="text-[#FF6B6B] animate-bounce" />
              満席・入場制限作動中
            </span>
            <p className="text-[10px] leading-relaxed font-semibold bg-white/40 p-1.5 rounded">
              案内中人数合計 ({totalOccupied}名) が制限定員 ({config.capacity}名) に等しいか、超過しています。移動中（休憩室への誘導）への切り替えはシステムにより現在ロックされています。空席が発生するまでお待ちください。
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
