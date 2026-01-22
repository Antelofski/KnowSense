'use client';

import { memo, useRef, useEffect } from 'react';
import Tooltip from '@mui/material/Tooltip';

const ExpandedEssayView = memo(function ExpandedEssayView({
  workIndex,
  essayParts,
  parsedEssay,
  feedbackMappings,
  checklistItems,
  allFeedbacks,
  hoveredBlockKey,
  hoveredPartId,
  hoveredSegmentIds,
  tooltipPosition,
  partRefs,
  onSetHoveredBlockKey,
  onSetHoveredPartId,
  onSetHoveredSegmentIds,
  onSetTooltipPosition,
  getChecklistItemColor,
  clickedBlockKey,
  clickedPartIds,
  activePartKey,
  activeSegmentIds,
  onSetClickedBlockKey,
  onSetClickedPartIds,
  onSetActivePartKey,
  onSetActiveSegmentIds,
  essayChecklistStatus,
  isFeedbackMode = false,
}) {
  // 默认颜色函数
  const defaultGetChecklistItemColor = (itemId) => {
    const colors = [
      { bg: '#3b82f6', border: '#2563eb' },
      { bg: '#10b981', border: '#059669' },
      { bg: '#f59e0b', border: '#d97706' },
      { bg: '#ef4444', border: '#dc2626' },
      { bg: '#8b5cf6', border: '#7c3aed' },
      { bg: '#ec4899', border: '#db2777' },
      { bg: '#06b6d4', border: '#0891b2' },
      { bg: '#84cc16', border: '#65a30d' },
      { bg: '#f97316', border: '#ea580c' },
      { bg: '#6366f1', border: '#4f46e5' },
    ];
    return colors[(itemId - 1) % colors.length];
  };
  
  const getColor = getChecklistItemColor || defaultGetChecklistItemColor;
  const leftScrollContainerRef = useRef(null);
  const phase2Colors = ['green', 'red', 'blue', 'orange', 'purple', 'yellow', 'pink'];
  const colorClasses = {
    green: 'bg-green-200',
    red: 'bg-red-200',
    blue: 'bg-blue-200',
    orange: 'bg-orange-200',
    purple: 'bg-purple-200',
    yellow: 'bg-yellow-200',
    pink: 'bg-pink-200',
  };
  const colorHex = {
    green: '#4ade80',
    red: '#f87171',
    blue: '#60a5fa',
    orange: '#fb923c',
    purple: '#a78bfa',
    yellow: '#fbbf24',
    pink: '#f472b6',
  };

  // 当 activePartKey 变化时，左侧自动滚动到对应的分段
  useEffect(() => {
    if (!activePartKey) return;
    const scrollContainer = leftScrollContainerRef.current;
    if (!scrollContainer) return;

    const partElement = partRefs.current[activePartKey];
    if (!partElement) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = partElement.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;
    const targetScrollTop = scrollTop + elementRect.top - containerRect.top - 20;

    scrollContainer.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth',
    });
  }, [activePartKey, partRefs, workIndex]);

  return (
    <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200" style={{ height: '500px' }}>
      {/* 左侧：文章分段 */}
      <div className="flex flex-col h-full min-h-0">
        <h3 className="text-sm font-semibold text-slate-900 mb-2 shrink-0">Essay Content</h3>
        <div ref={leftScrollContainerRef} className="flex-1 overflow-y-auto space-y-3 pr-2 min-h-0">
            {essayParts.map((part) => {
            const partSegments = parsedEssay.segments.filter((seg) =>
              part.paragraph_ids?.includes(seg.id)
            );
            const partColor = phase2Colors[(part.id - 1) % phase2Colors.length];
            const isHoveredPart = hoveredPartId === part.id && hoveredBlockKey && hoveredBlockKey.startsWith(`${workIndex}-${part.id}-`);
            const partRefKey = `${workIndex}-${part.id}`;
            const isActivePart = activePartKey === partRefKey;
            const isHighlightedPart = isHoveredPart || isActivePart;
            
            return (
              <div
                key={part.id}
                ref={(el) => {
                  if (el) partRefs.current[partRefKey] = el;
                }}
                className={`p-3 rounded-lg border-2 transition-all ${
                  isHighlightedPart 
                    ? 'border-yellow-400 shadow-md' 
                    : 'border-slate-200'
                }`}
                style={{
                  backgroundColor: isHighlightedPart
                    ? `${colorClasses[partColor] || 'bg-slate-50'}CC`
                    : `${colorClasses[partColor] || 'bg-slate-50'}80`,
                }}
              >
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  {part.name}
                </div>
                <div className="text-gray-800 leading-relaxed text-xs">
                  {partSegments.length > 0 ? (
                    partSegments.map((seg, idx) => {
                      const isHoveredSegment = isHoveredPart && hoveredSegmentIds.has(seg.id);
                      const isActiveSegment =
                        isActivePart && activeSegmentIds.has(seg.id);
                      return (
                        <span
                          key={seg.id}
                          className={`px-1 py-0.5 rounded-sm transition-all duration-200 ${
                             (isHoveredSegment || isActiveSegment)
                              ? `${colorClasses[partColor] || 'bg-yellow-200'} shadow-[0_0_0_2px_rgba(251,191,36,0.8)]` 
                              : ''
                          }`}
                        >
                          {seg.text}
                          {idx < partSegments.length - 1 && ' '}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-slate-400 italic">
                      miss
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 右侧：知识清单网格 */}
      <div className="flex flex-col h-full min-h-0">
        <h3 className="text-sm font-semibold text-slate-900 mb-2 shrink-0">Knowledge Checklist Grid</h3>
        <div className="flex-1 overflow-y-auto bg-white border border-slate-200 rounded-lg p-2 min-h-0">
          <div className="w-full">
            {/* 表头 */}
            <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `30px repeat(${checklistItems.length}, 1fr)` }}>
              <div></div>
              {checklistItems.map((item) => (
                <div
                  key={item.id}
                  className="text-[10px] font-semibold text-slate-700 text-center p-1 bg-slate-50 rounded border border-slate-200"
                  title={item.description}
                >
                  {item.name}
                </div>
              ))}
            </div>
            
            {/* 网格内容 */}
            {essayParts.map((part) => {
              const partColor = phase2Colors[(part.id - 1) % phase2Colors.length];
              
              return (
                <div
                  key={part.id}
                  className="grid gap-1 mb-1"
                  style={{ gridTemplateColumns: `30px repeat(${checklistItems.length}, 1fr)` }}
                >
                  {/* 行标签 */}
                  <div
                    className="flex items-center justify-center text-[10px] font-semibold text-slate-700 p-1 rounded border border-slate-200 bg-slate-50"
                  >
                    Sec{part.id}
                  </div>
                  
                  {/* 方格内容 */}
                  {checklistItems.map((checklistItem) => {
                    const checklistMapping = essayChecklistStatus?.find(
                      (s) => s.id === checklistItem.id
                    );
                    const paragraphIds = checklistMapping?.paragraphIds || [];
                    const hasContent =
                      paragraphIds.length > 0 &&
                      part.paragraph_ids?.some((pid) =>
                        paragraphIds.includes(pid)
                    );
                    const columnColor = getColor(checklistItem.id);
                    const blockKey = `${workIndex}-${part.id}-${checklistItem.id}`;
                    const clickedKey = `${workIndex}-${checklistItem.id}`;

                    // 找出与该 Section + Checklist 相关的所有评论（用于 tooltip 展示）
                    const relatedFeedbacks = (feedbackMappings || [])
                      .filter((m) => {
                        if (!Array.isArray(m.essay_part_ids) || !Array.isArray(m.checklist_items)) {
                          return false;
                        }
                        return (
                          m.essay_part_ids.includes(part.id) &&
                          m.checklist_items.includes(checklistItem.id)
                        );
                      })
                      .map((m) => {
                        const fb = (allFeedbacks || []).find(
                          (f) =>
                            f.workIndex === workIndex &&
                            f.feedbackId === m.feedback_id
                        );
                        const title = (fb?.title || '').trim();
                        const text = (fb?.text || '').trim();
                        const isNegative = !!fb?.isNegative;
                        const isPositive = !!fb?.isPositive;
                        return {
                          id: m.feedback_id,
                          title,
                          text,
                          isNegative,
                          isPositive,
                        };
                      })
                      .filter((fb) => fb && (fb.title || fb.text));

                    // 点击高亮逻辑保持不变
                    const isClicked =
                      clickedBlockKey === clickedKey &&
                      clickedPartIds.has(part.id);

                    // 在 feedback mode 下，根据 relatedFeedbacks 的 isPositive/isNegative 显示符号
                    const showSentiment = isFeedbackMode && hasContent && relatedFeedbacks.length > 0;
                    const sentimentSymbol = showSentiment 
                      ? (relatedFeedbacks.some(fb => fb.isPositive) ? '+' 
                         : relatedFeedbacks.some(fb => fb.isNegative) ? '-' 
                         : null)
                      : null;

                    return (
                      <div
                        key={`${part.id}-${checklistItem.id}`}
                        className="aspect-square border border-slate-200 rounded bg-white relative overflow-hidden"
                        style={{
                          boxShadow: isClicked
                            ? `0 0 0 2px ${columnColor.bg}CC, 0 0 0 4px ${columnColor.border}AA, 0 0 12px 6px ${columnColor.border}70`
                            : 'none',
                          zIndex: isClicked ? 20 : 1,
                        }}
                      >
                        {hasContent ? (
                          isFeedbackMode && relatedFeedbacks.length > 0 ? (
                            <Tooltip
                              placement="top"
                              arrow
                              disableInteractive
                              title={
                                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                                  <div className="font-semibold mb-1">
                                    Sec{part.id} · {checklistItem.name}
                                  </div>
                                  {relatedFeedbacks.map((fb) => (
                                    <div key={fb.id}>
                                      <div className="font-medium mb-0.5">
                                        Comment{fb.id}
                                        {fb.title ? ` - ${fb.title}` : ''}
                                      </div>
                                      <div className="whitespace-pre-wrap break-words text-xs">
                                        {fb.text || 'No feedback content'}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              }
                            >
                              <div
                                className="w-full h-full border rounded cursor-pointer hover:opacity-80 transition-all relative"
                                style={{
                                      backgroundColor: columnColor.bg,
                                      borderColor: columnColor.border,
                                      borderWidth: '0',
                                      backgroundImage: isClicked
                                        ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)'
                                        : 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                                      filter: isClicked
                                        ? 'brightness(1.2) saturate(1.3)'
                                        : 'none',
                                    }}
                                onClick={() => {
                                  const blockClickKey = `${workIndex}-${checklistItem.id}`;
                                      const isAlreadyClicked =
                                        clickedBlockKey === blockClickKey &&
                                        clickedPartIds.has(part.id);

                                      // 内层点击逻辑：
                                      // - 如果当前是选中状态：只取消选中，不收起展开区域
                                      // - 否则：选中并高亮对应 section + 段落
                                      if (isAlreadyClicked) {
                                        onSetClickedBlockKey(null);
                                        onSetClickedPartIds(new Set());
                                        onSetActivePartKey(null);
                                        onSetActiveSegmentIds(new Set());
                                        return;
                                      }

                                      onSetClickedBlockKey(blockClickKey);

                                      const targetPartId = part.id;
                                      const partKey = `${workIndex}-${targetPartId}`;

                                      if (targetPartId != null) {
                                        onSetClickedPartIds(new Set([targetPartId]));
                                        onSetActivePartKey(partKey);
                                        onSetActiveSegmentIds(
                                          new Set(paragraphIds || [])
                                        );
                                      }
                                    }}
                              >
                                {sentimentSymbol && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <span className="text-white text-2xl font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                      {sentimentSymbol}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </Tooltip>
                          ) : (
                            <div
                              className="w-full h-full border rounded cursor-pointer hover:opacity-80 transition-all relative"
                              style={{
                                    backgroundColor: columnColor.bg,
                                    borderColor: columnColor.border,
                                    borderWidth: '0',
                                    backgroundImage: isClicked
                                      ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)'
                                      : 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                                    filter: isClicked
                                      ? 'brightness(1.2) saturate(1.3)'
                                      : 'none',
                                  }}
                              onClick={() => {
                                const blockClickKey = `${workIndex}-${checklistItem.id}`;
                                const isAlreadyClicked =
                                  clickedBlockKey === blockClickKey &&
                                  clickedPartIds.has(part.id);

                                // 内层点击逻辑：
                                // - 如果当前是选中状态：只取消选中，不收起展开区域
                                // - 否则：选中并高亮对应 section + 段落
                                if (isAlreadyClicked) {
                                  onSetClickedBlockKey(null);
                                  onSetClickedPartIds(new Set());
                                  onSetActivePartKey(null);
                                  onSetActiveSegmentIds(new Set());
                                  return;
                                }

                                onSetClickedBlockKey(blockClickKey);

                                const targetPartId = part.id;
                                const partKey = `${workIndex}-${targetPartId}`;

                                if (targetPartId != null) {
                                  onSetClickedPartIds(new Set([targetPartId]));
                                  onSetActivePartKey(partKey);
                                  onSetActiveSegmentIds(
                                    new Set(paragraphIds || [])
                                  );
                                }
                              }}
                            />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300 text-[8px]">
                            -
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ExpandedEssayView;

